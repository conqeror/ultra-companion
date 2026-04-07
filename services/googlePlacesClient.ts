import type { RoutePoint, POICategory } from "@/types";
import type { ClassifiedPOI } from "./poiClassifier";

// --- Google Places API response types ---

interface OpeningHoursPeriod {
  open: { day: number; hour: number; minute: number };
  close?: { day: number; hour: number; minute: number };
}

interface GooglePlace {
  id: string;
  displayName?: { text: string; languageCode?: string };
  location: { latitude: number; longitude: number };
  types: string[];
  regularOpeningHours?: { periods: OpeningHoursPeriod[] };
  currentOpeningHours?: { periods: OpeningHoursPeriod[] };
  formattedAddress?: string;
  nationalPhoneNumber?: string;
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

/** Downsample route to ~1 point per km for a compact polyline */
function downsampleForPolyline(points: RoutePoint[]): { latitude: number; longitude: number }[] {
  if (points.length === 0) return [];

  const result = [{ latitude: points[0].latitude, longitude: points[0].longitude }];
  let lastDist = points[0].distanceFromStartMeters;

  for (let i = 1; i < points.length; i++) {
    if (points[i].distanceFromStartMeters - lastDist >= 1000) {
      result.push({ latitude: points[i].latitude, longitude: points[i].longitude });
      lastDist = points[i].distanceFromStartMeters;
    }
  }

  // Always include last point
  const last = points[points.length - 1];
  const lastResult = result[result.length - 1];
  if (last.latitude !== lastResult.latitude || last.longitude !== lastResult.longitude) {
    result.push({ latitude: last.latitude, longitude: last.longitude });
  }

  return result;
}

// --- Tags ---

function buildTags(place: GooglePlace): Record<string, string> {
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

  return tags;
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
  "nextPageToken",
].join(",");

const SEARCHES: { textQuery: string; includedType?: string; category: POICategory }[] = [
  { textQuery: "gas station", includedType: "gas_station", category: "gas_station" },
  { textQuery: "grocery store", category: "groceries" },
  { textQuery: "bakery", category: "bakery" },
];

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

    const response = await fetch(
      "https://places.googleapis.com/v1/places:searchText",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": FIELD_MASK,
        },
        body: JSON.stringify(body),
      },
    );

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Google Places API error (${response.status}): ${text}`);
    }

    const data: TextSearchResponse = await response.json();
    if (data.places) allPlaces.push(...data.places);
    pageToken = data.nextPageToken;

    // Small delay before fetching next page
    if (pageToken) await new Promise((r) => setTimeout(r, 200));
  } while (pageToken);

  return allPlaces;
}

// --- Route segmentation ---

const MAX_SEGMENT_M = 50_000;

/** Split route points into even segments of at most MAX_SEGMENT_M, with 1-point overlap */
function splitRoute(points: RoutePoint[]): RoutePoint[][] {
  if (points.length < 2) return [points];

  const totalDist = points[points.length - 1].distanceFromStartMeters - points[0].distanceFromStartMeters;
  if (totalDist <= MAX_SEGMENT_M) return [points];

  const numSegments = Math.ceil(totalDist / MAX_SEGMENT_M);
  const segmentLength = totalDist / numSegments;
  const segments: RoutePoint[][] = [];
  let segStart = 0;
  let segStartDist = points[0].distanceFromStartMeters;

  for (let i = 1; i < points.length; i++) {
    if (points[i].distanceFromStartMeters - segStartDist >= segmentLength) {
      segments.push(points.slice(segStart, i + 1)); // overlap by 1 point
      segStart = i;
      segStartDist = points[i].distanceFromStartMeters;
    }
  }

  // Remaining points
  if (segStart < points.length - 1) {
    segments.push(points.slice(segStart));
  }

  return segments;
}

// --- Main orchestrator ---

export async function fetchGooglePlacesPOIs(
  routePoints: RoutePoint[],
  apiKey: string,
  onProgress?: (done: number, total: number) => void,
): Promise<ClassifiedPOI[]> {
  const segments = splitRoute(routePoints);
  const totalSteps = segments.length * SEARCHES.length;
  let step = 0;

  const seen = new Set<string>();
  const results: ClassifiedPOI[] = [];

  for (const segment of segments) {
    const downsampled = downsampleForPolyline(segment);
    const encodedPolyline = encodePolyline(downsampled);

    onProgress?.(step, totalSteps);

    // Run all search types in parallel within each segment
    const searchResults = await Promise.all(
      SEARCHES.map((search) =>
        searchAlongRoute(search.textQuery, search.includedType, encodedPolyline, apiKey)
          .then((places) => ({ places, category: search.category })),
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
          tags: buildTags(place),
        });
      }
    }

    step += SEARCHES.length;
  }

  onProgress?.(totalSteps, totalSteps);
  return results;
}
