import Constants from "expo-constants";
import type { POI, POISource, RoutePoint } from "@/types";
import { fetchAllPOIs } from "./overpassClient";
import { mapOverpassToPOIs, type ClassifiedPOI } from "./poiClassifier";
import { fetchGooglePlacesPOIs } from "./googlePlacesClient";
import { computePOIRouteAssociation } from "@/utils/geo";
import {
  insertPOIs,
  deletePOIsBySource,
} from "@/db/database";

/** Associate classified POIs with route and filter by corridor */
function associateAndFilter(
  classified: ClassifiedPOI[],
  routeId: string,
  routePoints: RoutePoint[],
  corridorWidthM: number,
  source: POISource,
): POI[] {
  const pois: POI[] = [];
  for (const c of classified) {
    const assoc = computePOIRouteAssociation(c.latitude, c.longitude, routePoints);
    if (assoc.distanceFromRouteMeters > corridorWidthM) continue;
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
      nearestRouteId: routeId,
    });
  }
  return pois;
}

/** Fetch OSM POIs only (water, bike_shop, atm, pharmacy, toilet_shower, shelter) */
export async function fetchOsmPOIs(
  routeId: string,
  routePoints: RoutePoint[],
  corridorWidthM: number,
  onProgress?: (phase: string, done: number, total: number) => void,
): Promise<number> {
  const elements = await fetchAllPOIs(routePoints, corridorWidthM, (done, total) => {
    onProgress?.("Fetching", done, total);
  });
  const classified = mapOverpassToPOIs(elements);
  onProgress?.("Processing", 0, 1);
  const pois = associateAndFilter(classified, routeId, routePoints, corridorWidthM, "osm");
  await deletePOIsBySource(routeId, "osm");
  await insertPOIs(pois);
  onProgress?.("Done", 1, 1);
  return pois.length;
}

/** Fetch Google Places POIs only (gas_station, groceries) */
export async function fetchGooglePOIs(
  routeId: string,
  routePoints: RoutePoint[],
  corridorWidthM: number,
  onProgress?: (phase: string, done: number, total: number) => void,
): Promise<number> {
  const apiKey = Constants.expoConfig?.extra?.googlePlacesApiKey as string | undefined;
  if (!apiKey) throw new Error("Google Places API key not configured");

  const classified = await fetchGooglePlacesPOIs(routePoints, apiKey, (done, total) => {
    onProgress?.("Fetching", done, total);
  });
  onProgress?.("Processing", 0, 1);
  const pois = associateAndFilter(classified, routeId, routePoints, corridorWidthM, "google");
  await deletePOIsBySource(routeId, "google");
  await insertPOIs(pois);
  onProgress?.("Done", 1, 1);
  return pois.length;
}

/**
 * Full POI fetch pipeline (both sources).
 * Used by offline download to ensure all POIs exist.
 */
export async function fetchAndStorePOIs(
  routeId: string,
  routePoints: RoutePoint[],
  corridorWidthM: number,
  onProgress?: (phase: string, done: number, total: number) => void,
): Promise<number> {
  const elements = await fetchAllPOIs(routePoints, corridorWidthM, (done, total) => {
    onProgress?.("Fetching", done, total);
  });
  const osmClassified = mapOverpassToPOIs(elements);

  let googleClassified: ClassifiedPOI[] = [];
  const apiKey = Constants.expoConfig?.extra?.googlePlacesApiKey as string | undefined;
  if (apiKey) {
    try {
      googleClassified = await fetchGooglePlacesPOIs(routePoints, apiKey, (done, total) => {
        onProgress?.("Google", done, total);
      });
    } catch (error) {
      console.warn("Google Places fetch failed, continuing with OSM only:", error);
    }
  }

  onProgress?.("Processing", 0, 1);
  const allOsm = associateAndFilter(osmClassified, routeId, routePoints, corridorWidthM, "osm");
  const allGoogle = associateAndFilter(googleClassified, routeId, routePoints, corridorWidthM, "google");

  // Use source-scoped deletes so a Google failure doesn't wipe existing Google data
  await deletePOIsBySource(routeId, "osm");
  if (allGoogle.length > 0 || googleClassified.length === 0) {
    // Only clear Google POIs if we got fresh results or didn't attempt Google fetch
    await deletePOIsBySource(routeId, "google");
  }
  const pois = [...allOsm, ...allGoogle];
  await insertPOIs(pois);
  onProgress?.("Done", 1, 1);
  return pois.length;
}
