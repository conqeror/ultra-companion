import type { RoutePoint } from "@/types";

/**
 * Estimate download size using the native heuristic so route screens keep the
 * same rough planning signal, even though Mapbox offline packs are unavailable
 * in the browser.
 */
export function estimateDownloadSize(points: RoutePoint[]): number {
  if (points.length === 0) return 0;
  const routeLengthKm = points[points.length - 1].distanceFromStartMeters / 1000;
  return Math.round(routeLengthKm * 500_000);
}

export async function downloadRouteTiles(
  _routeId: string,
  _points: RoutePoint[],
  _onProgress: (percentage: number, completedBytes: number) => void,
  _onComplete: () => void,
  onError: (error: string) => void,
): Promise<void> {
  onError("Offline tile downloads are not available on web.");
}

export async function deleteRoutePacks(_routeId: string): Promise<void> {}

export async function getAllRoutePacks(): Promise<Array<{ routeId: string; totalBytes: number }>> {
  return [];
}
