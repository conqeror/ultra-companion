import type { ClimbDifficulty } from "@/types";

export const CLIMB_DIFFICULTY_COLORS: Record<ClimbDifficulty, string> = {
  low: "#EAB308",
  medium: "#F97316",
  hard: "#DC2626",
};

export function getClimbDifficulty(score: number): ClimbDifficulty {
  if (score < 150) return "low";
  if (score < 400) return "medium";
  return "hard";
}

export function climbDifficultyColor(score: number): string {
  return CLIMB_DIFFICULTY_COLORS[getClimbDifficulty(score)];
}

export const CLIMB_DIFFICULTY_LABELS: Record<ClimbDifficulty, string> = {
  low: "Easy",
  medium: "Moderate",
  hard: "Hard",
};

export const CLIMB_BEHIND_THRESHOLD_M = 1000;
