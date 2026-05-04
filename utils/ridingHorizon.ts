import type { DisplayClimb, PanelMode } from "@/types";

export interface DistanceWindow {
  startDistanceMeters?: number;
  endDistanceMeters?: number;
}

export function ridingHorizonMetersForMode(mode: PanelMode): number | null {
  switch (mode) {
    case "upcoming-10":
      return 10_000;
    case "upcoming-25":
      return 25_000;
    case "upcoming-50":
      return 50_000;
    case "upcoming-100":
      return 100_000;
    case "upcoming-200":
      return 200_000;
    case "full-route":
      return null;
  }
}

export function ridingHorizonKmLabelForMode(mode: PanelMode): string {
  const meters = ridingHorizonMetersForMode(mode);
  return meters == null ? "FULL" : String(meters / 1_000);
}

export function ridingHorizonLabelForMode(mode: PanelMode): string {
  const meters = ridingHorizonMetersForMode(mode);
  return meters == null ? "FULL" : `${meters / 1_000} km`;
}

export function ridingHorizonScopeLabelForMode(mode: PanelMode): string {
  const meters = ridingHorizonMetersForMode(mode);
  return meters == null ? "the full route" : `the next ${meters / 1_000} km`;
}

export function createRidingHorizonWindow(
  currentDistanceMeters: number | null,
  horizonMeters: number | null,
  options: {
    behindMeters?: number;
    totalDistanceMeters?: number;
  } = {},
): DistanceWindow | undefined {
  if (horizonMeters == null) return undefined;

  const anchor = Math.max(0, currentDistanceMeters ?? 0);
  const startDistanceMeters = Math.max(0, anchor - (options.behindMeters ?? 0));
  const rawEndDistanceMeters = anchor + horizonMeters;
  const endDistanceMeters =
    options.totalDistanceMeters != null
      ? Math.min(options.totalDistanceMeters, rawEndDistanceMeters)
      : rawEndDistanceMeters;

  return { startDistanceMeters, endDistanceMeters };
}

export function isDistanceInWindow(distanceMeters: number, window?: DistanceWindow): boolean {
  if (!window) return true;
  if (window.startDistanceMeters != null && distanceMeters < window.startDistanceMeters) {
    return false;
  }
  if (window.endDistanceMeters != null && distanceMeters > window.endDistanceMeters) {
    return false;
  }
  return true;
}

export function isDistanceRangeInWindow(
  startDistanceMeters: number,
  endDistanceMeters: number,
  window?: DistanceWindow,
): boolean {
  if (!window) return true;
  if (window.startDistanceMeters != null && endDistanceMeters < window.startDistanceMeters) {
    return false;
  }
  if (window.endDistanceMeters != null && startDistanceMeters > window.endDistanceMeters) {
    return false;
  }
  return true;
}

export function filterClimbsToRidingHorizon(
  climbs: DisplayClimb[],
  window?: DistanceWindow,
): DisplayClimb[] {
  return climbs.filter((climb) =>
    isDistanceRangeInWindow(
      climb.effectiveStartDistanceMeters,
      climb.effectiveEndDistanceMeters,
      window,
    ),
  );
}
