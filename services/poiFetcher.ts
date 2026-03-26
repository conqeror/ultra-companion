import type { POI, RoutePoint } from "@/types";
import { fetchAllPOIs } from "./overpassClient";
import { mapOverpassToPOIs } from "./poiClassifier";
import { batchLookupElevations, coordKey } from "./elevationLookup";
import { computePOIRouteAssociation } from "@/utils/geo";
import { insertPOIs, deletePOIsForRoute } from "@/db/database";
import { POI_MAX_ELEVATION_DIFF_M } from "@/constants";

/**
 * Full POI fetch pipeline: fetch from Overpass → classify → associate with route →
 * elevation filter → store. Returns the number of POIs stored.
 */
export async function fetchAndStorePOIs(
  routeId: string,
  routePoints: RoutePoint[],
  corridorWidthM: number,
  onProgress?: (phase: string, done: number, total: number) => void,
): Promise<number> {
  // 1. Fetch raw elements from Overpass
  const elements = await fetchAllPOIs(routePoints, corridorWidthM, (done, total) => {
    onProgress?.("Fetching", done, total);
  });

  if (elements.length === 0) {
    await deletePOIsForRoute(routeId);
    return 0;
  }

  // 2. Classify and extract
  onProgress?.("Processing", 0, 1);
  const classified = mapOverpassToPOIs(elements);

  // 3. Compute route associations and filter by corridor
  const candidates: {
    poi: POI;
    nearestIndex: number;
  }[] = [];

  for (const c of classified) {
    const assoc = computePOIRouteAssociation(
      c.latitude,
      c.longitude,
      routePoints,
    );

    // Skip POIs outside the corridor (Overpass around is approximate for ways)
    if (assoc.distanceFromRouteMeters > corridorWidthM) continue;

    candidates.push({
      poi: {
        id: `${routeId}_${c.osmId}`,
        osmId: c.osmId,
        name: c.name,
        category: c.category,
        latitude: c.latitude,
        longitude: c.longitude,
        tags: c.tags,
        distanceFromRouteMeters: assoc.distanceFromRouteMeters,
        distanceAlongRouteMeters: assoc.distanceAlongRouteMeters,
        nearestRouteId: routeId,
      },
      nearestIndex: assoc.nearestIndex,
    });
  }

  const pois = candidates.map((c) => c.poi);

  // 5. Store: delete old, insert new
  onProgress?.("Storing", 0, 1);
  await deletePOIsForRoute(routeId);
  await insertPOIs(pois);
  onProgress?.("Done", 1, 1);

  return pois.length;
}

/**
 * Filter out POIs whose elevation differs from the route by more than the threshold.
 * Uses Open-Elevation API for POI elevations. Falls back to no filtering on API failure.
 */
async function filterByElevation(
  candidates: { poi: POI; nearestIndex: number }[],
  routePoints: RoutePoint[],
): Promise<POI[]> {
  if (candidates.length === 0) return [];

  // Check if route has elevation data at all
  const hasRouteElevation = routePoints.some((p) => p.elevationMeters != null);
  if (!hasRouteElevation) return candidates.map((c) => c.poi);

  // Batch-query POI elevations
  const coords = candidates.map((c) => ({
    latitude: c.poi.latitude,
    longitude: c.poi.longitude,
  }));

  const elevations = await batchLookupElevations(coords);

  // If lookup returned nothing, skip filtering (best-effort)
  if (elevations.size === 0) return candidates.map((c) => c.poi);

  const result: POI[] = [];
  for (const { poi, nearestIndex } of candidates) {
    const poiElev = elevations.get(coordKey(poi.latitude, poi.longitude));
    const routeElev = routePoints[nearestIndex]?.elevationMeters;

    // If we can't determine either elevation, keep the POI
    if (poiElev == null || routeElev == null) {
      result.push(poi);
      continue;
    }

    if (Math.abs(poiElev - routeElev) <= POI_MAX_ELEVATION_DIFF_M) {
      result.push(poi);
    }
  }

  return result;
}
