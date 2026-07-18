import type {
  Climb,
  DisplayFerryCrossing,
  FerryCrossing,
  RoutePoint,
  StitchedSourceSpan,
} from "@/types";
import { toDisplayDistanceMeters } from "./displayDistance";
import {
  computeSliceElevationTotalsFromDistance,
  interpolateRoutePointAtDistance,
} from "@/utils/geo";
import { directionalEnturFerryName } from "./enturFerry";

export interface FerryDistanceSpan {
  startDistanceMeters: number;
  endDistanceMeters: number;
}

export type FerryTimingCrossing = FerryCrossing | DisplayFerryCrossing;

export function ferryDisplayName(crossing: Pick<FerryCrossing, "name" | "providerRefs">): string {
  return (
    directionalEnturFerryName(crossing.providerRefs) ?? (crossing.name.trim() || "Ferry crossing")
  );
}

export function ferryStartDistanceMeters(crossing: FerryTimingCrossing): number {
  return "effectiveStartDistanceMeters" in crossing
    ? crossing.effectiveStartDistanceMeters
    : crossing.startDistanceMeters;
}

export function ferryEndDistanceMeters(crossing: FerryTimingCrossing): number {
  return "effectiveEndDistanceMeters" in crossing
    ? crossing.effectiveEndDistanceMeters
    : crossing.endDistanceMeters;
}

export function ferryDelaySeconds(crossing: FerryTimingCrossing): number {
  return (
    Math.max(0, crossing.boardingBufferMinutes) * 60 +
    Math.max(0, crossing.assumedWaitMinutes) * 60 +
    Math.max(0, crossing.durationMinutes) * 60
  );
}

const DISTANCE_EPSILON_METERS = 0.01;

export function validateFerryCrossing(
  crossing: FerryCrossing,
  totalRouteDistanceMeters?: number,
): string | null {
  const finiteValues = [
    crossing.startDistanceMeters,
    crossing.endDistanceMeters,
    crossing.startLatitude,
    crossing.startLongitude,
    crossing.endLatitude,
    crossing.endLongitude,
    crossing.durationMinutes,
    crossing.assumedWaitMinutes,
    crossing.boardingBufferMinutes,
  ];
  if (finiteValues.some((value) => !Number.isFinite(value))) {
    return "Ferry coordinates, distances, and timing must be valid numbers.";
  }
  if (!crossing.name.trim()) return "Ferry name is required.";
  if (
    crossing.startDistanceMeters < 0 ||
    crossing.endDistanceMeters <= crossing.startDistanceMeters
  ) {
    return "Landing must be after boarding on the route.";
  }
  if (
    totalRouteDistanceMeters != null &&
    crossing.endDistanceMeters > totalRouteDistanceMeters + DISTANCE_EPSILON_METERS
  ) {
    return "The ferry span is outside this route.";
  }
  if (
    crossing.durationMinutes < 0 ||
    crossing.assumedWaitMinutes < 0 ||
    crossing.boardingBufferMinutes < 0
  ) {
    return "Ferry timing cannot be negative.";
  }
  if (
    Math.abs(crossing.startLatitude) > 90 ||
    Math.abs(crossing.endLatitude) > 90 ||
    Math.abs(crossing.startLongitude) > 180 ||
    Math.abs(crossing.endLongitude) > 180
  ) {
    return "Ferry terminal coordinates are invalid.";
  }
  return null;
}

