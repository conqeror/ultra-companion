import type { DisplayDistanceMeters, DisplayPOI, ETAResult } from "@/types";

export const PLANNED_STOP_DURATION_MINUTES_TAG = "planned_stop_duration_minutes";

export interface PlannedStop {
  poiId: string;
  distanceMeters: DisplayDistanceMeters;
  durationSeconds: number;
}

export function getPlannedStopDurationMinutes(
  poiOrTags: Pick<DisplayPOI, "tags"> | Record<string, string>,
): number {
  const maybeTags = (poiOrTags as { tags?: unknown }).tags;
  const tags =
    maybeTags != null && typeof maybeTags === "object"
      ? (maybeTags as Record<string, string>)
      : (poiOrTags as Record<string, string>);
  const raw = tags[PLANNED_STOP_DURATION_MINUTES_TAG];
  if (!raw) return 0;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return 0;
  return parsed;
}

export function setPlannedStopDurationTag(
  tags: Record<string, string>,
  durationMinutes: number,
): Record<string, string> {
  const next = { ...tags };
  const normalized = Math.max(0, Math.round(durationMinutes));
  if (normalized > 0) {
    next[PLANNED_STOP_DURATION_MINUTES_TAG] = String(normalized);
  } else {
    delete next[PLANNED_STOP_DURATION_MINUTES_TAG];
  }
  return next;
}

export function plannedStopsFromPOIs(pois: DisplayPOI[]): PlannedStop[] {
  return pois
    .map((poi) => {
      const durationMinutes = getPlannedStopDurationMinutes(poi);
      if (durationMinutes <= 0) return null;
      return {
        poiId: poi.id,
        distanceMeters: poi.effectiveDistanceMeters,
        durationSeconds: durationMinutes * 60,
      };
    })
    .filter((stop): stop is PlannedStop => stop != null)
    .sort((a, b) => a.distanceMeters - b.distanceMeters);
}

export function plannedStopOffsetSecondsBeforeDistance(
  plannedStops: readonly PlannedStop[] | null | undefined,
  currentDistanceMeters: number,
  targetDistanceMeters: number,
): number {
  if (!plannedStops?.length || targetDistanceMeters <= currentDistanceMeters) return 0;
  let totalSeconds = 0;
  for (const stop of plannedStops) {
    if (stop.distanceMeters <= currentDistanceMeters) continue;
    if (stop.distanceMeters >= targetDistanceMeters) continue;
    totalSeconds += stop.durationSeconds;
  }
  return totalSeconds;
}

export function applyPlannedStopOffsetToETA(
  eta: ETAResult | null,
  offsetSeconds: number,
  etaStartTimeMs?: number | null,
): ETAResult | null {
  if (!eta || offsetSeconds <= 0) return eta;
  const ridingTimeSeconds = eta.ridingTimeSeconds + offsetSeconds;
  return {
    ...eta,
    ridingTimeSeconds,
    eta:
      etaStartTimeMs != null
        ? new Date(etaStartTimeMs + ridingTimeSeconds * 1000)
        : new Date(eta.eta.getTime() + offsetSeconds * 1000),
  };
}

export function departureTimeAfterPlannedStop(
  eta: ETAResult | null,
  durationMinutes: number,
): Date | null {
  if (!eta || durationMinutes <= 0) return null;
  return new Date(eta.eta.getTime() + durationMinutes * 60_000);
}
