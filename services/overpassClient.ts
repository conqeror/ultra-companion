import type { POICategory, RoutePoint } from "@/types";
import {
  OSM_POI_DISCOVERY_CATEGORIES,
  getPoiCategoryCorridorWidthM,
  OVERPASS_API_URLS,
  OVERPASS_REQUEST_TIMEOUT_MS,
  OVERPASS_SEGMENT_LENGTH_M,
  OVERPASS_RETRY_DELAYS,
  OVERPASS_USER_AGENT,
} from "@/constants";
import { splitRoutePointsByDistance } from "@/utils/geo";

let nextServerIndex = 0;

/** Get the next Overpass server URL (round-robin) */
function nextServerUrl(): string {
  const url = OVERPASS_API_URLS[nextServerIndex % OVERPASS_API_URLS.length];
  nextServerIndex++;
  return url;
}

// --- Raw Overpass types ---

export interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  geometry?: { lat: number; lon: number }[];
  members?: Array<{
    type: "node" | "way" | "relation";
    ref: number;
    role?: string;
    geometry?: { lat: number; lon: number }[];
  }>;
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements: OverpassElement[];
}

const METERS_PER_DEGREE_LAT = 111_320;
const MIN_LON_COSINE = 0.1;

function formatCoord(value: number): string {
  return value.toFixed(6).replace(/\.?0+$/, "");
}

// --- Overpass QL query building ---

function maxCorridorWidthForCategories(
  discoveryCategories: POICategory[],
  fallbackWidthM: number,
): number {
  return Math.max(
    ...discoveryCategories.map((category) =>
      getPoiCategoryCorridorWidthM(category, fallbackWidthM),
    ),
  );
}

function buildPaddedBounds(
  points: { lat: number; lon: number }[],
  paddingMeters: number,
): { south: number; west: number; north: number; east: number } {
  let south = points[0].lat;
  let north = points[0].lat;
  let west = points[0].lon;
  let east = points[0].lon;

  for (const point of points) {
    south = Math.min(south, point.lat);
    north = Math.max(north, point.lat);
    west = Math.min(west, point.lon);
    east = Math.max(east, point.lon);
  }

  const centerLatRad = (((south + north) / 2) * Math.PI) / 180;
  const latPadding = paddingMeters / METERS_PER_DEGREE_LAT;
  const lonPadding =
    paddingMeters / (METERS_PER_DEGREE_LAT * Math.max(Math.cos(centerLatRad), MIN_LON_COSINE));

  return {
    south: Math.max(-90, south - latPadding),
    west: Math.max(-180, west - lonPadding),
    north: Math.min(90, north + latPadding),
    east: Math.min(180, east + lonPadding),
  };
}

/** Build a complete Overpass QL query for all POI categories in a corridor */
export function buildOverpassQuery(
  points: { lat: number; lon: number }[],
  corridorWidthM: number,
  discoveryCategories: POICategory[] = OSM_POI_DISCOVERY_CATEGORIES,
): string | null {
  if (points.length === 0) return null;

  const enabled = new Set(discoveryCategories);
  const q = (category: POICategory, selector: string) => {
    if (!enabled.has(category)) return null;
    return `  ${selector};`;
  };

  const clauses = [
    q("water", 'node["amenity"="drinking_water"]'),
    q("water", 'node["natural"="spring"]'),
    q("water", 'node["man_made"="water_tap"]'),
    q("toilet_shower", 'node["amenity"~"^(toilets|shower)$"]'),
    q("shelter", 'node["amenity"="shelter"]["shelter_type"!="public_transport"]'),
    q("shelter", 'way["amenity"="shelter"]["shelter_type"!="public_transport"]'),
    q("shelter", 'node["tourism"="wilderness_hut"]'),
    q("shelter", 'way["tourism"="wilderness_hut"]'),
    q("shelter", 'node["tourism"="alpine_hut"]'),
    q("shelter", 'way["tourism"="alpine_hut"]'),
    q("camp_site", 'node["tourism"="camp_site"]'),
    q("camp_site", 'way["tourism"="camp_site"]'),
    q("pharmacy", 'node["amenity"="pharmacy"]'),
    q("pharmacy", 'way["amenity"="pharmacy"]'),
    q("pharmacy", 'node["healthcare"="pharmacy"]'),
    q("pharmacy", 'way["healthcare"="pharmacy"]'),
    q("bike_shop", 'node["shop"="bicycle"]'),
    q("bike_shop", 'way["shop"="bicycle"]'),
    q("repair_station", 'node["amenity"="bicycle_repair_station"]'),
    q("pump_air", 'node["amenity"="compressed_air"]'),
    q("pump_air", 'node["service:bicycle:pump"="yes"]'),
    q("pump_air", 'way["service:bicycle:pump"="yes"]'),
  ].filter((clause): clause is string => clause != null);

  if (clauses.length === 0) return null;

  const paddingMeters = maxCorridorWidthForCategories(discoveryCategories, corridorWidthM);
  const bounds = buildPaddedBounds(points, paddingMeters);
  const bbox = [
    formatCoord(bounds.south),
    formatCoord(bounds.west),
    formatCoord(bounds.north),
    formatCoord(bounds.east),
  ].join(",");

  return `[out:json][timeout:30][bbox:${bbox}];
(
${clauses.join("\n")}
);
out center body;`;
}

