import type { RoutePoint } from "@/types";
import { OVERPASS_API_URLS, OVERPASS_SEGMENT_LENGTH_M, OVERPASS_RETRY_DELAYS } from "@/constants";
import { downsampleRoutePointsByDistance, splitRoutePointsByDistance } from "@/utils/geo";

let _nextServerIndex = 0;

/** Get the next Overpass server URL (round-robin) */
function nextServerUrl(): string {
  const url = OVERPASS_API_URLS[_nextServerIndex % OVERPASS_API_URLS.length];
  _nextServerIndex++;
  return url;
}

// --- Raw Overpass types ---

export interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements: OverpassElement[];
}

const QUERY_POINT_INTERVAL_M = 1_000;

function sameQueryPoint(a: { lat: number; lon: number }, b: { lat: number; lon: number }): boolean {
  return a.lat === b.lat && a.lon === b.lon;
}

// --- Overpass QL query building ---

/** Build the coordinate string for an around filter: lat1,lon1,lat2,lon2,... */
function coordString(pts: { lat: number; lon: number }[]): string {
  return pts.map((p) => `${p.lat},${p.lon}`).join(",");
}

/** Build a complete Overpass QL query for all POI categories in a corridor */
export function buildOverpassQuery(
  points: { lat: number; lon: number }[],
  corridorWidthM: number,
): string {
  const coords = coordString(points);
  const r = corridorWidthM;

  // Each line queries one OSM tag pattern using the around filter
  return `[out:json][timeout:30];
(
  node["amenity"="drinking_water"](around:${r},${coords});
  node["natural"="spring"](around:${r},${coords});
  node["man_made"="water_tap"](around:${r},${coords});
  node["amenity"~"^(toilets|shower)$"](around:${r},${coords});
  node["amenity"="shelter"]["shelter_type"!="public_transport"](around:${r},${coords});
  way["amenity"="shelter"]["shelter_type"!="public_transport"](around:${r},${coords});
  node["tourism"="wilderness_hut"](around:${r},${coords});
  way["tourism"="wilderness_hut"](around:${r},${coords});
  node["tourism"="alpine_hut"](around:${r},${coords});
  way["tourism"="alpine_hut"](around:${r},${coords});
);
out center body;`;
}

// --- Fetching ---

/** Try a single Overpass request against a specific server */
async function tryOverpassRequest(
  url: string,
  query: string,
): Promise<{ elements: OverpassElement[] } | { rateLimited: true } | { error: Error }> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(query)}`,
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
  onProgress?: (done: number, total: number) => void,
): Promise<OverpassElement[]> {
  const segments = splitRoutePointsByDistance(routePoints, {
    maxSegmentLengthMeters: OVERPASS_SEGMENT_LENGTH_M,
  });
  const allElements: OverpassElement[] = [];
  const seen = new Set<number>(); // deduplicate by OSM id

  for (let i = 0; i < segments.length; i++) {
    onProgress?.(i, segments.length);

    // Downsample segment points to ~1 per km for the query
    const downsampled = downsampleRoutePointsByDistance(segments[i], {
      intervalMeters: QUERY_POINT_INTERVAL_M,
      mapPoint: (point) => ({ lat: point.latitude, lon: point.longitude }),
      isSameOutput: sameQueryPoint,
    });
    const query = buildOverpassQuery(downsampled, corridorWidthM);
    const elements = await fetchOverpassSegment(query);

    for (const el of elements) {
      if (!seen.has(el.id)) {
        seen.add(el.id);
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
