import type { POI } from "@/types";

export function buildPoi(
  id: string,
  routeId: string,
  distanceAlongRouteMeters: number,
  overrides: Partial<POI> = {},
): POI {
  return {
    id,
    sourceId: id,
    source: "osm",
    name: id,
    category: "water",
    latitude: 0,
    longitude: 0,
    tags: {},
    distanceFromRouteMeters: 0,
    distanceAlongRouteMeters,
    routeId,
    ...overrides,
  };
}
