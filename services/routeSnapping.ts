import { findNearestPointOnRoute } from "@/utils/geo";
import type { RoutePoint, SnappedPosition } from "@/types";

const MAX_SNAP_DISTANCE_M = 1000; // Don't snap if >1km from route
const LOCAL_SEARCH_WINDOW_POINTS = 500;

export function snapToRoute(
  lat: number,
  lon: number,
  routeId: string,
  points: RoutePoint[],
  options?: { previousPointIndex?: number | null },
): SnappedPosition | null {
  if (points.length === 0) return null;

  let nearest: { index: number; distanceMeters: number } | null = null;
  const previousPointIndex = options?.previousPointIndex;
  if (previousPointIndex != null && previousPointIndex >= 0 && previousPointIndex < points.length) {
    nearest = findNearestPointOnRoute(lat, lon, points, {
      startIndex: Math.max(0, previousPointIndex - LOCAL_SEARCH_WINDOW_POINTS),
      endIndex: Math.min(points.length - 1, previousPointIndex + LOCAL_SEARCH_WINDOW_POINTS),
    });
  }

  if (!nearest || nearest.distanceMeters > MAX_SNAP_DISTANCE_M) {
    nearest = findNearestPointOnRoute(lat, lon, points);
  }

  const { index, distanceMeters } = nearest;

  if (distanceMeters > MAX_SNAP_DISTANCE_M) return null;

  return {
    routeId,
    pointIndex: index,
    distanceAlongRouteMeters: points[index].distanceFromStartMeters,
    distanceFromRouteMeters: distanceMeters,
  };
}
