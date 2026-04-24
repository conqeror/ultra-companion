import type { Climb } from "@/types";

export function buildClimb(
  id: string,
  routeId: string,
  startDistanceMeters: number,
  endDistanceMeters: number,
  overrides: Partial<Climb> = {},
): Climb {
  return {
    id,
    routeId,
    name: id,
    startDistanceMeters,
    endDistanceMeters,
    lengthMeters: endDistanceMeters - startDistanceMeters,
    totalAscentMeters: 120,
    startElevationMeters: 100,
    endElevationMeters: 220,
    averageGradientPercent: 7,
    maxGradientPercent: 10,
    difficultyScore: 100,
    ...overrides,
  };
}
