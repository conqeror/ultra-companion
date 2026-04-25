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

/**
 * Get ETA to a specific distance along the route, interpolating between points.
 */
export function getETAToDistance(
  cumulativeTime: number[],
  points: RoutePoint[],
  fromIndex: number,
  targetDistanceAlongRouteM: number,
): ETAResult | null {
  if (points.length === 0 || cumulativeTime.length === 0) return null;
  if (fromIndex < 0 || fromIndex >= points.length) return null;

  const fromDist = points[fromIndex].distanceFromStartMeters;
  const distanceMeters = targetDistanceAlongRouteM - fromDist;
  if (distanceMeters < 0) return null;

  // Find the two points bracketing the target distance.
  const targetIndex = findFirstPointAtOrAfterDistance(points, targetDistanceAlongRouteM, fromIndex);
  const hi = targetIndex < points.length ? targetIndex : points.length - 1;
  const lo = Math.max(fromIndex, hi - 1);

  // Interpolate time between lo and hi
  const loTime = cumulativeTime[lo];
  const hiTime = cumulativeTime[hi];
  const loDist = points[lo].distanceFromStartMeters;
  const hiDist = points[hi].distanceFromStartMeters;

  let interpolatedTime: number;
  if (hiDist - loDist > 0) {
    const t = (targetDistanceAlongRouteM - loDist) / (hiDist - loDist);
    interpolatedTime = loTime + t * (hiTime - loTime);
  } else {
    interpolatedTime = loTime;
  }

  const ridingTimeSeconds = interpolatedTime - cumulativeTime[fromIndex];
  const eta = new Date(Date.now() + ridingTimeSeconds * 1000);

  return { distanceMeters, ridingTimeSeconds, eta };
}
