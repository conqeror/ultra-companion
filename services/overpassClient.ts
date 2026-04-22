import type { RoutePoint } from "@/types";
import { OVERPASS_API_URLS, OVERPASS_SEGMENT_LENGTH_M, OVERPASS_RETRY_DELAYS } from "@/constants";

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

// --- Route downsampling for queries ---

/** Downsample route points to ~1 point per intervalM meters */
function downsampleByDistance(
  points: RoutePoint[],
  intervalM: number,
): { lat: number; lon: number }[] {
  if (points.length === 0) return [];

  const result: { lat: number; lon: number }[] = [
    { lat: points[0].latitude, lon: points[0].longitude },
  ];
  let lastDist = points[0].distanceFromStartMeters;

  for (let i = 1; i < points.length; i++) {
    if (points[i].distanceFromStartMeters - lastDist >= intervalM) {
      result.push({ lat: points[i].latitude, lon: points[i].longitude });
      lastDist = points[i].distanceFromStartMeters;
    }
  }

  // Always include the last point
  const last = points[points.length - 1];
  const lastResult = result[result.length - 1];
  if (last.latitude !== lastResult.lat || last.longitude !== lastResult.lon) {
    result.push({ lat: last.latitude, lon: last.longitude });
  }

  return result;
}

/** Split route points into segments of approximately segmentLengthM */
function segmentRoute(points: RoutePoint[], segmentLengthM: number): RoutePoint[][] {
  if (points.length === 0) return [];

  const segments: RoutePoint[][] = [];
  let segStart = 0;
  let segStartDist = points[0].distanceFromStartMeters;

  for (let i = 1; i < points.length; i++) {
    if (points[i].distanceFromStartMeters - segStartDist >= segmentLengthM) {
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
  const segments = segmentRoute(routePoints, OVERPASS_SEGMENT_LENGTH_M);
  const allElements: OverpassElement[] = [];
  const seen = new Set<number>(); // deduplicate by OSM id

  for (let i = 0; i < segments.length; i++) {
    onProgress?.(i, segments.length);

    // Downsample segment points to ~1 per km for the query
    const downsampled = downsampleByDistance(segments[i], 1000);
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
