import Constants from "expo-constants";
import type { RoutePoint, POICategory } from "@/types";
import { GOOGLE_POI_DISCOVERY_CATEGORIES } from "@/constants";
import { downsampleRoutePointsByDistance, splitRoutePointsByDistance } from "@/utils/geo";
import type { ClassifiedPOI } from "./poiClassifier";

const BUNDLE_ID = Constants.expoConfig?.ios?.bundleIdentifier ?? "";

// --- Google Places API response types ---

interface OpeningHoursPeriod {
  open: { day: number; hour: number; minute: number };
  close?: { day: number; hour: number; minute: number };
}

export interface GooglePlace {
  id: string;
  displayName?: { text: string; languageCode?: string };
  location: { latitude: number; longitude: number };
  types: string[];
  regularOpeningHours?: { periods: OpeningHoursPeriod[] };
  currentOpeningHours?: { periods: OpeningHoursPeriod[] };
  formattedAddress?: string;
  nationalPhoneNumber?: string;
  googleMapsUri?: string;
  websiteUri?: string;
}

interface TextSearchResponse {
  places?: GooglePlace[];
  nextPageToken?: string;
}

// --- Encoded polyline ---

/** Encode an array of lat/lng points into a Google encoded polyline string */
function encodePolyline(points: { latitude: number; longitude: number }[]): string {
  let prevLat = 0;
  let prevLng = 0;
  let result = "";

  for (const pt of points) {
    const lat = Math.round(pt.latitude * 1e5);
    const lng = Math.round(pt.longitude * 1e5);
    result += encodeSignedValue(lat - prevLat);
    result += encodeSignedValue(lng - prevLng);
    prevLat = lat;
    prevLng = lng;
  }

  return result;
}

function encodeSignedValue(value: number): string {
  let v = value < 0 ? ~(value << 1) : value << 1;
  let encoded = "";
  while (v >= 0x20) {
    encoded += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
    v >>= 5;
  }
  encoded += String.fromCharCode(v + 63);
  return encoded;
}

// --- Tags ---

export function buildGooglePlaceTags(place: GooglePlace): Record<string, string> {
  const tags: Record<string, string> = {};

  const periods = place.currentOpeningHours?.periods ?? place.regularOpeningHours?.periods;
  if (periods?.length) {
    tags.opening_hours = JSON.stringify(periods);
  }

  if (place.formattedAddress) {
    tags.formatted_address = place.formattedAddress;
  }

  if (place.nationalPhoneNumber) {
    tags.phone = place.nationalPhoneNumber;
  }

  if (place.googleMapsUri) {
    tags.google_maps_url = place.googleMapsUri;
  }

  if (place.websiteUri) {
    tags.website = place.websiteUri;
  }

  tags.google_place_id = place.id;

  return tags;
}

export function inferPOICategoryFromGoogleTypes(types: string[]): POICategory {
  const t = new Set(types);
  if (t.has("gas_station")) return "gas_station";
  if (
    t.has("grocery_store") ||
    t.has("supermarket") ||
    t.has("convenience_store") ||
    t.has("food_store")
  ) {
    return "groceries";
  }
  if (t.has("bakery")) return "bakery";
  if (t.has("cafe") || t.has("coffee_shop")) return "coffee";
  if (
    t.has("restaurant") ||
    t.has("meal_takeaway") ||
    t.has("fast_food_restaurant") ||
    t.has("pizza_restaurant")
  ) {
    return "restaurant";
  }
  if (t.has("bar") || t.has("pub") || t.has("wine_bar")) return "bar_pub";
  if (t.has("drinking_water")) return "water";
  if (t.has("public_bathroom") || t.has("restroom")) return "toilet_shower";
  if (t.has("campground") || t.has("rv_park")) return "camp_site";
  if (t.has("lodging")) return "shelter";
  if (t.has("pharmacy") || t.has("drugstore")) return "pharmacy";
  if (t.has("hospital") || t.has("emergency_room")) return "hospital_er";
  if (t.has("bicycle_store")) return "bike_shop";
  if (t.has("train_station") || t.has("transit_station") || t.has("subway_station")) {
    return "train_station";
  }
  if (t.has("school")) return "school";
  if (t.has("athletic_field") || t.has("fitness_center") || t.has("gym")) return "sports";
  return "other";
}

// --- API call ---

const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.location",
  "places.types",
  "places.regularOpeningHours",
  "places.currentOpeningHours",
  "places.formattedAddress",
  "places.nationalPhoneNumber",
  "places.googleMapsUri",
  "places.websiteUri",
  "nextPageToken",
].join(",");

const DETAILS_FIELD_MASK = [
  "id",
  "displayName",
  "location",
  "types",
  "regularOpeningHours",
  "currentOpeningHours",
  "formattedAddress",
  "nationalPhoneNumber",
  "googleMapsUri",
  "websiteUri",
].join(",");

