import type { ActiveRouteData, ActiveRouteProgress, RoutePoint, SnappedPosition } from "@/types";

export const MAX_ACTIVE_ROUTE_PROGRESS_DISTANCE_M = 1000;

const ROUTE_DISTANCE_EPSILON_M = 1e-6;

export function resolveRouteProgress(
  snappedPosition: SnappedPosition | null | undefined,
  routeId: string | null | undefined,
  points: RoutePoint[] | null | undefined,
): ActiveRouteProgress | null {
  if (!snappedPosition || !routeId || snappedPosition.routeId !== routeId) return null;
  if (!points?.length) return null;
  if (
    !Number.isFinite(snappedPosition.distanceAlongRouteMeters) ||
    !Number.isFinite(snappedPosition.distanceFromRouteMeters)
  ) {
    return null;
  }
  if (snappedPosition.distanceFromRouteMeters > MAX_ACTIVE_ROUTE_PROGRESS_DISTANCE_M) {
    return null;
  }

  const routeStartMeters = points[0].distanceFromStartMeters;
  const routeEndMeters = points[points.length - 1].distanceFromStartMeters;
  if (
    snappedPosition.distanceAlongRouteMeters < routeStartMeters - ROUTE_DISTANCE_EPSILON_M ||
    snappedPosition.distanceAlongRouteMeters > routeEndMeters + ROUTE_DISTANCE_EPSILON_M
  ) {
    return null;
  }

  return snappedPosition as ActiveRouteProgress;
}

export function resolveActiveRouteProgress(
  activeData: ActiveRouteData | null | undefined,
  snappedPosition: SnappedPosition | null | undefined,
): ActiveRouteProgress | null {
  return resolveRouteProgress(snappedPosition, activeData?.id, activeData?.points);
}
