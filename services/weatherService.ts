import type { RoutePoint, WeatherPoint, WeatherSampleKind, WindRelative } from "@/types";
import {
  OPEN_METEO_MAX_FORECAST_HOURS,
  WEATHER_WAYPOINT_INTERVAL_M,
  WEATHER_TIMELINE_HOURS,
} from "@/constants";
import { fetchForecasts, type HourlyForecast } from "./weatherClient";
import { getETAToDistanceFromDistance } from "./etaCalculator";
import { computeBearing, interpolateRoutePointAtDistance } from "@/utils/geo";

const POST_FINISH_FORECAST_HOURS = 5;
const ROUTE_DISPLAY_SAMPLE_SECONDS = 3600;
const ROUTE_DISPLAY_SAMPLE_DISTANCE_M = 10_000;
const MIN_FORECAST_HOURS_TO_CACHE = WEATHER_TIMELINE_HOURS;

type WeatherWaypoint = {
  latitude: number;
  longitude: number;
  distanceAlongRouteM: number;
  routeDistanceMeters: number;
  index: number;
  segmentIndex: number;
};

type WeatherDisplaySample = WeatherWaypoint & {
  ridingTimeSeconds: number;
  sampleKind: WeatherSampleKind;
  sampleKinds: WeatherSampleKind[];
};

export interface WeatherTimelineOptions {
  projectionStartTime?: Date;
}

export interface WeatherTimelineBuildResult {
  timeline: WeatherPoint[];
  routeCoverageFromMeters: number | null;
  routeCoverageUntilMeters: number | null;
  forecastFromMs: number | null;
  forecastUntilMs: number | null;
}

function validRouteStartDistance(points: RoutePoint[], distanceMeters: number): number | null {
  if (points.length === 0) return null;
  if (!Number.isFinite(distanceMeters)) return null;
  const routeEndMeters = points[points.length - 1].distanceFromStartMeters;
  if (distanceMeters < 0 || distanceMeters > routeEndMeters) return null;
  return distanceMeters;
}

export function sampleWaypoints(
  points: RoutePoint[],
  fromDistanceAlongRouteM: number,
): WeatherWaypoint[] {
  const startDist = validRouteStartDistance(points, fromDistanceAlongRouteM);
  if (startDist == null) return [];

  const routeEndMeters = points[points.length - 1].distanceFromStartMeters;
  const start = interpolateRoutePointAtDistance(points, startDist);
  if (!start) return [];

  const waypoints: WeatherWaypoint[] = [
    {
      latitude: start.latitude,
      longitude: start.longitude,
      distanceAlongRouteM: 0,
      routeDistanceMeters: startDist,
      index: start.nearestIndex,
      segmentIndex: start.segmentIndex,
    },
  ];

  let nextThreshold = startDist + WEATHER_WAYPOINT_INTERVAL_M;
  while (nextThreshold <= routeEndMeters) {
    const waypoint = interpolateRoutePointAtDistance(points, nextThreshold);
    if (!waypoint) break;
    waypoints.push({
      latitude: waypoint.latitude,
      longitude: waypoint.longitude,
      distanceAlongRouteM: nextThreshold - startDist,
      routeDistanceMeters: nextThreshold,
      index: waypoint.nearestIndex,
      segmentIndex: waypoint.segmentIndex,
    });
    nextThreshold += WEATHER_WAYPOINT_INTERVAL_M;
  }

  const lastWaypoint = waypoints[waypoints.length - 1];
  if (routeEndMeters - lastWaypoint.routeDistanceMeters >= 1000) {
    const finish = interpolateRoutePointAtDistance(points, routeEndMeters);
    if (finish) {
      waypoints.push({
        latitude: finish.latitude,
        longitude: finish.longitude,
        distanceAlongRouteM: routeEndMeters - startDist,
        routeDistanceMeters: routeEndMeters,
        index: finish.nearestIndex,
        segmentIndex: finish.segmentIndex,
      });
    }
  }

  return waypoints;
}

