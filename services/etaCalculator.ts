import type { RoutePoint, PowerModelConfig, ETAResult } from "@/types";
import { computeSegmentTime } from "./powerModel";
import { computeWindowedGradient } from "@/utils/elevation";
import { findFirstPointAtOrAfterDistance, routePointArrayFingerprint } from "@/utils/geo";
import { measureAsync, measureSync } from "@/utils/perfMarks";
import {
  ferryDelaySeconds,
  ferryEndDistanceMeters,
  ferrySignature,
  ferryStartDistanceMeters,
  normalizeFerrySpans,
  ridingDistanceBetween,
  type FerryTimingCrossing,
} from "./ferryCrossings";

const routeEtaCache = new Map<string, { fingerprint: string; cumulative: number[] }>();
const routeTotalEtaCache = new Map<string, { fingerprint: string; total: number | null }>();

export function powerConfigKey(config: PowerModelConfig): string {
  return Object.keys(config)
    .sort()
    .map((key) => `${key}:${config[key as keyof PowerModelConfig]}`)
    .join("|");
}

function cacheKey(routeKey: string, config: PowerModelConfig): string {
  return `${routeKey}:${powerConfigKey(config)}`;
}

export function createRouteETASegmentEvaluator(
  points: RoutePoint[],
  config: PowerModelConfig,
  ferries: readonly FerryTimingCrossing[] = [],
): (pointIndex: number) => number {
  const routeEnd = points[points.length - 1]?.distanceFromStartMeters ?? 0;
  const distanceSpans = normalizeFerrySpans(
    ferries.map((crossing) => ({
      startDistanceMeters: ferryStartDistanceMeters(crossing),
      endDistanceMeters: ferryEndDistanceMeters(crossing),
    })),
    routeEnd,
  );
  const timings = [...ferries].sort(
    (a, b) => ferryEndDistanceMeters(a) - ferryEndDistanceMeters(b),
  );
  let spanCursor = 0;
  let timingCursor = 0;

  return (pointIndex) => {
    const prev = points[pointIndex - 1];
    const curr = points[pointIndex];
    if (!prev || !curr) return 0;
    const start = prev.distanceFromStartMeters;
    const end = curr.distanceFromStartMeters;
    const geometricDistance = Math.max(0, end - start);

    while (
      spanCursor < distanceSpans.length &&
      distanceSpans[spanCursor].endDistanceMeters <= start
    ) {
      spanCursor += 1;
    }
    let overlapDistance = 0;
    for (let index = spanCursor; index < distanceSpans.length; index += 1) {
      const span = distanceSpans[index];
      if (span.startDistanceMeters >= end) break;
      overlapDistance += Math.max(
        0,
        Math.min(end, span.endDistanceMeters) - Math.max(start, span.startDistanceMeters),
      );
    }
    const ridingDistance = Math.max(0, geometricDistance - overlapDistance);
    const gradient = overlapDistance > 0 ? 0 : computeWindowedGradient(points, pointIndex);
    let seconds = computeSegmentTime(ridingDistance, gradient, config);

    while (
      timingCursor < timings.length &&
      ferryEndDistanceMeters(timings[timingCursor]) <= start
    ) {
      timingCursor += 1;
    }
    while (timingCursor < timings.length && ferryEndDistanceMeters(timings[timingCursor]) <= end) {
      seconds += ferryDelaySeconds(timings[timingCursor]);
      timingCursor += 1;
    }
    return seconds;
  };
}

/**
 * Compute cumulative riding time (seconds) at each route point.
 * cumulativeTime[0] = 0, cumulativeTime[i] = total seconds from point 0 to point i.
 */
export function computeRouteETA(
  points: RoutePoint[],
  config: PowerModelConfig,
  ferries: readonly FerryTimingCrossing[] = [],
): number[] {
  if (points.length === 0) return [];

  const cumulative = Array.from<number>({ length: points.length });
  cumulative[0] = 0;

  const segmentSeconds = createRouteETASegmentEvaluator(points, config, ferries);
  for (let i = 1; i < points.length; i++) {
    cumulative[i] = cumulative[i - 1] + segmentSeconds(i);
  }

  return cumulative;
}

export function computeCachedRouteETA(
  routeKey: string,
  points: RoutePoint[],
  config: PowerModelConfig,
  ferries: readonly FerryTimingCrossing[] = [],
): number[] {
  const key = `${cacheKey(routeKey, config)}:${ferrySignature(ferries)}`;
  const fingerprint = routePointArrayFingerprint(points);
  const cached = routeEtaCache.get(key);
  if (cached?.fingerprint === fingerprint) return cached.cumulative;

  const cumulative = measureSync("eta.computeRouteETA", () =>
    computeRouteETA(points, config, ferries),
  );
  routeEtaCache.set(key, { fingerprint, cumulative });
  return cumulative;
}

