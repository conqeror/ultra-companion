import type { RoutePoint, PowerModelConfig, ETAResult } from "@/types";
import { computeSegmentTime } from "./powerModel";
import { findFirstPointAtOrAfterDistance } from "@/utils/geo";

/**
 * Compute cumulative riding time (seconds) at each route point.
 * cumulativeTime[0] = 0, cumulativeTime[i] = total seconds from point 0 to point i.
 */
export function computeRouteETA(points: RoutePoint[], config: PowerModelConfig): number[] {
  if (points.length === 0) return [];

  const cumulative = Array.from<number>({ length: points.length });
  cumulative[0] = 0;

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];

    const dist = curr.distanceFromStartMeters - prev.distanceFromStartMeters;
    const elevDiff = (curr.elevationMeters ?? 0) - (prev.elevationMeters ?? 0);
    const gradient = dist > 0 ? elevDiff / dist : 0;

    cumulative[i] = cumulative[i - 1] + computeSegmentTime(dist, gradient, config);
  }

  return cumulative;
}

/**
 * Get riding time in seconds between two point indices.
 */
export function getETABetweenIndices(
  cumulativeTime: number[],
  fromIndex: number,
  toIndex: number,
): number {
  if (fromIndex < 0 || toIndex < 0) return 0;
  if (fromIndex >= cumulativeTime.length || toIndex >= cumulativeTime.length) return 0;
  return cumulativeTime[toIndex] - cumulativeTime[fromIndex];
}

function getTimeAtDistance(
  cumulativeTime: number[],
  points: RoutePoint[],
  distanceAlongRouteM: number,
): number | null {
  if (points.length === 0 || cumulativeTime.length === 0) return null;
  if (points.length !== cumulativeTime.length) return null;

  if (points.length === 1) return cumulativeTime[0];

  const hi = Math.min(
    findFirstPointAtOrAfterDistance(points, distanceAlongRouteM),
    points.length - 1,
  );
  const lo = Math.max(0, hi - 1);

  const loTime = cumulativeTime[lo];
  const hiTime = cumulativeTime[hi];
  const loDist = points[lo].distanceFromStartMeters;
  const hiDist = points[hi].distanceFromStartMeters;

  if (hiDist - loDist <= 0) return loTime;

  const t = (distanceAlongRouteM - loDist) / (hiDist - loDist);
  return loTime + t * (hiTime - loTime);
}

/**
 * Get ETA between two route distances, interpolating between points.
 */
export function getETAToDistanceFromDistance(
  cumulativeTime: number[],
  points: RoutePoint[],
  fromDistanceAlongRouteM: number,
  targetDistanceAlongRouteM: number,
): ETAResult | null {
  if (points.length === 0 || cumulativeTime.length === 0) return null;

  const distanceMeters = targetDistanceAlongRouteM - fromDistanceAlongRouteM;
  if (distanceMeters < 0) return null;

  const fromTime = getTimeAtDistance(cumulativeTime, points, fromDistanceAlongRouteM);
  const targetTime = getTimeAtDistance(cumulativeTime, points, targetDistanceAlongRouteM);
  if (fromTime == null || targetTime == null) return null;

  const ridingTimeSeconds = targetTime - fromTime;
  const eta = new Date(Date.now() + ridingTimeSeconds * 1000);

  return { distanceMeters, ridingTimeSeconds, eta };
}

/**
 * Get ETA from a route point index to a specific distance along the route.
 */
export function getETAToDistance(
  cumulativeTime: number[],
  points: RoutePoint[],
  fromIndex: number,
  targetDistanceAlongRouteM: number,
): ETAResult | null {
  if (fromIndex < 0 || fromIndex >= points.length) return null;
  return getETAToDistanceFromDistance(
    cumulativeTime,
    points,
    points[fromIndex].distanceFromStartMeters,
    targetDistanceAlongRouteM,
  );
}
