import {
  buildRouteSegmentSpatialIndex,
  computeBearing,
  findRouteSegmentCandidates,
  haversineDistance,
} from "@/utils/geo";
import type {
  RoutePoint,
  RouteSnapCandidate,
  RouteSnapConfidence,
  RouteSnapHistorySample,
  RouteSnapResult,
  SnappedPosition,
} from "@/types";
import type { RouteSegmentSpatialIndex } from "@/utils/geo";

const MAX_SNAP_DISTANCE_M = 1000; // Don't snap if >1km from route
const MAX_SEGMENT_CANDIDATES = 96;
const MOVEMENT_BEARING_MIN_DISTANCE_M = 8;
const TRUST_HEADING_MIN_SPEED_MPS = 1;
const ROUTE_PROGRESS_SCORE_CAP_M = 2000;
const ROUTE_PROGRESS_WEIGHT = 0.03;
const BACKTRACK_TOLERANCE_M = 25;
const BACKTRACK_WEIGHT = 0.06;
const BACKTRACK_BASE_PENALTY = 20;
const HEADING_PENALTY_M = 80;
const DISTINCT_ROUTE_PROGRESS_M = 100;

interface SnapToRouteOptions {
  previousPointIndex?: number | null;
  previousDistanceAlongRouteMeters?: number | null;
  history?: RouteSnapHistorySample[];
  headingDegrees?: number | null;
  speedMetersPerSecond?: number | null;
  timestamp?: number | null;
}

type ScoredRouteSnapCandidate = RouteSnapCandidate & { score: number };

const routeSegmentIndexCache = new WeakMap<RoutePoint[], RouteSegmentSpatialIndex | null>();

function getRouteSegmentIndex(points: RoutePoint[]): RouteSegmentSpatialIndex | null {
  if (routeSegmentIndexCache.has(points)) return routeSegmentIndexCache.get(points) ?? null;
  const index = buildRouteSegmentSpatialIndex(points, MAX_SNAP_DISTANCE_M);
  routeSegmentIndexCache.set(points, index);
  return index;
}

function normalizeDegrees(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

function isValidHeadingDegrees(heading: number | null | undefined): heading is number {
  return heading != null && Number.isFinite(heading) && heading >= 0 && heading < 360;
}

function angularDifferenceDegrees(a: number, b: number): number {
  const diff = Math.abs(normalizeDegrees(a) - normalizeDegrees(b));
  return Math.min(diff, 360 - diff);
}

function getLastHistorySample(
  routeId: string,
  history?: RouteSnapHistorySample[],
): RouteSnapHistorySample | null {
  if (!history) return null;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].routeId === routeId) return history[i];
  }
  return null;
}

function getPreviousDistanceAlongRoute(
  routeId: string,
  points: RoutePoint[],
  options?: SnapToRouteOptions,
): number | null {
  const lastHistory = getLastHistorySample(routeId, options?.history);
  if (lastHistory) return lastHistory.selectedCandidate.distanceAlongRouteMeters;

  if (options?.previousDistanceAlongRouteMeters != null) {
    return options.previousDistanceAlongRouteMeters;
  }

  const previousPointIndex = options?.previousPointIndex;
  if (previousPointIndex != null && previousPointIndex >= 0 && previousPointIndex < points.length) {
    return points[previousPointIndex].distanceFromStartMeters;
  }

  return null;
}

function getTrustedBearing(
  lat: number,
  lon: number,
  routeId: string,
  options?: SnapToRouteOptions,
): number | null {
  const heading = options?.headingDegrees;
  const speed = options?.speedMetersPerSecond;
  if (
    isValidHeadingDegrees(heading) &&
    speed != null &&
    Number.isFinite(speed) &&
    speed >= TRUST_HEADING_MIN_SPEED_MPS
  ) {
    return normalizeDegrees(heading);
  }

  const lastHistory = getLastHistorySample(routeId, options?.history);
  if (!lastHistory) return null;

  const movementDistance = haversineDistance(lastHistory.latitude, lastHistory.longitude, lat, lon);
  if (movementDistance < MOVEMENT_BEARING_MIN_DISTANCE_M) return null;

  return computeBearing(lastHistory.latitude, lastHistory.longitude, lat, lon);
}

function getExpectedForwardDistance(routeId: string, options?: SnapToRouteOptions): number | null {
  const lastHistory = getLastHistorySample(routeId, options?.history);
  if (!lastHistory || options?.timestamp == null || options.timestamp <= lastHistory.timestamp) {
    return null;
  }

  const speed = options.speedMetersPerSecond ?? lastHistory.speed;
  if (speed == null || speed <= 0) return null;

  const elapsedSeconds = (options.timestamp - lastHistory.timestamp) / 1000;
  return Math.max(250, Math.min(5000, speed * elapsedSeconds * 2 + 100));
}

