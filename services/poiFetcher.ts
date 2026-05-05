import Constants from "expo-constants";
import type { POI, POICategory, POISource, RoutePoint } from "@/types";
import { fetchAllPOIs } from "./overpassClient";
import { mapOverpassToPOIs, type ClassifiedPOI } from "./poiClassifier";
import { fetchGooglePlacesPOIs } from "./googlePlacesClient";
import { buildRouteSegmentSpatialIndex, computePOIRouteAssociation } from "@/utils/geo";
import { insertPOIs, deletePOIsBySource } from "@/db/database";
import {
  getMaxPoiCorridorWidthM,
  getPoiCategoryCorridorWidthM,
  poiDiscoveryCategoriesForSource,
} from "@/constants";

/** Associate classified POIs with route and filter by corridor */
export function associateAndFilter(
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
  const pois = associateAndFilter(classified, routeId, routePoints, corridorWidthM, "osm");
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

  const categories = discoveryCategories
    ? poiDiscoveryCategoriesForSource(discoveryCategories, "google")
    : undefined;
  const classified = await fetchGooglePlacesPOIs(routePoints, apiKey, categories, (done, total) => {
    onProgress?.("Fetching", done, total);
  });
  onProgress?.("Processing", 0, 1);
  const pois = associateAndFilter(classified, routeId, routePoints, corridorWidthM, "google");
  await deletePOIsBySource(routeId, "google");
  await insertPOIs(pois);
  onProgress?.("Done", 1, 1);
  return pois.length;
}