function getBearingAtSegment(points: RoutePoint[], segmentIndex: number): number | null {
  if (points.length < 2) return null;
  const prev = Math.max(0, Math.min(segmentIndex, points.length - 2));
  const next = prev + 1;
  return computeBearing(
    points[prev].latitude,
    points[prev].longitude,
    points[next].latitude,
    points[next].longitude,
  );
}

export function classifyWind(windDirectionDeg: number, routeBearingDeg: number): WindRelative {
  // Wind direction = where wind comes FROM; headwind = wind from direction we're heading.
  let angleDiff = windDirectionDeg - routeBearingDeg;
  while (angleDiff > 180) angleDiff -= 360;
  while (angleDiff < -180) angleDiff += 360;

  const abs = Math.abs(angleDiff);
  if (abs < 45) return "headwind";
  if (abs > 135) return "tailwind";
  return angleDiff > 0 ? "crosswind-right" : "crosswind-left";
}

function minForecastTimeMs(forecasts: HourlyForecast[]): number | null {
  const times = forecasts.flatMap((forecast) =>
    forecast.hours.map((hour) => new Date(hour.time).getTime()),
  );
  return times.length > 0 ? Math.min(...times) : null;
}

function maxForecastTimeMs(forecasts: HourlyForecast[]): number | null {
  const times = forecasts.flatMap((forecast) =>
    forecast.hours.map((hour) => new Date(hour.time).getTime()),
  );
  return times.length > 0 ? Math.max(...times) : null;
}

function forecastHoursForProjection(projectionStart: Date, maxRidingTimeSeconds: number): number {
  const hoursUntilProjection = Math.max(
    0,
    Math.ceil((projectionStart.getTime() - Date.now()) / 3600_000),
  );
  const neededHours =
    hoursUntilProjection + Math.ceil(maxRidingTimeSeconds / 3600) + POST_FINISH_FORECAST_HOURS + 2;
  return Math.min(
    OPEN_METEO_MAX_FORECAST_HOURS,
    Math.max(MIN_FORECAST_HOURS_TO_CACHE, neededHours),
  );
}

function ridingTimeToRoutePosition(
  cumulativeTime: number[],
  points: RoutePoint[],
  fromDistanceAlongRouteM: number,
  ridingTimeSeconds: number,
): WeatherWaypoint | null {
  if (points.length === 0 || cumulativeTime.length === 0) return null;
  const startDist = validRouteStartDistance(points, fromDistanceAlongRouteM);
  if (startDist == null) return null;

  const routeEndMeters = points[points.length - 1].distanceFromStartMeters;
  const fromTime = getRouteTimeAtDistance(cumulativeTime, points, startDist);
  if (fromTime == null) return null;
  const targetTime = fromTime + Math.max(0, ridingTimeSeconds);

  for (let index = 1; index < points.length; index++) {
    const prevTime = cumulativeTime[index - 1];
    const nextTime = cumulativeTime[index];
    if (nextTime < targetTime) continue;

    const prevPoint = points[index - 1];
    const nextPoint = points[index];
    const timeDelta = nextTime - prevTime;
    const progress = timeDelta > 0 ? (targetTime - prevTime) / timeDelta : 0;
    const clampedProgress = Math.max(0, Math.min(1, progress));
    const routeDistanceMeters =
      prevPoint.distanceFromStartMeters +
      (nextPoint.distanceFromStartMeters - prevPoint.distanceFromStartMeters) * clampedProgress;

    if (routeDistanceMeters < startDist) continue;

    return {
      latitude: prevPoint.latitude + (nextPoint.latitude - prevPoint.latitude) * clampedProgress,
      longitude:
        prevPoint.longitude + (nextPoint.longitude - prevPoint.longitude) * clampedProgress,
      distanceAlongRouteM: routeDistanceMeters - startDist,
      routeDistanceMeters,
      index,
      segmentIndex: Math.max(0, index - 1),
    };
  }

  const finish = interpolateRoutePointAtDistance(points, routeEndMeters);
  if (!finish) return null;
  return {
    latitude: finish.latitude,
    longitude: finish.longitude,
    distanceAlongRouteM: routeEndMeters - startDist,
    routeDistanceMeters: routeEndMeters,
    index: finish.nearestIndex,
    segmentIndex: finish.segmentIndex,
  };
}