/**
 * Compute total riding time without allocating the full cumulative ETA array.
 */
export function computeRouteTotalETA(
  points: RoutePoint[],
  config: PowerModelConfig,
  ferries: readonly FerryTimingCrossing[] = [],
): number | null {
  if (points.length < 2) return null;

  let totalSeconds = 0;
  const segmentSeconds = createRouteETASegmentEvaluator(points, config, ferries);
  for (let i = 1; i < points.length; i++) {
    totalSeconds += segmentSeconds(i);
  }

  return totalSeconds;
}

export interface ComputeRouteTotalETAInChunksOptions {
  /** Number of points processed before yielding back to React Native. */
  chunkPoints?: number;
  /** Stops obsolete work when the owning component receives new inputs or unmounts. */
  shouldCancel?: () => boolean;
  /** Injectable for deterministic tests; production uses a zero-delay event-loop yield. */
  yieldControl?: () => Promise<void>;
  ferries?: readonly FerryTimingCrossing[];
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/**
 * Compute total riding time without monopolizing the JS thread. Unlike the
 * cumulative ETA calculation, this intentionally retains only the final total.
 */
export async function computeRouteTotalETAInChunks(
  points: RoutePoint[],
  config: PowerModelConfig,
  options: ComputeRouteTotalETAInChunksOptions = {},
): Promise<number | null> {
  if (points.length < 2) return null;

  return measureAsync("eta.computeRouteTotalETAInChunks", async () => {
    const chunkPoints = Math.max(1, options.chunkPoints ?? 2_500);
    const yieldControl = options.yieldControl ?? yieldToEventLoop;
    let totalSeconds = 0;
    const segmentSeconds = createRouteETASegmentEvaluator(points, config, options.ferries);

    for (let i = 1; i < points.length; i++) {
      if (options.shouldCancel?.()) return null;

      totalSeconds += segmentSeconds(i);

      if (i % chunkPoints === 0 && i < points.length - 1) {
        await yieldControl();
      }
    }

    return options.shouldCancel?.() ? null : totalSeconds;
  });
}

/**
 * Chunked total ETA with the same completed-result cache used by the synchronous
 * variant calculation. Cancelled work is deliberately never cached.
 */
export async function computeCachedRouteTotalETAInChunks(
  routeKey: string,
  points: RoutePoint[],
  config: PowerModelConfig,
  options: ComputeRouteTotalETAInChunksOptions = {},
): Promise<number | null> {
  if (options.shouldCancel?.()) return null;

  const key = `${cacheKey(routeKey, config)}:${ferrySignature(options.ferries ?? [])}`;
  const fingerprint = routePointArrayFingerprint(points);
  const cached = routeTotalEtaCache.get(key);
  if (cached?.fingerprint === fingerprint) return cached.total;

  const total = await computeRouteTotalETAInChunks(points, config, options);
  if (total != null && !options.shouldCancel?.()) {
    routeTotalEtaCache.set(key, { fingerprint, total });
  }
  return total;
}

export function computeCachedRouteTotalETA(
  routeKey: string,
  points: RoutePoint[],
  config: PowerModelConfig,
  ferries: readonly FerryTimingCrossing[] = [],
): number | null {
  const key = `${cacheKey(routeKey, config)}:${ferrySignature(ferries)}`;
  const fingerprint = routePointArrayFingerprint(points);
  const cached = routeTotalEtaCache.get(key);
  if (cached?.fingerprint === fingerprint) return cached.total;

  const total = measureSync("eta.computeRouteTotalETA", () =>
    computeRouteTotalETA(points, config, ferries),
  );
  routeTotalEtaCache.set(key, { fingerprint, total });
  return total;
}

export function clearRouteEtaCaches(): void {
  routeEtaCache.clear();
  routeTotalEtaCache.clear();
}

/**
 * Get riding time in seconds between two point indices.
 */
export function getETABetweenIndices(
  cumulativeTime: number[],
  fromIndex: number,
  toIndex: number,
): number {
  if (fromIndex < 0 || toIndex < 0) return 0;
  if (fromIndex >= cumulativeTime.length || toIndex >= cumulativeTime.length) return 0;
  return cumulativeTime[toIndex] - cumulativeTime[fromIndex];
}

/**
 * Interpolates cumulative route time while treating ferry delay as a discrete
 * event at the landing boundary and ferry geometry as zero riding distance.
 */
export function getTimeAtDistance(
  cumulativeTime: number[],
  points: RoutePoint[],
  distanceAlongRouteM: number,
  ferries: readonly FerryTimingCrossing[] = [],
): number | null {
  if (points.length === 0 || cumulativeTime.length === 0) return null;
  if (points.length !== cumulativeTime.length) return null;

  if (points.length === 1) return cumulativeTime[0];

  const hi = Math.min(
    findFirstPointAtOrAfterDistance(points, distanceAlongRouteM),
    points.length - 1,
  );
  const lo = Math.max(0, hi - 1);

  const loTime = cumulativeTime[lo];
  const hiTime = cumulativeTime[hi];
  const loDist = points[lo].distanceFromStartMeters;
  const hiDist = points[hi].distanceFromStartMeters;

  if (hiDist - loDist <= 0) return loTime;

  const segmentFerryDelay = ferries.reduce((seconds, crossing) => {
    const landing = ferryEndDistanceMeters(crossing);
    return landing > loDist && landing <= hiDist ? seconds + ferryDelaySeconds(crossing) : seconds;
  }, 0);
  const delayBeforeTarget = ferries.reduce((seconds, crossing) => {
    const landing = ferryEndDistanceMeters(crossing);
    return landing > loDist && landing <= distanceAlongRouteM
      ? seconds + ferryDelaySeconds(crossing)
      : seconds;
  }, 0);
  const segmentRoadTime = Math.max(0, hiTime - loTime - segmentFerryDelay);
  const segmentRoadDistance = ridingDistanceBetween(
    loDist,
    hiDist,
    ferries.map((crossing) => ({
      startDistanceMeters: ferryStartDistanceMeters(crossing),
      endDistanceMeters: ferryEndDistanceMeters(crossing),
    })),
  );
  const roadDistanceBeforeTarget = ridingDistanceBetween(
    loDist,
    distanceAlongRouteM,
    ferries.map((crossing) => ({
      startDistanceMeters: ferryStartDistanceMeters(crossing),
      endDistanceMeters: ferryEndDistanceMeters(crossing),
    })),
  );
  // Keep the historical extrapolation behavior beyond the final route point.
  // Within the route this ratio naturally stays in [0, 1]; after the final
  // point it extends the last road segment's pace without inventing ferry km.
  const roadFraction = segmentRoadDistance > 0 ? roadDistanceBeforeTarget / segmentRoadDistance : 0;
  return loTime + segmentRoadTime * roadFraction + delayBeforeTarget;
}

/**
 * Get ETA between two route distances, interpolating between points.
 */
export function getETAToDistanceFromDistance(
  cumulativeTime: number[],
  points: RoutePoint[],
  fromDistanceAlongRouteM: number,
  targetDistanceAlongRouteM: number,
  ferries: readonly FerryTimingCrossing[] = [],
): ETAResult | null {
  if (points.length === 0 || cumulativeTime.length === 0) return null;
  if (targetDistanceAlongRouteM < fromDistanceAlongRouteM) return null;

  const distanceMeters = ridingDistanceBetween(
    fromDistanceAlongRouteM,
    targetDistanceAlongRouteM,
    ferries.map((crossing) => ({
      startDistanceMeters: ferryStartDistanceMeters(crossing),
      endDistanceMeters: ferryEndDistanceMeters(crossing),
    })),
  );
  const fromTime = getTimeAtDistance(cumulativeTime, points, fromDistanceAlongRouteM, ferries);
  const targetTime = getTimeAtDistance(cumulativeTime, points, targetDistanceAlongRouteM, ferries);
  if (fromTime == null || targetTime == null) return null;

  const ridingTimeSeconds = targetTime - fromTime;
  const eta = new Date(Date.now() + ridingTimeSeconds * 1000);

  return { distanceMeters, ridingTimeSeconds, eta };
}

/**
 * Get ETA from a route point index to a specific distance along the route.
 */
export function getETAToDistance(
  cumulativeTime: number[],
  points: RoutePoint[],
  fromIndex: number,
  targetDistanceAlongRouteM: number,
  ferries: readonly FerryTimingCrossing[] = [],
): ETAResult | null {
  if (fromIndex < 0 || fromIndex >= points.length) return null;
  return getETAToDistanceFromDistance(
    cumulativeTime,
    points,
    points[fromIndex].distanceFromStartMeters,
    targetDistanceAlongRouteM,
    ferries,
  );
}
