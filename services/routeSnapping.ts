import { findNearestPointOnRoute } from "@/utils/geo";
import type { RoutePoint, SnappedPosition } from "@/types";

const MAX_SNAP_DISTANCE_M = 1000; // Don't snap if >1km from route

export function snapToRoute(
  lat: number,
  lon: number,
  routeId: string,
  points: RoutePoint[],
): SnappedPosition | null {
  if (points.length === 0) return null;

  const { index, distanceMeters } = findNearestPointOnRoute(lat, lon, points);

  if (distanceMeters > MAX_SNAP_DISTANCE_M) return null;

  return {
    routeId,
    pointIndex: index,
    distanceAlongRouteMeters: points[index].distanceFromStartMeters,
    distanceFromRouteMeters: distanceMeters,
  };
}
