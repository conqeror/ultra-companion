import type { RoutePoint, Climb } from "@/types";

interface DetectedClimb {
  startDistanceMeters: number;
  endDistanceMeters: number;
  lengthMeters: number;
  totalAscentMeters: number;
  startElevationMeters: number;
  endElevationMeters: number;
  averageGradientPercent: number;
  maxGradientPercent: number;
  difficultyScore: number;
}

/** Bump this when the detection algorithm changes to trigger re-detection of stored climbs. */
export const CLIMB_DETECTOR_VERSION = 7;

const SMOOTHING_WINDOW_M = 200;
/** Minimum total ascent (m) for a segment to qualify as a climb. Also used as
 *  the threshold for self-heal re-detection in climbStore. */
export const MIN_GAIN_M = 50;
const MIN_AVG_GRADIENT_PCT = 2.5;
const TRIM_BASELINE_GRADIENT_PCT = 1.5;
const DIP_RATIO = 0.2;
const DIP_FLOOR_M = 10;
const MAX_GRADIENT_WINDOW_M = 200;

/**
 * Detect climbs from route elevation data.
 * Returns detected climbs sorted by start distance.
 */
export function detectClimbs(points: RoutePoint[]): DetectedClimb[] {
  if (points.length < 2) return [];

  // Filter out points without elevation
  const withElev = points.filter((p) => p.elevationMeters != null);
  if (withElev.length < 2) return [];

  // Step 1: Smooth elevation with a moving average
  const smoothed = smoothElevation(withElev);

  // Step 2 + 3: Detect rising segments and qualify
  return detectAndQualify(withElev, smoothed);
}

function smoothElevation(points: RoutePoint[]): number[] {
  const halfWindow = SMOOTHING_WINDOW_M / 2;
  const result: number[] = new Array(points.length);

  // Use two-pointer approach for the sliding window
  let windowStart = 0;
  let windowEnd = 0;
  let windowSum = 0;
  let windowCount = 0;

  for (let i = 0; i < points.length; i++) {
    const centerDist = points[i].distanceFromStartMeters;
    const lo = centerDist - halfWindow;
    const hi = centerDist + halfWindow;

    // Advance window end
    while (windowEnd < points.length && points[windowEnd].distanceFromStartMeters <= hi) {
      windowSum += points[windowEnd].elevationMeters!;
      windowCount++;
      windowEnd++;
    }

    // Advance window start
    while (windowStart < points.length && points[windowStart].distanceFromStartMeters < lo) {
      windowSum -= points[windowStart].elevationMeters!;
      windowCount--;
      windowStart++;
    }

    result[i] = windowCount > 0 ? windowSum / windowCount : points[i].elevationMeters!;
  }

  return result;
}

function detectAndQualify(points: RoutePoint[], smoothed: number[]): DetectedClimb[] {
  const climbs: DetectedClimb[] = [];

  let climbStartIdx: number | null = null;
  let maxElevIdx = 0;
  let maxElev = -Infinity;

  for (let i = 1; i < points.length; i++) {
    if (climbStartIdx === null) {
      // Not in a climb — look for a rising segment
      if (smoothed[i] > smoothed[i - 1]) {
        climbStartIdx = i - 1;
        maxElevIdx = i;
        maxElev = smoothed[i];
      }
    } else {
      // Track the highest point reached
      if (smoothed[i] >= maxElev) {
        maxElev = smoothed[i];
        maxElevIdx = i;
      }

      // Check dip from the highest point
      const dipFromMax = maxElev - smoothed[i];
      // Use NET gain (peak - start) for threshold, not accumulated positive changes
      const netGain = maxElev - smoothed[climbStartIdx];
      const threshold = Math.max(DIP_FLOOR_M, DIP_RATIO * netGain);

      if (dipFromMax >= threshold) {
        // Dip too large — finalize climb at the highest point
        tryFinalize(points, smoothed, climbs, climbStartIdx, maxElevIdx);

        // Reset and continue scanning
        climbStartIdx = null;
        maxElev = -Infinity;
      }
    }
  }

  // Finalize any in-progress climb at the end
  if (climbStartIdx !== null) {
    tryFinalize(points, smoothed, climbs, climbStartIdx, maxElevIdx);
  }

  return climbs;
}