function scoreCandidate(
  candidate: RouteSnapCandidate,
  previousDistanceAlongRoute: number | null,
  trustedBearing: number | null,
  expectedForwardDistance: number | null,
): number {
  let score = candidate.distanceFromRouteMeters;

  if (previousDistanceAlongRoute != null) {
    const routeDelta = candidate.distanceAlongRouteMeters - previousDistanceAlongRoute;
    score += Math.min(Math.abs(routeDelta), ROUTE_PROGRESS_SCORE_CAP_M) * ROUTE_PROGRESS_WEIGHT;

    if (routeDelta < -BACKTRACK_TOLERANCE_M) {
      score +=
        BACKTRACK_BASE_PENALTY +
        Math.min(Math.abs(routeDelta) - BACKTRACK_TOLERANCE_M, ROUTE_PROGRESS_SCORE_CAP_M) *
          BACKTRACK_WEIGHT;
    }

    if (expectedForwardDistance != null && routeDelta > expectedForwardDistance) {
      score += Math.min(routeDelta - expectedForwardDistance, ROUTE_PROGRESS_SCORE_CAP_M) * 0.02;
    }
  }

  if (trustedBearing != null) {
    score +=
      (angularDifferenceDegrees(trustedBearing, candidate.segmentBearingDegrees) / 180) *
      HEADING_PENALTY_M;
  }

  return score;
}

function computeConfidence(scoredCandidates: ScoredRouteSnapCandidate[]): RouteSnapConfidence {
  if (scoredCandidates.length <= 1) return "high";

  const selected = scoredCandidates[0];
  const secondDistinct = scoredCandidates.find(
    (candidate) =>
      Math.abs(candidate.distanceAlongRouteMeters - selected.distanceAlongRouteMeters) >=
      DISTINCT_ROUTE_PROGRESS_M,
  );
  if (!secondDistinct) return "high";

  const scoreDelta = secondDistinct.score - selected.score;
  if (scoreDelta < 12) return "low";
  if (scoreDelta < 35) return "medium";
  return "high";
}

export function snapToRouteDetailed(
  lat: number,
  lon: number,
  routeId: string,
  points: RoutePoint[],
  options?: SnapToRouteOptions,
): RouteSnapResult | null {
  if (points.length === 0) return null;

  const previousDistanceAlongRoute = getPreviousDistanceAlongRoute(routeId, points, options);
  const trustedBearing = getTrustedBearing(lat, lon, routeId, options);
  const expectedForwardDistance = getExpectedForwardDistance(routeId, options);
  const spatialIndex = getRouteSegmentIndex(points);

  const candidates = findRouteSegmentCandidates(lat, lon, points, {
    spatialIndex,
    maxDistanceMeters: MAX_SNAP_DISTANCE_M,
    maxCandidates: MAX_SEGMENT_CANDIDATES,
  }).map<RouteSnapCandidate>((candidate) => ({
    pointIndex: candidate.nearestPointIndex,
    segmentIndex: candidate.segmentIndex,
    projectedFraction: candidate.fraction,
    distanceAlongRouteMeters: candidate.distanceAlongRouteMeters,
    distanceFromRouteMeters: candidate.distanceMeters,
    segmentBearingDegrees: candidate.bearingDegrees,
  }));

  if (candidates.length === 0) return null;

  const scoredCandidates = candidates
    .map(
      (candidate): ScoredRouteSnapCandidate => ({
        pointIndex: candidate.pointIndex,
        segmentIndex: candidate.segmentIndex,
        projectedFraction: candidate.projectedFraction,
        distanceAlongRouteMeters: candidate.distanceAlongRouteMeters,
        distanceFromRouteMeters: candidate.distanceFromRouteMeters,
        segmentBearingDegrees: candidate.segmentBearingDegrees,
        score: scoreCandidate(
          candidate,
          previousDistanceAlongRoute,
          trustedBearing,
          expectedForwardDistance,
        ),
      }),
    )
    .sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score;
      if (a.distanceFromRouteMeters !== b.distanceFromRouteMeters) {
        return a.distanceFromRouteMeters - b.distanceFromRouteMeters;
      }
      return a.distanceAlongRouteMeters - b.distanceAlongRouteMeters;
    });

  const selected = scoredCandidates[0];
  if (selected.distanceFromRouteMeters > MAX_SNAP_DISTANCE_M) return null;

  const confidence = computeConfidence(scoredCandidates);
  const snappedPosition: SnappedPosition = {
    routeId,
    pointIndex: selected.pointIndex,
    distanceAlongRouteMeters: selected.distanceAlongRouteMeters,
    distanceFromRouteMeters: selected.distanceFromRouteMeters,
  };

  return {
    routeId,
    selectedCandidate: {
      pointIndex: selected.pointIndex,
      segmentIndex: selected.segmentIndex,
      projectedFraction: selected.projectedFraction,
      distanceAlongRouteMeters: selected.distanceAlongRouteMeters,
      distanceFromRouteMeters: selected.distanceFromRouteMeters,
      segmentBearingDegrees: selected.segmentBearingDegrees,
    },
    candidates: scoredCandidates.map((candidate) => ({
      pointIndex: candidate.pointIndex,
      segmentIndex: candidate.segmentIndex,
      projectedFraction: candidate.projectedFraction,
      distanceAlongRouteMeters: candidate.distanceAlongRouteMeters,
      distanceFromRouteMeters: candidate.distanceFromRouteMeters,
      segmentBearingDegrees: candidate.segmentBearingDegrees,
    })),
    confidence,
    isAmbiguous: confidence === "low",
    snappedPosition,
  };
}

export function snapToRoute(
  lat: number,
  lon: number,
  routeId: string,
  points: RoutePoint[],
  options?: SnapToRouteOptions,
): SnappedPosition | null {
  return snapToRouteDetailed(lat, lon, routeId, points, options)?.snappedPosition ?? null;
}
