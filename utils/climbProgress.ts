import type { DisplayClimb } from "@/types";

export type ClimbProgressState = "unknown" | "upcoming" | "active" | "past";

export interface ClimbProgress {
  state: ClimbProgressState;
  distanceToStartMeters: number | null;
  distanceToTopMeters: number | null;
  distancePastTopMeters: number | null;
  completedDistanceMeters: number;
  remainingDistanceMeters: number;
  progressRatio: number;
}

export function getClimbProgress(
  climb: DisplayClimb,
  currentDistanceMeters: number | null | undefined,
): ClimbProgress {
  const start = climb.effectiveStartDistanceMeters;
  const end = Math.max(start, climb.effectiveEndDistanceMeters);
  const length = Math.max(1, end - start);

  if (currentDistanceMeters == null || !Number.isFinite(currentDistanceMeters)) {
    return {
      state: "unknown",
      distanceToStartMeters: null,
      distanceToTopMeters: null,
      distancePastTopMeters: null,
      completedDistanceMeters: 0,
      remainingDistanceMeters: length,
      progressRatio: 0,
    };
  }

  if (currentDistanceMeters < start) {
    return {
      state: "upcoming",
      distanceToStartMeters: start - currentDistanceMeters,
      distanceToTopMeters: end - currentDistanceMeters,
      distancePastTopMeters: null,
      completedDistanceMeters: 0,
      remainingDistanceMeters: length,
      progressRatio: 0,
    };
  }

  if (currentDistanceMeters <= end) {
    const completed = Math.max(0, Math.min(length, currentDistanceMeters - start));
    const remaining = Math.max(0, end - currentDistanceMeters);
    return {
      state: "active",
      distanceToStartMeters: 0,
      distanceToTopMeters: remaining,
      distancePastTopMeters: null,
      completedDistanceMeters: completed,
      remainingDistanceMeters: remaining,
      progressRatio: completed / length,
    };
  }

  return {
    state: "past",
    distanceToStartMeters: 0,
    distanceToTopMeters: 0,
    distancePastTopMeters: currentDistanceMeters - end,
    completedDistanceMeters: length,
    remainingDistanceMeters: 0,
    progressRatio: 1,
  };
}