function tryFinalize(
  points: RoutePoint[],
  smoothed: number[],
  climbs: DetectedClimb[],
  startIdx: number,
  endIdx: number,
): void {
  if (startIdx >= endIdx) return;

  // Trim flat lead-ins and gentle tail-offs by picking the sub-segment that
  // maximizes ascent above a baseline gradient. Steps shallower than the
  // baseline score negatively and are excluded from the ends.
  const trimmed = findMaxScoringSubSegment(points, smoothed, startIdx, endIdx);
  if (!trimmed) return;

  const effStart = trimmed.start;
  const effEnd = trimmed.end;
  const length = points[effEnd].distanceFromStartMeters - points[effStart].distanceFromStartMeters;
  if (length <= 0) return;

  const totalAscent = trimmed.ascent;
  const avgGradient = (totalAscent / length) * 100;

  // Qualification check
  if (totalAscent < MIN_GAIN_M || avgGradient < MIN_AVG_GRADIENT_PCT) return;

  // Compute max gradient (steepest window)
  const maxGradient = computeMaxGradient(points, smoothed, effStart, effEnd);

  // Compute difficulty score: sum of (gradient² × segment length) per sub-segment
  const difficulty = computeDifficultyScore(points, smoothed, effStart, effEnd);

  climbs.push({
    startDistanceMeters: points[effStart].distanceFromStartMeters,
    endDistanceMeters: points[effEnd].distanceFromStartMeters,
    lengthMeters: length,
    totalAscentMeters: Math.round(totalAscent * 10) / 10,
    startElevationMeters: Math.round(smoothed[effStart] * 10) / 10,
    endElevationMeters: Math.round(smoothed[effEnd] * 10) / 10,
    averageGradientPercent: Math.round(avgGradient * 10) / 10,
    maxGradientPercent: Math.round(maxGradient * 10) / 10,
    difficultyScore: Math.round(difficulty * 10) / 10,
  });
}

/**
 * Find the sub-segment of [startIdx, endIdx] that maximizes
 *   sum(positiveAscent) − baseline × length
 * using Kadane's algorithm (O(n)).
 *
 * Per-step score = posElevChange − baseline × distance. Steps climbing steeper
 * than baseline score positive; flat/gentle steps score negative and get
 * trimmed from the ends.
 */
function findMaxScoringSubSegment(
  points: RoutePoint[],
  smoothed: number[],
  startIdx: number,
  endIdx: number,
): { start: number; end: number; ascent: number } | null {
  const stepCount = endIdx - startIdx;
  if (stepCount <= 0) return null;

  const baselineFraction = TRIM_BASELINE_GRADIENT_PCT / 100;

  let bestSum = 0;
  let bestStart = 0;
  let bestEnd = 0;
  let bestAscent = 0;

  let curSum = 0;
  let curStart = 0;
  let curAscent = 0;

  for (let i = 0; i < stepCount; i++) {
    const ptIdx = startIdx + i;
    const eleDiff = smoothed[ptIdx + 1] - smoothed[ptIdx];
    const posDiff = eleDiff > 0 ? eleDiff : 0;
    const dist = points[ptIdx + 1].distanceFromStartMeters - points[ptIdx].distanceFromStartMeters;
    const score = posDiff - baselineFraction * dist;

    curSum += score;
    curAscent += posDiff;

    if (curSum > bestSum) {
      bestSum = curSum;
      bestStart = curStart;
      bestEnd = i + 1;
      bestAscent = curAscent;
    }

    if (curSum < 0) {
      curSum = 0;
      curAscent = 0;
      curStart = i + 1;
    }
  }

  if (bestEnd <= bestStart) return null;

  return {
    start: startIdx + bestStart,
    end: startIdx + bestEnd,
    ascent: bestAscent,
  };
}