function getRouteTimeAtDistance(
  cumulativeTime: number[],
  points: RoutePoint[],
  distanceAlongRouteM: number,
): number | null {
  const eta = getETAToDistanceFromDistance(cumulativeTime, points, 0, distanceAlongRouteM);
  return eta?.ridingTimeSeconds ?? null;
}

function routeDisplaySamples(
  cumulativeTime: number[],
  points: RoutePoint[],
  fromDistanceAlongRouteM: number,
  finishRidingTimeSeconds: number,
): WeatherDisplaySample[] {
  const samples: WeatherDisplaySample[] = [];
  const finishSeconds = Math.max(0, finishRidingTimeSeconds);
  const routeEndMeters = points[points.length - 1]?.distanceFromStartMeters ?? 0;

  const addSample = (ridingTimeSeconds: number, sampleKind: WeatherSampleKind) => {
    const position = ridingTimeToRoutePosition(
      cumulativeTime,
      points,
      fromDistanceAlongRouteM,
      ridingTimeSeconds,
    );
    if (!position) return;
    const distanceKey = Math.round(position.routeDistanceMeters / 100);
    const existing = samples.find(
      (sample) => Math.round(sample.routeDistanceMeters / 100) === distanceKey,
    );
    if (existing) {
      if (!existing.sampleKinds.includes(sampleKind)) existing.sampleKinds.push(sampleKind);
      return;
    }
    samples.push({ ...position, ridingTimeSeconds, sampleKind, sampleKinds: [sampleKind] });
  };

  for (
    let elapsedSeconds = 0;
    elapsedSeconds <= finishSeconds;
    elapsedSeconds += ROUTE_DISPLAY_SAMPLE_SECONDS
  ) {
    addSample(elapsedSeconds, "hourly");
  }

  for (
    let routeDistanceMeters = fromDistanceAlongRouteM + ROUTE_DISPLAY_SAMPLE_DISTANCE_M;
    routeDistanceMeters < routeEndMeters;
    routeDistanceMeters += ROUTE_DISPLAY_SAMPLE_DISTANCE_M
  ) {
    const eta = getETAToDistanceFromDistance(
      cumulativeTime,
      points,
      fromDistanceAlongRouteM,
      routeDistanceMeters,
    );
    if (eta) addSample(eta.ridingTimeSeconds, "distance");
  }

  const finalSample = samples[samples.length - 1];
  if (!finalSample || Math.abs(finalSample.ridingTimeSeconds - finishSeconds) > 60) {
    addSample(finishSeconds, "finish");
  } else if (!finalSample.sampleKinds.includes("finish")) {
    finalSample.sampleKinds.push("finish");
  }

  return samples.sort((a, b) => a.routeDistanceMeters - b.routeDistanceMeters);
}

function hasForecastCoverage(
  parsed: { time: number; data: HourlyForecast["hours"][number] }[] | undefined,
  targetMs: number,
): boolean {
  if (!parsed?.length) return false;
  const first = parsed[0].time;
  const last = parsed[parsed.length - 1].time;
  return targetMs >= first - 3600_000 && targetMs <= last + 3600_000;
}

/**
 * Build weather timeline using precomputed ETA data.
 * Route rows include hourly, 10 km distance, and finish samples; post-finish rows follow finish.
 */
export async function buildWeatherTimeline(
  points: RoutePoint[],
  fromDistanceAlongRouteM: number,
  cumulativeTime: number[],
  options: WeatherTimelineOptions = {},
): Promise<WeatherPoint[]> {
  const forecasts = await fetchWeatherForecastsForRoute(
    points,
    fromDistanceAlongRouteM,
    cumulativeTime,
    options,
  );
  return buildWeatherTimelineFromForecasts(
    points,
    fromDistanceAlongRouteM,
    cumulativeTime,
    forecasts,
    options,
  ).timeline;
}