const SEARCHES: { textQuery: string; includedType?: string; category: POICategory }[] = [
  { textQuery: "gas station", includedType: "gas_station", category: "gas_station" },
  { textQuery: "grocery store", category: "groceries" },
  { textQuery: "bakery", category: "bakery" },
  { textQuery: "cafe", includedType: "cafe", category: "coffee" },
  { textQuery: "restaurant", includedType: "restaurant", category: "restaurant" },
  { textQuery: "bar or pub", includedType: "bar", category: "bar_pub" },
  { textQuery: "pharmacy", includedType: "pharmacy", category: "pharmacy" },
  { textQuery: "bicycle shop", category: "bike_shop" },
];

function googlePlacesHeaders(apiKey: string, fieldMask: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-Goog-Api-Key": apiKey,
    "X-Goog-FieldMask": fieldMask,
    ...(BUNDLE_ID ? { "X-Ios-Bundle-Identifier": BUNDLE_ID } : {}),
  };
}

/** Fetch all pages of a Text Search Along Route query (max 60 results) */
async function searchAlongRoute(
  textQuery: string,
  includedType: string | undefined,
  encodedPolyline: string,
  apiKey: string,
): Promise<GooglePlace[]> {
  const allPlaces: GooglePlace[] = [];
  let pageToken: string | undefined;

  do {
    const body: Record<string, unknown> = {
      textQuery,
      ...(includedType && { includedType }),
      searchAlongRouteParameters: {
        polyline: { encodedPolyline },
      },
      pageSize: 20,
    };
    if (pageToken) body.pageToken = pageToken;

    const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: googlePlacesHeaders(apiKey, FIELD_MASK),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Google Places API error (${response.status}): ${text}`);
    }

    const data: TextSearchResponse = await response.json();
    if (data.places) allPlaces.push(...data.places);
    pageToken = data.nextPageToken;

    // Small delay before fetching next page
    if (pageToken) {
      await new Promise((r) => {
        setTimeout(r, 200);
      });
    }
  } while (pageToken);

  return allPlaces;
}

export async function fetchGooglePlaceDetails(
  placeId: string,
  apiKey: string,
): Promise<GooglePlace> {
  const response = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
    method: "GET",
    headers: googlePlacesHeaders(apiKey, DETAILS_FIELD_MASK),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Google Place Details API error (${response.status}): ${text}`);
  }

  return (await response.json()) as GooglePlace;
}

export async function fetchGooglePlaceTextSearch(
  textQuery: string,
  apiKey: string,
): Promise<GooglePlace | null> {
  const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: googlePlacesHeaders(apiKey, FIELD_MASK),
    body: JSON.stringify({ textQuery, pageSize: 1 }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Google Places API error (${response.status}): ${text}`);
  }

  const data: TextSearchResponse = await response.json();
  return data.places?.[0] ?? null;
}

// --- Route segmentation ---

const MAX_SEGMENT_M = 50_000;
const POLYLINE_POINT_INTERVAL_M = 1_000;

function samePolylinePoint(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): boolean {
  return a.latitude === b.latitude && a.longitude === b.longitude;
}

// --- Main orchestrator ---

export async function fetchGooglePlacesPOIs(
  routePoints: RoutePoint[],
  apiKey: string,
  discoveryCategories: POICategory[] = GOOGLE_POI_DISCOVERY_CATEGORIES,
  onProgress?: (done: number, total: number) => void,
): Promise<ClassifiedPOI[]> {
  const enabled = new Set(discoveryCategories);
  const searches = SEARCHES.filter((search) => enabled.has(search.category));
  if (searches.length === 0 || routePoints.length === 0) {
    onProgress?.(0, 0);
    return [];
  }

  const segments = splitRoutePointsByDistance(routePoints, {
    maxSegmentLengthMeters: MAX_SEGMENT_M,
    balanceSegments: true,
    includeShortRoute: true,
  });
  const totalSteps = segments.length * searches.length;
  let step = 0;

  const seen = new Set<string>();
  const results: ClassifiedPOI[] = [];

  for (const segment of segments) {
    const downsampled = downsampleRoutePointsByDistance(segment, {
      intervalMeters: POLYLINE_POINT_INTERVAL_M,
      mapPoint: (point) => ({ latitude: point.latitude, longitude: point.longitude }),
      isSameOutput: samePolylinePoint,
    });
    const encodedPolyline = encodePolyline(downsampled);

    onProgress?.(step, totalSteps);

    // Run all search types in parallel within each segment
    const searchResults = await Promise.all(
      searches.map((search) =>
        searchAlongRoute(search.textQuery, search.includedType, encodedPolyline, apiKey).then(
          (places) => ({ places, category: search.category }),
        ),
      ),
    );

    for (const { places, category } of searchResults) {
      for (const place of places) {
        if (seen.has(place.id)) continue;
        seen.add(place.id);

        results.push({
          sourceId: place.id,
          name: place.displayName?.text ?? null,
          category,
          latitude: place.location.latitude,
          longitude: place.location.longitude,
          tags: buildGooglePlaceTags(place),
        });
      }
    }

    step += searches.length;
  }

  onProgress?.(totalSteps, totalSteps);
  return results;
}