// --- Fetching ---

/** Try a single Overpass request against a specific server */
async function tryOverpassRequest(
  url: string,
  query: string,
): Promise<{ elements: OverpassElement[] } | { rateLimited: true } | { error: Error }> {
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => {
    abortController.abort();
  }, OVERPASS_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": OVERPASS_USER_AGENT,
      },
      body: `data=${encodeURIComponent(query)}`,
      signal: abortController.signal,
    });

    if (response.status === 400) {
      return { error: new Error(`Overpass bad query (400): ${await response.text()}`) };
    }

    if (response.status === 429 || response.status === 504) {
      return { rateLimited: true };
    }

    if (!response.ok) {
      return { error: new Error(`Overpass error (${response.status})`) };
    }

    const data: OverpassResponse = await response.json();
    return { elements: data.elements };
  } catch (error) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  } finally {
    clearTimeout(timeoutId);
  }
}

/** Fetch a single Overpass query with server rotation and exponential backoff */
async function fetchOverpassSegment(query: string): Promise<OverpassElement[]> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= OVERPASS_RETRY_DELAYS.length; attempt++) {
    // On each attempt, try all servers before giving up
    for (let s = 0; s < OVERPASS_API_URLS.length; s++) {
      const url = nextServerUrl();
      const result = await tryOverpassRequest(url, query);

      if ("elements" in result) return result.elements;
      if ("error" in result) {
        lastError = result.error;
        // Don't retry bad queries on other servers
        if (result.error.message.includes("400")) throw result.error;
      }
      // rateLimited — try next server immediately
    }

    // All servers failed this round — wait before retrying
    if (attempt < OVERPASS_RETRY_DELAYS.length) {
      await delay(OVERPASS_RETRY_DELAYS[attempt]);
    }
  }

  throw lastError ?? new Error("Overpass fetch failed");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

// --- Main orchestrator ---

export async function fetchAllPOIs(
  routePoints: RoutePoint[],
  corridorWidthM: number,
  discoveryCategories: POICategory[] = OSM_POI_DISCOVERY_CATEGORIES,
  onProgress?: (done: number, total: number) => void,
): Promise<OverpassElement[]> {
  if (routePoints.length === 0) return [];
  if (discoveryCategories.length === 0) {
    onProgress?.(0, 0);
    return [];
  }

  const segments = splitRoutePointsByDistance(routePoints, {
    maxSegmentLengthMeters: OVERPASS_SEGMENT_LENGTH_M,
    includeShortRoute: true,
  });
  const allElements: OverpassElement[] = [];
  const seen = new Set<string>(); // deduplicate by OSM type/id

  for (let i = 0; i < segments.length; i++) {
    onProgress?.(i, segments.length);

    const query = buildOverpassQuery(
      segments[i].map((point) => ({ lat: point.latitude, lon: point.longitude })),
      corridorWidthM,
      discoveryCategories,
    );
    if (!query) continue;
    const elements = await fetchOverpassSegment(query);

    for (const el of elements) {
      const key = `${el.type}/${el.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        allElements.push(el);
      }
    }

    // Rate-limit: 1s between segment requests
    if (i < segments.length - 1) {
      await delay(1000);
    }
  }

  onProgress?.(segments.length, segments.length);
  return allElements;
}
