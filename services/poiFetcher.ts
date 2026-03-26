import type { POI, RoutePoint } from "@/types";
import { fetchAllPOIs } from "./overpassClient";
import { mapOverpassToPOIs } from "./poiClassifier";
import { computePOIRouteAssociation } from "@/utils/geo";
import { insertPOIs, deletePOIsForRoute } from "@/db/database";

/**
 * Full POI fetch pipeline: fetch from Overpass → classify → associate with route → store.
 * Returns the number of POIs stored.
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
  const pois: POI[] = [];
  for (const c of classified) {
    const assoc = computePOIRouteAssociation(
      c.latitude,
      c.longitude,
      routePoints,
    );

    // Skip POIs outside the corridor (Overpass around is approximate for ways)
    if (assoc.distanceFromRouteMeters > corridorWidthM) continue;

    pois.push({
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
    });
  }

  // 4. Store: delete old, insert new
  onProgress?.("Storing", 0, 1);
  await deletePOIsForRoute(routeId);
  await insertPOIs(pois);
  onProgress?.("Done", 1, 1);

  return pois.length;
}
