import { findFirstPointAtOrAfterDistance, interpolateRoutePointAtDistance } from "@/utils/geo";
import type { RoutePoint } from "@/types";

export interface ClimbProfileSegment {
  startDistanceMeters: number;
  endDistanceMeters: number;
  averageGradientPercent: number;
}

const DISTANCE_EPSILON_M = 0.001;
const DEFAULT_SEGMENT_LENGTH_M = 1000;
const CLIMB_TICK_MIN_COUNT = 5;
const CLIMB_TICK_MAX_COUNT = 15;
const CLIMB_TICK_INTERVALS_M = [100, 200, 500, 1000, 2000] as const;

/**
 * Builds a climb-local route slice with interpolated boundary points.
 * Returned point distances start at 0 so chart axes can describe the climb,
 * while callers can keep the original start distance for absolute overlays.
 */
export function buildClimbProfileSlice(
  points: RoutePoint[],
  startDistanceMeters: number,
  endDistanceMeters: number,
): RoutePoint[] {
  if (
    points.length < 2 ||
    !Number.isFinite(startDistanceMeters) ||
    !Number.isFinite(endDistanceMeters)
  ) {
    return [];
  }

  const routeStart = points[0].distanceFromStartMeters;
  const routeEnd = points[points.length - 1].distanceFromStartMeters;
  const start = Math.max(routeStart, Math.min(startDistanceMeters, routeEnd));
  const end = Math.max(start, Math.min(endDistanceMeters, routeEnd));
  if (end - start <= DISTANCE_EPSILON_M) return [];

  const startPoint = interpolateRoutePointAtDistance(points, start);
  const endPoint = interpolateRoutePointAtDistance(points, end);
  if (!startPoint || !endPoint) return [];

  const sliced: RoutePoint[] = [toLocalRoutePoint(startPoint, 0, 0)];
  const firstInteriorIndex = findFirstPointAtOrAfterDistance(points, start);

  for (let i = firstInteriorIndex; i < points.length; i++) {
    const point = points[i];
    if (point.distanceFromStartMeters <= start + DISTANCE_EPSILON_M) continue;
    if (point.distanceFromStartMeters >= end - DISTANCE_EPSILON_M) break;
    sliced.push({
      latitude: point.latitude,
      longitude: point.longitude,
      elevationMeters: point.elevationMeters,
      distanceFromStartMeters: point.distanceFromStartMeters - start,
      idx: sliced.length,
    });
  }

  sliced.push(toLocalRoutePoint(endPoint, end - start, sliced.length));
  return sliced;
}

export function buildClimbProfileSegments(
  climbPoints: RoutePoint[],
  segmentLengthMeters = DEFAULT_SEGMENT_LENGTH_M,
): ClimbProfileSegment[] {
  if (climbPoints.length < 2 || segmentLengthMeters <= 0) return [];

  const totalDistanceMeters = climbPoints[climbPoints.length - 1].distanceFromStartMeters;
  if (totalDistanceMeters <= 0) return [];

  const segments: ClimbProfileSegment[] = [];
  for (
    let start = 0;
    start < totalDistanceMeters - DISTANCE_EPSILON_M;
    start += segmentLengthMeters
  ) {
    const end = Math.min(totalDistanceMeters, start + segmentLengthMeters);
    const startPoint = interpolateRoutePointAtDistance(climbPoints, start);
    const endPoint = interpolateRoutePointAtDistance(climbPoints, end);
    const elevationDelta =
      startPoint?.elevationMeters != null && endPoint?.elevationMeters != null
        ? endPoint.elevationMeters - startPoint.elevationMeters
        : 0;
    const lengthMeters = end - start;
    const averageGradientPercent =
      lengthMeters > 0 ? roundOne((elevationDelta / lengthMeters) * 100) : 0;

    segments.push({
      startDistanceMeters: roundOne(start),
      endDistanceMeters: roundOne(end),
      averageGradientPercent,
    });
  }

  return segments;
}

export function chooseClimbTickIntervalMeters(
  totalDistanceMeters: number,
  preferredIntervalMeters?: number,
): number {
  if (preferredIntervalMeters != null && preferredIntervalMeters > 0) {
    return preferredIntervalMeters;
  }

  for (const interval of CLIMB_TICK_INTERVALS_M) {
    const count = climbTickCount(totalDistanceMeters, interval);
    if (count >= CLIMB_TICK_MIN_COUNT && count <= CLIMB_TICK_MAX_COUNT) {
      return interval;
    }
  }

  const shortest = CLIMB_TICK_INTERVALS_M[0];
  const longest = CLIMB_TICK_INTERVALS_M[CLIMB_TICK_INTERVALS_M.length - 1];
  return climbTickCount(totalDistanceMeters, shortest) < CLIMB_TICK_MIN_COUNT ? shortest : longest;
}

export function buildClimbTickDistances(
  totalDistanceMeters: number,
  preferredIntervalMeters?: number,
): number[] {
  if (totalDistanceMeters <= 0) return [];

  const interval = chooseClimbTickIntervalMeters(totalDistanceMeters, preferredIntervalMeters);
  const ticks: number[] = [];
  for (let value = interval; value <= totalDistanceMeters + DISTANCE_EPSILON_M; value += interval) {
    ticks.push(value);
  }
  if (ticks.length === 0) ticks.push(totalDistanceMeters);
  return ticks;
}

export function buildClimbTickBoundaries(
  totalDistanceMeters: number,
  preferredIntervalMeters?: number,
): number[] {
  const boundaries = [0, ...buildClimbTickDistances(totalDistanceMeters, preferredIntervalMeters)];
  const lastBoundary = boundaries[boundaries.length - 1];
  if (lastBoundary < totalDistanceMeters - 1) boundaries.push(totalDistanceMeters);
  return boundaries;
}

function toLocalRoutePoint(
  point: NonNullable<ReturnType<typeof interpolateRoutePointAtDistance>>,
  distanceFromStartMeters: number,
  idx: number,
): RoutePoint {
  return {
    latitude: point.latitude,
    longitude: point.longitude,
    elevationMeters: point.elevationMeters,
    distanceFromStartMeters,
    idx,
  };
}

function roundOne(value: number): number {
  return Math.round(value * 10) / 10;
}

function climbTickCount(totalDistanceMeters: number, intervalMeters: number): number {
  return Math.floor((totalDistanceMeters + DISTANCE_EPSILON_M) / intervalMeters);
}
