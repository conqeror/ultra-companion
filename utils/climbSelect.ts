import type { Climb } from "@/types";

/** Pick the most relevant climb: current (by distance), next upcoming, or last. */
export function resolveActiveClimb(
  climbs: Climb[],
  currentDist: number | null,
  selectedClimb: Climb | null,
): Climb | null {
  if (selectedClimb) return selectedClimb;
  if (climbs.length === 0) return null;
  if (currentDist == null) return climbs[0];

  const current = climbs.find(
    (c) => currentDist >= c.startDistanceMeters && currentDist <= c.endDistanceMeters,
  );
  if (current) return current;

  const next = climbs.find((c) => c.startDistanceMeters > currentDist);
  return next ?? climbs[climbs.length - 1];
}