export async function fetchWeatherForecastsForRoute(
  points: RoutePoint[],
  fromDistanceAlongRouteM: number,
  cumulativeTime: number[],
  options: WeatherTimelineOptions = {},
): Promise<HourlyForecast[]> {
  const projectionStart = options.projectionStartTime ?? new Date();
  const waypoints = sampleWaypoints(points, fromDistanceAlongRouteM);
  if (waypoints.length === 0) return [];

  const routeEndMeters = points[points.length - 1].distanceFromStartMeters;
  const finishEta = getETAToDistanceFromDistance(
    cumulativeTime,
    points,
    fromDistanceAlongRouteM,
    routeEndMeters,
  );
  const maxRidingTimeSeconds =
    finishEta?.ridingTimeSeconds ??
    Math.max(
      ...waypoints.map((waypoint) => {
        const eta = getETAToDistanceFromDistance(
          cumulativeTime,
          points,
          fromDistanceAlongRouteM,
          waypoint.routeDistanceMeters,
        );
        return eta?.ridingTimeSeconds ?? 0;
      }),
    );

  return fetchForecasts(
    waypoints.map((w) => ({ latitude: w.latitude, longitude: w.longitude })),
    forecastHoursForProjection(projectionStart, maxRidingTimeSeconds),
  );
}

export function buildWeatherTimelineFromForecasts(
  points: RoutePoint[],
  fromDistanceAlongRouteM: number,
  cumulativeTime: number[],
  forecasts: HourlyForecast[],
  options: WeatherTimelineOptions = {},
): WeatherTimelineBuildResult {
  const startDist = validRouteStartDistance(points, fromDistanceAlongRouteM);
  if (startDist == null) return emptyBuildResult(forecasts);

  const waypoints = sampleWaypoints(points, startDist);
  if (waypoints.length === 0 || forecasts.length === 0) return emptyBuildResult(forecasts);

  const waypointETAs = waypoints.map((waypoint) => {
    const eta = getETAToDistanceFromDistance(
      cumulativeTime,
      points,
      startDist,
      waypoint.routeDistanceMeters,
    );
    return {
      waypoint,
      ridingTimeSeconds: eta?.ridingTimeSeconds ?? 0,
      forecast: findClosestForecast(forecasts, waypoint.latitude, waypoint.longitude),
    };
  });

  const routeEndMeters = points[points.length - 1].distanceFromStartMeters;
  const finishEta = getETAToDistanceFromDistance(cumulativeTime, points, startDist, routeEndMeters);
  const maxRidingTimeSeconds =
    finishEta?.ridingTimeSeconds ?? Math.max(...waypointETAs.map((wp) => wp.ridingTimeSeconds));

  const parsedForecasts = new Map<
    HourlyForecast,
    { time: number; data: HourlyForecast["hours"][number] }[]
  >();
  for (const f of forecasts) {
    parsedForecasts.set(
      f,
      f.hours.map((h) => ({ time: new Date(h.time).getTime(), data: h })),
    );
  }

  const projectionStart = options.projectionStartTime ?? new Date();
  const timeline: WeatherPoint[] = [];

  const displaySamples = routeDisplaySamples(
    cumulativeTime,
    points,
    startDist,
    maxRidingTimeSeconds,
  );

  for (let index = 0; index < displaySamples.length; index++) {
    const sample = displaySamples[index];
    const forecast = findClosestForecast(forecasts, sample.latitude, sample.longitude);
    if (!forecast) continue;

    const etaTime = new Date(projectionStart.getTime() + sample.ridingTimeSeconds * 1000);
    const parsed = parsedForecasts.get(forecast);
    if (!hasForecastCoverage(parsed, etaTime.getTime())) continue;
    const hourData = findClosestHour(parsed, etaTime.getTime());
    if (!hourData) continue;

    timeline.push(weatherPointFromHour(hourData, sample, index, etaTime, "route"));
  }

  const finishForecast = waypointETAs[waypointETAs.length - 1];
  const isActualFinish =
    Math.abs((finishForecast?.waypoint.routeDistanceMeters ?? 0) - routeEndMeters) < 1;
  if (finishForecast?.forecast && isActualFinish) {
    const parsed = parsedForecasts.get(finishForecast.forecast);
    const finishEtaTime = new Date(
      projectionStart.getTime() + finishForecast.ridingTimeSeconds * 1000,
    );

    for (let hour = 1; hour <= POST_FINISH_FORECAST_HOURS; hour++) {
      const postFinishTime = new Date(finishEtaTime.getTime() + hour * 3600_000);
      if (!hasForecastCoverage(parsed, postFinishTime.getTime())) continue;
      const hourData = findClosestHour(parsed, postFinishTime.getTime());
      if (!hourData) continue;

      timeline.push(
        weatherPointFromHour(
          hourData,
          {
            ...finishForecast.waypoint,
            ridingTimeSeconds: finishForecast.ridingTimeSeconds + hour * 3600,
            sampleKind: "post-finish",
            sampleKinds: ["post-finish"],
          },
          timeline.length,
          postFinishTime,
          "post-finish",
        ),
      );
    }
  }

  return {
    timeline,
    routeCoverageFromMeters: minWeatherDistance(timeline),
    routeCoverageUntilMeters: maxWeatherDistance(timeline),
    forecastFromMs: minForecastTimeMs(forecasts),
    forecastUntilMs: maxForecastTimeMs(forecasts),
  };

  function weatherPointFromHour(
    hourData: HourlyForecast["hours"][number],
    sample: WeatherDisplaySample,
    hourOffset: number,
    etaTime: Date,
    phase: WeatherPoint["phase"],
  ): WeatherPoint {
    return {
      hourOffset,
      phase,
      sampleKind: sample.sampleKind,
      sampleKinds: sample.sampleKinds,
      time: hourData.time,
      etaTime: etaTime.toISOString(),
      temperatureC: hourData.temperature2m,
      apparentTemperatureC: hourData.apparentTemperature2m,
      dewPointC: hourData.dewPoint2m,
      relativeHumidityPercent: hourData.relativeHumidity2m,
      precipitationMm: hourData.precipitation,
      precipitationProbability: hourData.precipitationProbability,
      windSpeedKmh: hourData.windSpeed10m,
      windDirectionDeg: hourData.windDirection10m,
      windGustKmh: hourData.windGusts10m,
      weatherCode: hourData.weatherCode,
      isDay: hourData.isDay === 1,
      latitude: sample.latitude,
      longitude: sample.longitude,
      distanceAlongRouteM: sample.distanceAlongRouteM,
      routeDistanceMeters: sample.routeDistanceMeters,
      routeBearingDeg: getBearingAtSegment(points, sample.segmentIndex),
    };
  }
}

