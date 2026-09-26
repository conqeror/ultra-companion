import type { BRouterAlternativeIndex, ParsedRoute, RoutePlannerCandidate } from "@/types";
import { ROUTE_PLANNER_CANDIDATE_COLORS } from "@/constants";
import { haversineDistance, interpolateRoutePointAtDistance } from "@/utils/geo";

const COMPARISON_SAMPLE_COUNT = 16;
const MAX_DISTANCE_DIFFERENCE_RATIO = 0.005;
const MAX_SAMPLE_SEPARATION_METERS = 80;
const MAX_AVERAGE_SEPARATION_METERS = 30;

export function routePlannerProfileKey(profileId: string | null): string {
  return profileId ?? "builtin";
}

export function routePlannerCandidateId(
  profileId: string | null,
  alternativeIndex: BRouterAlternativeIndex,
): string {
  return `${routePlannerProfileKey(profileId)}:${alternativeIndex}`;
}

export function routePlannerAlternativeLabel(alternativeIndex: BRouterAlternativeIndex): string {
  return alternativeIndex === 0 ? "Original" : `Alternative ${alternativeIndex}`;
}

export function routePlannerCandidateColor(candidateId: string): string {
  let hash = 2166136261;
  for (let index = 0; index < candidateId.length; index++) {
    hash = Math.imul(hash ^ candidateId.charCodeAt(index), 16777619) >>> 0;
  }
  return ROUTE_PLANNER_CANDIDATE_COLORS[hash % ROUTE_PLANNER_CANDIDATE_COLORS.length];
}

/**
 * Reject BRouter alternatives that are effectively the same line as an
 * already-visible candidate. Different profiles remain separate because
 * showing that they agree is useful comparison information.
 */
export function arePlannerRoutesEffectivelySame(a: ParsedRoute, b: ParsedRoute): boolean {
  const longestDistance = Math.max(a.totalDistanceMeters, b.totalDistanceMeters);
  if (longestDistance <= 0) return false;
  if (
    Math.abs(a.totalDistanceMeters - b.totalDistanceMeters) / longestDistance >
    MAX_DISTANCE_DIFFERENCE_RATIO
  ) {
    return false;
  }

  let totalSeparation = 0;
  for (let index = 0; index <= COMPARISON_SAMPLE_COUNT; index++) {
    const fraction = index / COMPARISON_SAMPLE_COUNT;
    const aPoint = interpolateRoutePointAtDistance(a.points, fraction * a.totalDistanceMeters);
    const bPoint = interpolateRoutePointAtDistance(b.points, fraction * b.totalDistanceMeters);
    if (!aPoint || !bPoint) return false;
    const separation = haversineDistance(
      aPoint.latitude,
      aPoint.longitude,
      bPoint.latitude,
      bPoint.longitude,
    );
    if (separation > MAX_SAMPLE_SEPARATION_METERS) return false;
    totalSeparation += separation;
  }

  return totalSeparation / (COMPARISON_SAMPLE_COUNT + 1) <= MAX_AVERAGE_SEPARATION_METERS;
}

export function sortPlannerCandidates(
  candidates: readonly RoutePlannerCandidate[],
  selectedProfileIds: readonly (string | null)[],
): RoutePlannerCandidate[] {
  const profileOrder = new Map(
    selectedProfileIds.map((profileId, index) => [routePlannerProfileKey(profileId), index]),
  );
  return [...candidates].sort((a, b) => {
    const profileDifference =
      (profileOrder.get(routePlannerProfileKey(a.profileId)) ?? Number.MAX_SAFE_INTEGER) -
      (profileOrder.get(routePlannerProfileKey(b.profileId)) ?? Number.MAX_SAFE_INTEGER);
    return profileDifference || a.alternativeIndex - b.alternativeIndex;
  });
}
