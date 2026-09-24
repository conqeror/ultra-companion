import { WEATHER_WAYPOINT_INTERVAL_M } from "@/constants";
import type { RoutePoint } from "@/types";
import { haversineDistance, routePointArrayFingerprint } from "@/utils/geo";
import type { PlannedStop } from "./plannedStops";
import type { HourlyForecast } from "./weatherClient";
import { sampleWaypoints, type WeatherForecastRequirements } from "./weatherService";

export interface WeatherProjectionContext {
  routeId: string;
  geometryKey: string;
  etaKey: string;
  fromDistanceAlongRouteMeters: number;
  plannedStartMs: number | null;
  plannedStopSignature: string;
}

export interface WeatherProjectionInput {
  context: WeatherProjectionContext;
  points: RoutePoint[];
  cumulativeTime: number[];
  plannedStops: readonly PlannedStop[];
}

export interface WeatherForecastCache {
  routeId: string;
  geometryKey: string | null;
  fromDistanceAlongRouteMeters: number;
  forecasts: HourlyForecast[];
  fetchedAt: number;
}

// Route and ETA arrays are immutable snapshots. Retain only compact keys; weak
// entries release with their arrays and avoid rescanning a long route on every render.
const geometryKeys = new WeakMap<RoutePoint[], string>();
const etaKeys = new WeakMap<number[], string>();

export function weatherGeometryKey(points: RoutePoint[]): string {
  let key = geometryKeys.get(points);
  if (key == null) {
    key = routePointArrayFingerprint(points);
    geometryKeys.set(points, key);
  }
  return key;
}

function etaKey(cumulativeTime: number[]): string {
  const cached = etaKeys.get(cumulativeTime);
  if (cached != null) return cached;
  let hashA = 0x811c9dc5;
  let hashB = 0x9e3779b9;
  for (const seconds of cumulativeTime) {
    const milliseconds = Math.round(seconds * 1000);
    hashA = Math.imul(hashA ^ milliseconds, 0x01000193) >>> 0;
    hashB = Math.imul(hashB ^ milliseconds, 0x85ebca6b) >>> 0;
    hashB = (hashB ^ (hashB >>> 13)) >>> 0;
  }
  const key = `${cumulativeTime.length}:${hashA.toString(16)}:${hashB.toString(16)}`;
  etaKeys.set(cumulativeTime, key);
  return key;
}

export function createWeatherProjectionInput(
  routeId: string,
  points: RoutePoint[],
  fromDistanceAlongRouteMeters: number,
  cumulativeTime: number[],
  plannedStartMs: number | null = null,
  plannedStops: readonly PlannedStop[] = [],
): WeatherProjectionInput {
  const stops = plannedStops.map((stop) => ({ ...stop }));
  return {
    context: {
      routeId,
      geometryKey: weatherGeometryKey(points),
      etaKey: etaKey(cumulativeTime),
      fromDistanceAlongRouteMeters,
      plannedStartMs,
      plannedStopSignature:
        stops
          .map((stop) => `${Math.round(stop.distanceMeters)}:${stop.durationSeconds}`)
          .join(",") || "none",
    },
    points,
    cumulativeTime,
    plannedStops: stops,
  };
}

export function weatherProjectionKey(context: WeatherProjectionContext): string {
  return JSON.stringify([
    context.routeId,
    context.geometryKey,
    context.etaKey,
    Math.round(context.fromDistanceAlongRouteMeters / 100),
    context.plannedStartMs,
    context.plannedStopSignature,
  ]);
}

export function weatherProjectionMatchesRoute(
  context: WeatherProjectionContext | null,
  routeId: string | null | undefined,
  points: RoutePoint[] | null | undefined,
): boolean {
  return (
    context != null &&
    routeId === context.routeId &&
    points != null &&
    weatherGeometryKey(points) === context.geometryKey
  );
}

export function canReuseWeatherForecasts(
  cache: WeatherForecastCache | null,
  input: WeatherProjectionInput,
): cache is WeatherForecastCache {
  if (!cache?.forecasts.length || cache.routeId !== input.context.routeId) return false;
  if (
    cache.geometryKey === input.context.geometryKey &&
    input.context.fromDistanceAlongRouteMeters >= cache.fromDistanceAlongRouteMeters
  ) {
    return true;
  }

  // A nearby variant can reuse already-downloaded forecasts; a distant variant
  // needs forecasts at its own locations instead of inheriting another route's weather.
  const waypoints = sampleWaypoints(input.points, input.context.fromDistanceAlongRouteMeters);
  return (
    waypoints.length > 0 &&
    waypoints.every((waypoint) =>
      cache.forecasts.some(
        (forecast) =>
          haversineDistance(
            waypoint.latitude,
            waypoint.longitude,
            forecast.latitude,
            forecast.longitude,
          ) <=
          WEATHER_WAYPOINT_INTERVAL_M + 5_000,
      ),
    )
  );
}

export function hasWeatherForecastTimeCoverage(
  cache: WeatherForecastCache | null,
  requirements: WeatherForecastRequirements | null,
): boolean {
  if (!cache?.forecasts.length || !requirements) return false;
  return cache.forecasts.every((forecast) => {
    const first = Date.parse(forecast.hours[0]?.time ?? "");
    const last = Date.parse(forecast.hours[forecast.hours.length - 1]?.time ?? "");
    // Match the timeline builder's one-hour edge tolerance for hourly samples.
    return (
      requirements.fromTimeMs >= first - 3600_000 && requirements.untilTimeMs <= last + 3600_000
    );
  });
}
