import { toDisplayPOIs } from "@/services/displayDistance";
import { stitchPOIs } from "@/services/stitchingService";
import type { DisplayPOI, POI, StitchedSegmentInfo } from "@/types";

export function displayPOIsForActiveRoute(
  routeIds: string[],
  segments: StitchedSegmentInfo[] | null,
  poisByRoute: Record<string, POI[]>,
): DisplayPOI[] {
  if (routeIds.length === 0) return [];
  if (segments) return stitchPOIs(segments, poisByRoute);
  return routeIds.flatMap((routeId) => toDisplayPOIs(poisByRoute[routeId] ?? []));
}
