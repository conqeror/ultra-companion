import { PLANNED_STOP_DURATION_MINUTES_TAG } from "@/services/plannedStops";
import type { POI } from "@/types";

const RIDER_TAGS = ["notes", PLANNED_STOP_DURATION_MINUTES_TAG] as const;

/** Provider refreshes replace provider data while retaining the rider's edits. */
export function preparePOIRefresh(
  routeId: string,
  source: "osm" | "google",
  existing: readonly POI[],
  incoming: readonly POI[],
): POI[] {
  const previousBySourceId = new Map(existing.map((poi) => [poi.sourceId, poi]));
  return incoming.map((poi) => {
    if (poi.routeId !== routeId || poi.source !== source) {
      throw new Error("Refreshed POIs must belong to the requested route and source");
    }
    const previous = previousBySourceId.get(poi.sourceId);
    const tags = { ...poi.tags };
    for (const key of RIDER_TAGS) {
      delete tags[key];
      if (previous?.tags[key] != null) tags[key] = previous.tags[key];
    }
    return { ...poi, id: previous?.id ?? poi.id, tags };
  });
}
