const OPEN_ELEVATION_URL = "https://api.open-elevation.com/api/v1/lookup";
const BATCH_SIZE = 200;

interface ElevationResult {
  latitude: number;
  longitude: number;
  elevation: number;
}

/**
 * Batch-query elevations for a list of coordinates using the Open-Elevation API.
 * Returns a Map of "lat,lon" → elevation in meters.
 * Silently returns an empty map on failure (elevation filtering is best-effort).
 */
export async function batchLookupElevations(
  coords: { latitude: number; longitude: number }[],
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (coords.length === 0) return result;

  // Process in batches to avoid oversized requests
  for (let i = 0; i < coords.length; i += BATCH_SIZE) {
    const batch = coords.slice(i, i + BATCH_SIZE);
    const locations = batch.map((c) => ({
      latitude: c.latitude,
      longitude: c.longitude,
    }));

    try {
      const response = await fetch(OPEN_ELEVATION_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locations }),
      });

      if (!response.ok) continue;

      const data = (await response.json()) as { results: ElevationResult[] };
      for (const r of data.results) {
        result.set(coordKey(r.latitude, r.longitude), r.elevation);
      }
    } catch {
      // Best-effort: if elevation lookup fails, skip filtering
      continue;
    }
  }

  return result;
}

export function coordKey(lat: number, lon: number): string {
  return `${lat},${lon}`;
}