function computeMaxGradient(
  points: RoutePoint[],
  smoothed: number[],
  startIdx: number,
  endIdx: number,
): number {
  let maxGrad = 0;

  for (let i = startIdx; i <= endIdx; i++) {
    // Find the point ~200m ahead
    const startDist = points[i].distanceFromStartMeters;
    const targetDist = startDist + MAX_GRADIENT_WINDOW_M;

    // Find closest point to targetDist within our range
    let j = i + 1;
    while (j < endIdx && points[j].distanceFromStartMeters < targetDist) {
      j++;
    }
    if (j > endIdx) j = endIdx;
    if (j === i) continue;

    const windowDist = points[j].distanceFromStartMeters - startDist;
    if (windowDist < 50) continue; // too short to be meaningful

    const elevGain = smoothed[j] - smoothed[i];
    if (elevGain <= 0) continue;

    const gradient = (elevGain / windowDist) * 100;
    if (gradient > maxGrad) maxGrad = gradient;
  }

  return maxGrad;
}

function computeDifficultyScore(
  points: RoutePoint[],
  smoothed: number[],
  startIdx: number,
  endIdx: number,
): number {
  let score = 0;

  for (let i = startIdx + 1; i <= endIdx; i++) {
    const segDist = points[i].distanceFromStartMeters - points[i - 1].distanceFromStartMeters;
    if (segDist <= 0) continue;

    const elevDiff = smoothed[i] - smoothed[i - 1];
    const gradient = (elevDiff / segDist) * 100; // can be negative for dips within climb
    // Use absolute gradient for difficulty — descents within a climb also cost energy
    score += gradient * gradient * (segDist / 1000); // normalize by km
  }

  return score;
}

/**
 * Re-detect climbs for all routes if the algorithm version has changed.
 * Preserves user-assigned climb names where possible.
 */
let _storage: import("react-native-mmkv").MMKV | null = null;
async function getStorage() {
  if (!_storage) {
    const { createMMKV } = await import("react-native-mmkv");
    _storage = createMMKV({ id: "climb-detector" });
  }
  return _storage;
}

export async function redetectClimbsIfNeeded(): Promise<void> {
  const storage = await getStorage();

  const storedVersion = storage.getNumber("version") ?? 0;
  if (storedVersion >= CLIMB_DETECTOR_VERSION) return;

  const { getAllRoutes, getRoutePoints, getClimbsForRoute, deleteClimbsForRoute, insertClimbs } =
    await import("@/db/database");
  const { generateId } = await import("@/utils/generateId");

  const routes = await getAllRoutes();

  for (const route of routes) {
    const points = await getRoutePoints(route.id);
    if (points.length < 2) continue;

    // Preserve user-assigned names keyed by start distance
    const oldClimbs = await getClimbsForRoute(route.id);
    const nameMap = new Map<number, string>();
    for (const c of oldClimbs) {
      if (c.name) nameMap.set(Math.round(c.startDistanceMeters), c.name);
    }

    const detected = detectClimbs(points);
    const newClimbs: Climb[] = detected.map((c) => ({
      ...c,
      id: generateId(),
      routeId: route.id,
      name: nameMap.get(Math.round(c.startDistanceMeters)) ?? null,
    }));

    await deleteClimbsForRoute(route.id);
    await insertClimbs(newClimbs);
  }

  storage.set("version", CLIMB_DETECTOR_VERSION);

  // Clear in-memory cache so UI loads fresh data
  const { useClimbStore } = await import("@/store/climbStore");
  useClimbStore.getState().clearClimbCache();
}

/**
 * Run detection against a route's points and persist the result.
 * Returns the Climb records that were inserted.
 */
export async function detectAndStoreClimbs(
  routeId: string,
  points: RoutePoint[],
): Promise<Climb[]> {
  const { insertClimbs } = await import("@/db/database");
  const { generateId } = await import("@/utils/generateId");
  const detected = detectClimbs(points);
  const records: Climb[] = detected.map((c) => ({
    ...c,
    id: generateId(),
    routeId,
    name: null,
  }));
  await insertClimbs(records);
  return records;
}
