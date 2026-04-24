import type { RoutePoint } from "@/types";

export function buildRoutePoint(distanceFromStartMeters: number, idx: number): RoutePoint {
  return {
    latitude: 0,
    longitude: idx,
    elevationMeters: 100,
    distanceFromStartMeters,
    idx,
  };
}