function emptyBuildResult(forecasts: HourlyForecast[]): WeatherTimelineBuildResult {
  return {
    timeline: [],
    routeCoverageFromMeters: null,
    routeCoverageUntilMeters: null,
    forecastFromMs: minForecastTimeMs(forecasts),
    forecastUntilMs: maxForecastTimeMs(forecasts),
  };
}

function minWeatherDistance(timeline: WeatherPoint[]): number | null {
  const routePoints = timeline.filter((point) => point.phase === "route");
  return routePoints.length > 0
    ? Math.min(...routePoints.map((point) => point.routeDistanceMeters))
    : null;
}

function maxWeatherDistance(timeline: WeatherPoint[]): number | null {
  const routePoints = timeline.filter((point) => point.phase === "route");
  return routePoints.length > 0
    ? Math.max(...routePoints.map((point) => point.routeDistanceMeters))
    : null;
}

function findClosestForecast(
  forecasts: HourlyForecast[],
  lat: number,
  lon: number,
): HourlyForecast | null {
  let best: HourlyForecast | null = null;
  let bestDist = Infinity;
  for (const f of forecasts) {
    const d = Math.abs(f.latitude - lat) + Math.abs(f.longitude - lon);
    if (d < bestDist) {
      bestDist = d;
      best = f;
    }
  }
  return best;
}

function findClosestHour(
  parsed: { time: number; data: HourlyForecast["hours"][number] }[] | undefined,
  targetMs: number,
): HourlyForecast["hours"][number] | null {
  if (!parsed?.length) return null;
  let best = parsed[0].data;
  let bestDiff = Math.abs(parsed[0].time - targetMs);
  for (let i = 1; i < parsed.length; i++) {
    const diff = Math.abs(parsed[i].time - targetMs);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = parsed[i].data;
    }
  }
  return best;
}
