import Constants from "expo-constants";
import type { POICategory, RoutePoint } from "@/types";
import { fetchAllPOIs } from "./overpassClient";
import { mapOverpassToPOIs } from "./poiClassifier";
import { fetchGooglePlacesPOIs } from "./googlePlacesClient";
import { insertPOIs, deletePOIsBySource } from "@/db/database";
import { poiDiscoveryCategoriesForSource } from "@/constants";
import { associateAndFilterPOIs } from "@/services/poiAssociation";

export { associateAndFilterPOIs as associateAndFilter } from "@/services/poiAssociation";

/** Fetch OSM POIs only */
export async function fetchOsmPOIs(
  routeId: string,
  routePoints: RoutePoint[],
  corridorWidthM: number,
  onProgress?: (phase: string, done: number, total: number) => void,
  discoveryCategories?: POICategory[],
): Promise<number> {
  const categories = discoveryCategories
    ? poiDiscoveryCategoriesForSource(discoveryCategories, "osm")
    : undefined;
  const elements = await fetchAllPOIs(routePoints, corridorWidthM, categories, (done, total) => {
    onProgress?.("Fetching", done, total);
  });
  const enabled = categories ? new Set(categories) : null;
  const classified = mapOverpassToPOIs(elements).filter(
    (poi) => !enabled || enabled.has(poi.category),
  );
  onProgress?.("Processing", 0, 1);
  const pois = associateAndFilterPOIs(classified, routeId, routePoints, corridorWidthM, "osm");
  await deletePOIsBySource(routeId, "osm");
  await insertPOIs(pois);
  onProgress?.("Done", 1, 1);
  return pois.length;
}

/** Fetch Google Places POIs only */
export async function fetchGooglePOIs(
  routeId: string,
  routePoints: RoutePoint[],
  corridorWidthM: number,
  onProgress?: (phase: string, done: number, total: number) => void,
  discoveryCategories?: POICategory[],
): Promise<number> {
  const apiKey = Constants.expoConfig?.extra?.googlePlacesApiKey as string | undefined;
  if (!apiKey) throw new Error("Google Places API key not configured");
  const bundleId = Constants.expoConfig?.ios?.bundleIdentifier;

  const categories = discoveryCategories
    ? poiDiscoveryCategoriesForSource(discoveryCategories, "google")
    : undefined;
  const classified = await fetchGooglePlacesPOIs(
    routePoints,
    apiKey,
    categories,
    (done, total) => {
      onProgress?.("Fetching", done, total);
    },
    { bundleId },
  );
  onProgress?.("Processing", 0, 1);
  const pois = associateAndFilterPOIs(classified, routeId, routePoints, corridorWidthM, "google");
  await deletePOIsBySource(routeId, "google");
  await insertPOIs(pois);
  onProgress?.("Done", 1, 1);
  return pois.length;
}
