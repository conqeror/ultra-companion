import type { POI, POISource, RoutePoint } from "@/types";
import { buildRouteSegmentSpatialIndex, computePOIRouteAssociation } from "@/utils/geo";
import { getMaxPoiCorridorWidthM, getPoiCategoryCorridorWidthM } from "@/constants";
import type { ClassifiedPOI } from "./poiClassifier";

/** Associate classified POIs with route distance and filter by category-specific corridor. */
export function associateAndFilterPOIs(
  classified: ClassifiedPOI[],
  routeId: string,
  routePoints: RoutePoint[],
  corridorWidthM: number,
  source: POISource,
): POI[] {
  const pois: POI[] = [];
  const routeIndex = buildRouteSegmentSpatialIndex(
    routePoints,
    getMaxPoiCorridorWidthM(corridorWidthM),
  );
  for (const c of classified) {
    const assoc = computePOIRouteAssociation(c.latitude, c.longitude, routePoints, routeIndex);
    if (assoc.distanceFromRouteMeters > getPoiCategoryCorridorWidthM(c.category, corridorWidthM)) {
      continue;
    }
    pois.push({
      id: `${routeId}_${c.sourceId}`,
      sourceId: c.sourceId,
      source,
      name: c.name,
      category: c.category,
      latitude: c.latitude,
      longitude: c.longitude,
      tags: c.tags,
      distanceFromRouteMeters: assoc.distanceFromRouteMeters,
      distanceAlongRouteMeters: assoc.distanceAlongRouteMeters,
      routeId,
    });
  }
  return pois;
}
