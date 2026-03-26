import type { RoutePoint, WeatherPoint, WindRelative } from "@/types";
import { WEATHER_WAYPOINT_INTERVAL_M, WEATHER_LOOKAHEAD_M, WEATHER_TIMELINE_HOURS } from "@/constants";
import { fetchForecasts, type HourlyForecast } from "./weatherClient";
import { getETAToDistance } from "./etaCalculator";
import { computeBearing } from "@/utils/geo";

export function sampleWaypoints(
  points: RoutePoint[],
  fromIndex: number,
): { latitude: number; longitude: number; distanceAlongRouteM: number; index: number }[] {
  if (points.length === 0 || fromIndex < 0 || fromIndex >= points.length) return [];

  const startDist = points[fromIndex].distanceFromStartMeters;
  const maxDist = startDist + WEATHER_LOOKAHEAD_M;
  const waypoints: { latitude: number; longitude: number; distanceAlongRouteM: number; index: number }[] = [];

  waypoints.push({
    latitude: points[fromIndex].latitude,
    longitude: points[fromIndex].longitude,
    distanceAlongRouteM: 0,
    index: fromIndex,
  });

  let nextThreshold = startDist + WEATHER_WAYPOINT_INTERVAL_M;
  for (let i = fromIndex + 1; i < points.length; i++) {
    const dist = points[i].distanceFromStartMeters;
    if (dist > maxDist) break;
    if (dist >= nextThreshold) {
      waypoints.push({
        latitude: points[i].latitude,
        longitude: points[i].longitude,
        distanceAlongRouteM: dist - startDist,
        index: i,
      });
      nextThreshold = dist + WEATHER_WAYPOINT_INTERVAL_M;
    }
  }

  return waypoints;
}

function getBearingAtIndex(points: RoutePoint[], index: number): number | null {
  if (points.length < 2) return null;
  const next = Math.min(index + 1, points.length - 1);
  const prev = Math.max(index - 1, 0);
  if (prev === next) return null;
  return computeBearing(
    points[prev].latitude, points[prev].longitude,
    points[next].latitude, points[next].longitude,
  );
}

export function classifyWind(windDirectionDeg: number, routeBearingDeg: number): WindRelative {
  // Wind direction = where wind comes FROM; headwind = wind from direction we're heading
  let angleDiff = windDirectionDeg - routeBearingDeg;
  while (angleDiff > 180) angleDiff -= 360;
  while (angleDiff < -180) angleDiff += 360;

  const abs = Math.abs(angleDiff);
  if (abs < 45) return "headwind";
  if (abs > 135) return "tailwind";
  return angleDiff > 0 ? "crosswind-right" : "crosswind-left";
}

/**
 * Build weather timeline using precomputed ETA data.
 * For each future hour, finds the weather at the rider's projected route position.
 */
export async function buildWeatherTimeline(
  points: RoutePoint[],
  fromIndex: number,
  cumulativeTime: number[],
): Promise<WeatherPoint[]> {
  const waypoints = sampleWaypoints(points, fromIndex);
  if (waypoints.length === 0) return [];

  const forecasts = await fetchForecasts(
    waypoints.map((w) => ({ latitude: w.latitude, longitude: w.longitude })),
    WEATHER_TIMELINE_HOURS,
  );
  if (forecasts.length === 0) return [];

  const waypointForecasts = waypoints.map((wp) => {
    const match = findClosestForecast(forecasts, wp.latitude, wp.longitude);
    return { waypoint: wp, forecast: match };
  });

  const startDist = points[fromIndex].distanceFromStartMeters;

  // Precompute riding time to each waypoint (avoids repeated linear scans in the hourly loop)
  const waypointETAs = waypointForecasts.map((wpf) => {
    const targetDist = startDist + wpf.waypoint.distanceAlongRouteM;
    const eta = getETAToDistance(cumulativeTime, points, fromIndex, targetDist);
    return { ...wpf, ridingTimeSeconds: eta?.ridingTimeSeconds ?? 0 };
  });

  // Pre-parse forecast hour timestamps once per forecast
  const parsedForecasts = new Map<HourlyForecast, { time: number; data: HourlyForecast["hours"][number] }[]>();
  for (const f of forecasts) {
    parsedForecasts.set(f, f.hours.map((h) => ({ time: new Date(h.time).getTime(), data: h })));
  }

  const now = new Date();
  const currentHourStart = new Date(now);
  currentHourStart.setMinutes(0, 0, 0);

  const timeline: WeatherPoint[] = [];

  for (let h = 0; h < WEATHER_TIMELINE_HOURS; h++) {
    const hourTime = new Date(currentHourStart.getTime() + h * 3600_000);
    const secondsFromNow = (hourTime.getTime() - now.getTime()) / 1000;

    // Find the waypoint closest in riding time to this hour
    let bestWp = waypointETAs[0];
    let bestTimeDiff = Infinity;
    for (const wpf of waypointETAs) {
      const timeDiff = Math.abs(wpf.ridingTimeSeconds - secondsFromNow);
      if (timeDiff < bestTimeDiff) {
        bestTimeDiff = timeDiff;
        bestWp = wpf;
      }
    }

    if (!bestWp.forecast) continue;

    // Find closest forecast hour using pre-parsed timestamps
    const parsed = parsedForecasts.get(bestWp.forecast);
    const hourData = findClosestHour(parsed, hourTime.getTime());
    if (!hourData) continue;

    const bearing = getBearingAtIndex(points, bestWp.waypoint.index);

    timeline.push({
      hourOffset: h,
      time: hourTime.toISOString(),
      temperatureC: hourData.temperature2m,
      precipitationMm: hourData.precipitation,
      precipitationProbability: hourData.precipitationProbability,
      windSpeedKmh: hourData.windSpeed10m,
      windDirectionDeg: hourData.windDirection10m,
      windGustKmh: hourData.windGusts10m,
      weatherCode: hourData.weatherCode,
      latitude: bestWp.waypoint.latitude,
      longitude: bestWp.waypoint.longitude,
      distanceAlongRouteM: bestWp.waypoint.distanceAlongRouteM,
      routeBearingDeg: bearing,
    });
  }

  return timeline;
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
