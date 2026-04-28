import {
  downloadTileRegion,
  cancelTileRegion,
  deleteTileRegion,
  getTileRegionSize,
  getAllTileRegions,
  addProgressListener,
} from "@/modules/offline-tiles";
import type { RoutePoint } from "@/types";
import { MAP_STYLE_URL } from "@/types";
import { downsampleRoutePointsByDistance } from "@/utils/geo";
import {
  OFFLINE_MIN_ZOOM,
  OFFLINE_MAX_ZOOM,
  OFFLINE_PACK_PREFIX,
  TILE_DOWNLOAD_STALL_MS,
} from "@/constants";

function packId(routeId: string): string {
  return `${OFFLINE_PACK_PREFIX}${routeId}`;
}

function extractRouteId(id: string): string | null {
  if (!id.startsWith(OFFLINE_PACK_PREFIX)) return null;
  return id.slice(OFFLINE_PACK_PREFIX.length);
}

const TILE_ROUTE_POINT_INTERVAL_M = 200;

/**
 * Estimate download size based on route length.
 * Rough heuristic: ~0.5 MB per km at zoom 10-14 for a LineString corridor.
 */
export function estimateDownloadSize(points: RoutePoint[]): number {
  if (points.length === 0) return 0;
  const routeLengthKm = points[points.length - 1].distanceFromStartMeters / 1000;
  const bytesPerKm = 500_000; // ~0.5 MB/km — empirical estimate for vector tiles
  return Math.round(routeLengthKm * bytesPerKm);
}

/** Download tiles along a route using LineString geometry */
export async function downloadRouteTiles(
  routeId: string,
  points: RoutePoint[],
  onProgress: (percentage: number, completedBytes: number) => void,
  onComplete: () => void,
  onError: (error: string) => void,
): Promise<void> {
  const id = packId(routeId);
  const styleURL = MAP_STYLE_URL;
  const coords = downsampleRoutePointsByDistance(points, {
    intervalMeters: TILE_ROUTE_POINT_INTERVAL_M,
    mapPoint: (point) => [point.longitude, point.latitude],
  });

  if (coords.length < 2) {
    onError("Route too short for offline download");
    return;
  }

  // Clean up any stale region from a previous attempt so Mapbox starts fresh
  try {
    await deleteTileRegion(id);
  } catch {}

  let stalled = false;
  let stallTimer: ReturnType<typeof setTimeout> | undefined;
  let lastPercentage = -1;

  function resetStallTimer() {
    clearTimeout(stallTimer);
    stallTimer = setTimeout(() => {
      stalled = true;
      console.warn(`[OfflineTiles] Download stalled for ${id} at ${lastPercentage}%`);
      cancelTileRegion(id);
    }, TILE_DOWNLOAD_STALL_MS);
  }

  const sub = addProgressListener((event) => {
    if (event.id === id) {
      // Only reset stall timer when progress actually advances
      if (event.percentage > lastPercentage) {
        lastPercentage = event.percentage;
        resetStallTimer();
      }
      onProgress(event.percentage, event.completedBytes);
    }
  });

  try {
    console.log(`[OfflineTiles] Starting download for ${id}, ${coords.length} waypoints`);
    resetStallTimer();
    await downloadTileRegion(id, styleURL, coords, OFFLINE_MIN_ZOOM, OFFLINE_MAX_ZOOM);
    clearTimeout(stallTimer);

    if (stalled) {
      throw new Error("Download was cancelled due to stall");
    }

    const actualBytes = await getTileRegionSize(id);
    console.log(`[OfflineTiles] Complete: ${id}, ${actualBytes} bytes`);
    onProgress(100, actualBytes);
    onComplete();
  } catch (e) {
    clearTimeout(stallTimer);
    onError(
      stalled
        ? "Download stalled — please retry"
        : e instanceof Error
          ? e.message
          : "Download failed",
    );
  } finally {
    sub.remove();
  }
}

/** Delete offline data for a route */
export async function deleteRoutePacks(routeId: string): Promise<void> {
  try {
    await deleteTileRegion(packId(routeId));
  } catch {}
}

/** Get all Ultra route regions with sizes */
export async function getAllRoutePacks(): Promise<Array<{ routeId: string; totalBytes: number }>> {
  try {
    const regions = await getAllTileRegions();
    const results: Array<{ routeId: string; totalBytes: number }> = [];

    for (const region of regions) {
      const routeId = extractRouteId(region.id);
      if (routeId) {
        results.push({ routeId, totalBytes: region.completedBytes });
      }
    }

    return results;
  } catch {
    return [];
  }
}
