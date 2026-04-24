import type { DisplayClimb } from "@/types";

/** Pick the most relevant climb: current (by distance), next upcoming, or last. */
export function resolveActiveClimb(
  climbs: DisplayClimb[],
  currentDist: number | null,
  selectedClimb: DisplayClimb | null,
): DisplayClimb | null {
  if (selectedClimb) return selectedClimb;
  if (climbs.length === 0) return null;
  if (currentDist == null) return climbs[0];

  const current = climbs.find(
    (c) =>
      currentDist >= c.effectiveStartDistanceMeters && currentDist <= c.effectiveEndDistanceMeters,
  );
  if (current) return current;

  const next = climbs.find((c) => c.effectiveStartDistanceMeters > currentDist);
  return next ?? climbs[climbs.length - 1];
}