function finiteDistance(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function normalizeFerrySpans(
  spans: readonly FerryDistanceSpan[],
  totalDistanceMeters = Number.POSITIVE_INFINITY,
): FerryDistanceSpan[] {
  const total = Number.isFinite(totalDistanceMeters)
    ? Math.max(0, totalDistanceMeters)
    : Number.POSITIVE_INFINITY;
  const sorted = spans
    .map((span) => ({
      startDistanceMeters: Math.min(total, finiteDistance(span.startDistanceMeters)),
      endDistanceMeters: Math.min(total, finiteDistance(span.endDistanceMeters)),
    }))
    .filter((span) => span.endDistanceMeters - span.startDistanceMeters > DISTANCE_EPSILON_METERS)
    .sort((a, b) => a.startDistanceMeters - b.startDistanceMeters);

  const merged: FerryDistanceSpan[] = [];
  for (const span of sorted) {
    const previous = merged[merged.length - 1];
    if (
      previous &&
      span.startDistanceMeters <= previous.endDistanceMeters + DISTANCE_EPSILON_METERS
    ) {
      previous.endDistanceMeters = Math.max(previous.endDistanceMeters, span.endDistanceMeters);
    } else {
      merged.push({ ...span });
    }
  }
  return merged;
}

export function ferryOverlapDistanceMeters(
  startDistanceMeters: number,
  endDistanceMeters: number,
  spans: readonly FerryDistanceSpan[],
): number {
  const start = Math.min(startDistanceMeters, endDistanceMeters);
  const end = Math.max(startDistanceMeters, endDistanceMeters);
  if (end <= start) return 0;
  return normalizeFerrySpans(spans, end).reduce(
    (total, span) =>
      total +
      Math.max(
        0,
        Math.min(end, span.endDistanceMeters) - Math.max(start, span.startDistanceMeters),
      ),
    0,
  );
}

export function ridingDistanceAtGeometricDistance(
  geometricDistanceMeters: number,
  spans: readonly FerryDistanceSpan[],
): number {
  const geometric = finiteDistance(geometricDistanceMeters);
  return Math.max(0, geometric - ferryOverlapDistanceMeters(0, geometric, spans));
}

export function ridingDistanceBetween(
  startGeometricDistanceMeters: number,
  endGeometricDistanceMeters: number,
  spans: readonly FerryDistanceSpan[],
): number {
  const start = ridingDistanceAtGeometricDistance(startGeometricDistanceMeters, spans);
  const end = ridingDistanceAtGeometricDistance(endGeometricDistanceMeters, spans);
  return Math.max(0, end - start);
}

export function totalRidingDistanceMeters(
  totalGeometricDistanceMeters: number,
  spans: readonly FerryDistanceSpan[],
): number {
  return ridingDistanceAtGeometricDistance(totalGeometricDistanceMeters, spans);
}

export function geometricDistanceAtRidingDistance(
  ridingDistanceMeters: number,
  totalGeometricDistanceMeters: number,
  spans: readonly FerryDistanceSpan[],
  boundary: "boarding" | "landing" = "landing",
): number {
  const total = finiteDistance(totalGeometricDistanceMeters);
  const target = Math.min(
    finiteDistance(ridingDistanceMeters),
    totalRidingDistanceMeters(total, spans),
  );
  const normalized = normalizeFerrySpans(spans, total);
  let excludedBefore = 0;

  for (const span of normalized) {
    const ridingAtBoarding = span.startDistanceMeters - excludedBefore;
    if (target < ridingAtBoarding - DISTANCE_EPSILON_METERS) {
      return Math.min(total, target + excludedBefore);
    }
    if (Math.abs(target - ridingAtBoarding) <= DISTANCE_EPSILON_METERS) {
      return boundary === "boarding" ? span.startDistanceMeters : span.endDistanceMeters;
    }
    excludedBefore += span.endDistanceMeters - span.startDistanceMeters;
  }

  return Math.min(total, target + excludedBefore);
}

export function computeRidingElevationTotals(
  points: RoutePoint[],
  spans: readonly FerryDistanceSpan[],
  startDistanceMeters = points[0]?.distanceFromStartMeters ?? 0,
  endDistanceMeters = points[points.length - 1]?.distanceFromStartMeters ?? 0,
): { ascent: number; descent: number } {
  if (points.length < 2 || endDistanceMeters <= startDistanceMeters) {
    return { ascent: 0, descent: 0 };
  }

  const excluded = normalizeFerrySpans(spans, endDistanceMeters);
  let cursor = startDistanceMeters;
  let ascent = 0;
  let descent = 0;
  for (const span of excluded) {
    if (span.endDistanceMeters <= cursor) continue;
    if (span.startDistanceMeters >= endDistanceMeters) break;
    const roadEnd = Math.min(endDistanceMeters, Math.max(cursor, span.startDistanceMeters));
    if (roadEnd > cursor) {
      const totals = computeSliceElevationTotalsFromDistance(points, cursor, roadEnd);
      ascent += totals.ascent;
      descent += totals.descent;
    }
    cursor = Math.max(cursor, span.endDistanceMeters);
  }
  if (cursor < endDistanceMeters) {
    const totals = computeSliceElevationTotalsFromDistance(points, cursor, endDistanceMeters);
    ascent += totals.ascent;
    descent += totals.descent;
  }
  return { ascent, descent };
}

export function projectRoutePointsForRidingProfile(
  points: RoutePoint[],
  spans: readonly FerryDistanceSpan[],
): RoutePoint[] {
  if (points.length < 2 || spans.length === 0) return points;
  const routeEnd = points[points.length - 1].distanceFromStartMeters;
  const normalized = normalizeFerrySpans(spans, routeEnd);
  if (normalized.length === 0) return points;

  const projected: RoutePoint[] = [];
  let pointIndex = 0;
  let excludedBefore = 0;
  const push = (
    point: Omit<RoutePoint, "idx"> & { idx?: number },
    distance: number,
    elevation = point.elevationMeters,
  ) => {
    projected.push({
      ...point,
      idx: projected.length,
      elevationMeters: elevation,
      distanceFromStartMeters: Math.max(0, distance),
    });
  };

  for (const span of normalized) {
    while (
      pointIndex < points.length &&
      points[pointIndex].distanceFromStartMeters < span.startDistanceMeters
    ) {
      const point = points[pointIndex++];
      push(point, point.distanceFromStartMeters - excludedBefore);
    }
    const boarding = interpolateRoutePointAtDistance(points, span.startDistanceMeters);
    const landing = interpolateRoutePointAtDistance(points, span.endDistanceMeters);
    const ridingBoundary = span.startDistanceMeters - excludedBefore;
    if (boarding) push(boarding, ridingBoundary);
    // A null landing sample creates an intentional profile break instead of a
    // fake cross-water climb or descent at zero riding distance.
    if (landing) push(landing, ridingBoundary, null);
    while (
      pointIndex < points.length &&
      points[pointIndex].distanceFromStartMeters <= span.endDistanceMeters
    ) {
      pointIndex += 1;
    }
    excludedBefore += span.endDistanceMeters - span.startDistanceMeters;
  }

  while (pointIndex < points.length) {
    const point = points[pointIndex++];
    push(point, point.distanceFromStartMeters - excludedBefore);
  }
  return projected;
}

export function filterClimbsOutsideFerries<T extends Climb>(
  climbs: readonly T[],
  spans: readonly FerryDistanceSpan[],
): T[] {
  const normalized = normalizeFerrySpans(spans);
  return climbs.filter(
    (climb) =>
      ferryOverlapDistanceMeters(climb.startDistanceMeters, climb.endDistanceMeters, normalized) <=
      DISTANCE_EPSILON_METERS,
  );
}

export function toDisplayFerryCrossing(
  crossing: FerryCrossing,
  startDistanceMeters = crossing.startDistanceMeters,
  endDistanceMeters = crossing.endDistanceMeters,
  distanceOffsetMeters = 0,
  points?: readonly RoutePoint[],
): DisplayFerryCrossing {
  const startPoint = points
    ? interpolateRoutePointAtDistance(points as RoutePoint[], startDistanceMeters)
    : null;
  const endPoint = points
    ? interpolateRoutePointAtDistance(points as RoutePoint[], endDistanceMeters)
    : null;
  return {
    ...crossing,
    name: ferryDisplayName(crossing),
    startDistanceMeters,
    endDistanceMeters,
    startLatitude: startPoint?.latitude ?? crossing.startLatitude,
    startLongitude: startPoint?.longitude ?? crossing.startLongitude,
    endLatitude: endPoint?.latitude ?? crossing.endLatitude,
    endLongitude: endPoint?.longitude ?? crossing.endLongitude,
    effectiveStartDistanceMeters: toDisplayDistanceMeters(
      startDistanceMeters + distanceOffsetMeters,
    ),
    effectiveEndDistanceMeters: toDisplayDistanceMeters(endDistanceMeters + distanceOffsetMeters),
  };
}

export function mapFerryCrossingsToSourceSpans(
  crossings: readonly FerryCrossing[],
  sourceSpans: readonly StitchedSourceSpan[] | null,
  pointsByRouteId: Record<string, RoutePoint[]> = {},
): DisplayFerryCrossing[] {
  if (!sourceSpans) return crossings.map((crossing) => toDisplayFerryCrossing(crossing));

  const mapped: DisplayFerryCrossing[] = [];
  for (const crossing of crossings) {
    for (const span of sourceSpans) {
      if (span.routeId !== crossing.routeId) continue;
      // Never split one timed crossing across source spans. A base ferry that
      // intersects a selected patch is suppressed; the patch route must carry
      // its own ferry definition if that replacement still uses the crossing.
      if (
        crossing.startDistanceMeters < span.rawStartDistanceMeters - DISTANCE_EPSILON_METERS ||
        crossing.endDistanceMeters > span.rawEndDistanceMeters + DISTANCE_EPSILON_METERS
      ) {
        continue;
      }
      mapped.push(
        toDisplayFerryCrossing(
          crossing,
          crossing.startDistanceMeters,
          crossing.endDistanceMeters,
          span.distanceOffsetMeters,
          pointsByRouteId[crossing.routeId],
        ),
      );
    }
  }
  return mapped.sort((a, b) => a.effectiveStartDistanceMeters - b.effectiveStartDistanceMeters);
}

export function ferryElapsedSecondsBeforeDistance(
  geometricDistanceMeters: number,
  crossings: readonly FerryTimingCrossing[],
): number {
  return crossings.reduce((seconds, crossing) => {
    const end = ferryEndDistanceMeters(crossing);
    if (end > geometricDistanceMeters + DISTANCE_EPSILON_METERS) return seconds;
    return seconds + ferryDelaySeconds(crossing);
  }, 0);
}

export function ferrySignature(crossings: readonly FerryTimingCrossing[]): string {
  return [...crossings]
    .sort((a, b) => {
      const distance = ferryStartDistanceMeters(a) - ferryStartDistanceMeters(b);
      return distance || a.id.localeCompare(b.id);
    })
    .map(
      (crossing) =>
        `${crossing.id}:${crossing.routeId}:${ferryStartDistanceMeters(crossing).toFixed(1)}:${ferryEndDistanceMeters(crossing).toFixed(1)}:${crossing.durationMinutes}:${crossing.assumedWaitMinutes}:${crossing.boardingBufferMinutes}`,
    )
    .join("|");
}
