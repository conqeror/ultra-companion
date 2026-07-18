import type { RoutePoint } from "@/types";

export interface ElevationProfileSample {
  distanceMeters: number;
  elevationMeters: number;
  /** Starts a new terrain subpath; the previous sample must not be connected. */
  breakBefore?: boolean;
}

export interface ElevationProfileSamplingOptions {
  pixelWidth: number;
  samplesPerPixel?: number;
  maxSamples?: number;
  startDistanceMeters?: number;
  endDistanceMeters?: number;
}

export interface ElevationSampleIndexRange {
  startIndex: number;
  endIndexExclusive: number;
}

export interface ElevationTileIndexRange {
  firstTileIndex: number;
  lastTileIndex: number;
}

export interface ElevationDistanceRange {
  startDistanceMeters: number;
  endDistanceMeters: number;
}

export interface VisibleElevationTileRangeOptions {
  scrollOffsetPixels: number;
  viewportWidthPixels: number;
  tileWidthPixels: number;
  contentWidthPixels: number;
  overscanTiles?: number;
}

export interface ElevationTileDistanceRangeOptions {
  tileIndex: number;
  tileWidthPixels: number;
  pixelsPerMeter: number;
  contentStartDistanceMeters: number;
  contentEndDistanceMeters: number;
}

interface PendingElevationSample {
  distanceMeters: number;
  elevationMeters: number | null;
  breakBefore: boolean;
  breakAfter: boolean;
}

interface CanonicalRouteElevation extends PendingElevationSample {}

interface ElevationBoundaryAnchor {
  hasBefore: boolean;
  beforeDistanceMeters: number;
  beforeElevationMeters: number;
  hasAfter: boolean;
  afterDistanceMeters: number;
  afterElevationMeters: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function lowerBound(
  samples: readonly ElevationProfileSample[],
  targetDistanceMeters: number,
): number {
  let low = 0;
  let high = samples.length;

  while (low < high) {
    const middle = (low + high) >>> 1;
    if (samples[middle].distanceMeters < targetDistanceMeters) low = middle + 1;
    else high = middle;
  }

  return low;
}

function upperBound(
  samples: readonly ElevationProfileSample[],
  targetDistanceMeters: number,
): number {
  let low = 0;
  let high = samples.length;

  while (low < high) {
    const middle = (low + high) >>> 1;
    if (samples[middle].distanceMeters <= targetDistanceMeters) low = middle + 1;
    else high = middle;
  }

  return low;
}

function forEachCanonicalRouteElevation(
  points: readonly RoutePoint[],
  visitor: (sample: CanonicalRouteElevation) => void,
): void {
  let hasPendingSample = false;
  let pendingDistanceMeters = 0;
  let pendingElevationMeters: number | null = null;
  let pendingBreakBefore = false;
  let pendingBreakAfter = false;
  let breakBeforeNextSample = false;

  const flushPendingSample = () => {
    if (!hasPendingSample) return;
    visitor({
      distanceMeters: pendingDistanceMeters,
      elevationMeters: pendingElevationMeters,
      breakBefore: pendingBreakBefore,
      breakAfter: pendingBreakAfter,
    });
  };

  for (let pointIndex = 0; pointIndex < points.length; pointIndex++) {
    const point = points[pointIndex];
    const distanceMeters = point.distanceFromStartMeters;
    if (!Number.isFinite(distanceMeters)) continue;

    const elevationMeters =
      point.elevationMeters != null && Number.isFinite(point.elevationMeters)
        ? point.elevationMeters
        : null;

    if (!hasPendingSample) {
      hasPendingSample = true;
      pendingDistanceMeters = distanceMeters;
      pendingElevationMeters = elevationMeters;
      continue;
    }

    if (distanceMeters < pendingDistanceMeters) continue;
    if (distanceMeters === pendingDistanceMeters) {
      if (elevationMeters != null) {
        pendingElevationMeters = elevationMeters;
      } else if (pendingElevationMeters != null) {
        // Ferry profile projection emits a finite boarding point followed by a
        // null landing sentinel at the same riding distance. Keep the boarding
        // elevation, and start a disconnected segment at the next route point.
        pendingBreakAfter = true;
        breakBeforeNextSample = true;
      }
      continue;
    }

    flushPendingSample();
    pendingDistanceMeters = distanceMeters;
    pendingElevationMeters = elevationMeters;
    pendingBreakBefore = breakBeforeNextSample;
    pendingBreakAfter = false;
    breakBeforeNextSample = false;
  }

  flushPendingSample();
}

function updateBoundaryAnchor(
  anchor: ElevationBoundaryAnchor,
  targetDistanceMeters: number,
  distanceMeters: number,
  elevationMeters: number,
): void {
  if (distanceMeters <= targetDistanceMeters) {
    anchor.hasBefore = true;
    anchor.beforeDistanceMeters = distanceMeters;
    anchor.beforeElevationMeters = elevationMeters;
  }
  if (!anchor.hasAfter && distanceMeters >= targetDistanceMeters) {
    anchor.hasAfter = true;
    anchor.afterDistanceMeters = distanceMeters;
    anchor.afterElevationMeters = elevationMeters;
  }
}

function resolveBoundaryElevation(
  anchor: ElevationBoundaryAnchor,
  targetDistanceMeters: number,
): number {
  if (!anchor.hasBefore && !anchor.hasAfter) return 0;
  if (!anchor.hasBefore) return anchor.afterElevationMeters;
  if (!anchor.hasAfter) return anchor.beforeElevationMeters;

  const distanceSpan = anchor.afterDistanceMeters - anchor.beforeDistanceMeters;
  if (distanceSpan <= 0) return anchor.afterElevationMeters;

  const progress = (targetDistanceMeters - anchor.beforeDistanceMeters) / distanceSpan;
  return (
    anchor.beforeElevationMeters +
    (anchor.afterElevationMeters - anchor.beforeElevationMeters) * progress
  );
}

function emptyBoundaryAnchor(): ElevationBoundaryAnchor {
  return {
    hasBefore: false,
    beforeDistanceMeters: 0,
    beforeElevationMeters: 0,
    hasAfter: false,
    afterDistanceMeters: 0,
    afterElevationMeters: 0,
  };
}

/**
 * Converts route points into finite samples with strictly increasing distances.
 *
 * Duplicate distances use the most recent finite elevation, distance regressions
 * are ignored, and missing elevations are linearly interpolated. Leading and
 * trailing gaps use the nearest known elevation. An all-null route uses 0m.
 */
export function buildElevationProfileSamples(
  points: readonly RoutePoint[],
): ElevationProfileSample[] {
  const pending: PendingElevationSample[] = [];
  forEachCanonicalRouteElevation(points, (sample) => pending.push(sample));

  if (pending.length === 0) return [];
  const elevations = Array.from({ length: pending.length }, () => 0);

  const fillSegment = (startIndex: number, endIndexExclusive: number) => {
    let firstKnownIndex = -1;
    for (let index = startIndex; index < endIndexExclusive; index++) {
      if (pending[index].elevationMeters != null) {
        firstKnownIndex = index;
        break;
      }
    }
    if (firstKnownIndex === -1) return;

    const firstKnownElevation = pending[firstKnownIndex].elevationMeters!;
    for (let index = startIndex; index <= firstKnownIndex; index++) {
      elevations[index] = firstKnownElevation;
    }

    let previousKnownIndex = firstKnownIndex;
    for (let index = firstKnownIndex + 1; index < endIndexExclusive; index++) {
      const nextElevation = pending[index].elevationMeters;
      if (nextElevation == null) continue;

      const previousElevation = pending[previousKnownIndex].elevationMeters!;
      const previousDistance = pending[previousKnownIndex].distanceMeters;
      const distanceSpan = pending[index].distanceMeters - previousDistance;
      for (let gapIndex = previousKnownIndex + 1; gapIndex < index; gapIndex++) {
        const progress =
          distanceSpan > 0
            ? (pending[gapIndex].distanceMeters - previousDistance) / distanceSpan
            : 0;
        elevations[gapIndex] = previousElevation + (nextElevation - previousElevation) * progress;
      }
      elevations[index] = nextElevation;
      previousKnownIndex = index;
    }

    const lastKnownElevation = elevations[previousKnownIndex];
    for (let index = previousKnownIndex + 1; index < endIndexExclusive; index++) {
      elevations[index] = lastKnownElevation;
    }
  };

  let segmentStartIndex = 0;
  for (let index = 1; index < pending.length; index++) {
    if (!pending[index].breakBefore) continue;
    fillSegment(segmentStartIndex, index);
    segmentStartIndex = index;
  }
  fillSegment(segmentStartIndex, pending.length);

  return pending.map(({ distanceMeters, breakBefore }, index) =>
    breakBefore
      ? { distanceMeters, elevationMeters: elevations[index], breakBefore: true }
      : { distanceMeters, elevationMeters: elevations[index] },
  );
}

/** Splits finite profile samples into renderer-neutral disconnected subpaths. */
export function splitElevationProfileSamplesAtBreaks(
  samples: readonly ElevationProfileSample[],
): ElevationProfileSample[][] {
  const segments: ElevationProfileSample[][] = [];
  let segment: ElevationProfileSample[] = [];

  for (const sample of samples) {
    if (sample.breakBefore && segment.length > 0) {
      segments.push(segment);
      segment = [];
    }
    segment.push(sample);
  }
  if (segment.length > 0) segments.push(segment);
  return segments;
}

export function interpolateElevationAtDistance(
  samples: readonly ElevationProfileSample[],
  distanceMeters: number,
  fallbackElevationMeters = 0,
): number {
  if (samples.length === 0) return fallbackElevationMeters;
  if (Number.isNaN(distanceMeters)) return samples[0].elevationMeters;

  const nextIndex = lowerBound(samples, distanceMeters);
  if (nextIndex === 0) return samples[0].elevationMeters;
  if (nextIndex >= samples.length) return samples[samples.length - 1].elevationMeters;

  const next = samples[nextIndex];
  if (next.distanceMeters === distanceMeters) return next.elevationMeters;

  const previous = samples[nextIndex - 1];
  const distanceSpan = next.distanceMeters - previous.distanceMeters;
  if (distanceSpan <= 0) return next.elevationMeters;

  const progress = (distanceMeters - previous.distanceMeters) / distanceSpan;
  return previous.elevationMeters + (next.elevationMeters - previous.elevationMeters) * progress;
}

function isInsideElevationBreak(
  samples: readonly ElevationProfileSample[],
  distanceMeters: number,
): boolean {
  const nextIndex = lowerBound(samples, distanceMeters);
  if (nextIndex <= 0 || nextIndex >= samples.length) return false;

  const previous = samples[nextIndex - 1];
  const next = samples[nextIndex];
  return (
    next.breakBefore === true &&
    distanceMeters > previous.distanceMeters &&
    distanceMeters < next.distanceMeters
  );
}

function boundaryElevationSample(
  samples: readonly ElevationProfileSample[],
  distanceMeters: number,
  preserveBreakBefore: boolean,
): ElevationProfileSample {
  const exactIndex = lowerBound(samples, distanceMeters);
  const exact = samples[exactIndex];
  if (exact?.distanceMeters === distanceMeters) {
    return {
      distanceMeters,
      elevationMeters: exact.elevationMeters,
      ...(preserveBreakBefore && exact.breakBefore ? { breakBefore: true } : {}),
    };
  }
  return {
    distanceMeters,
    elevationMeters: interpolateElevationAtDistance(samples, distanceMeters),
  };
}

/** Returns a distance-clamped sample window with interpolated samples at both edges. */
export function sliceElevationSamples(
  samples: readonly ElevationProfileSample[],
  startDistanceMeters: number,
  endDistanceMeters: number,
): ElevationProfileSample[] {
  if (samples.length === 0) return [];

  const firstDistance = samples[0].distanceMeters;
  const lastDistance = samples[samples.length - 1].distanceMeters;
  let requestedStart = Number.isNaN(startDistanceMeters) ? firstDistance : startDistanceMeters;
  let requestedEnd = Number.isNaN(endDistanceMeters) ? lastDistance : endDistanceMeters;

  if (requestedStart > requestedEnd) {
    [requestedStart, requestedEnd] = [requestedEnd, requestedStart];
  }

  const start = clamp(requestedStart, firstDistance, lastDistance);
  const end = clamp(requestedEnd, firstDistance, lastDistance);
  const result: ElevationProfileSample[] = [];
  const startInsideBreak = isInsideElevationBreak(samples, start);
  const endInsideBreak = isInsideElevationBreak(samples, end);
  if (!startInsideBreak) result.push(boundaryElevationSample(samples, start, false));

  if (end === start) return result;

  const firstInteriorIndex = upperBound(samples, start);
  const endInteriorIndex = lowerBound(samples, end);
  for (let index = firstInteriorIndex; index < endInteriorIndex; index++) {
    result.push(samples[index]);
  }

  if (!endInsideBreak) result.push(boundaryElevationSample(samples, end, true));
  return result;
}

function mergeElevationProfileSamples(
  selected: readonly ElevationProfileSample[],
  required: readonly ElevationProfileSample[],
): ElevationProfileSample[] {
  if (required.length === 0) return Array.from(selected);

  const byDistance = new Map<number, ElevationProfileSample>();
  for (const sample of [...selected, ...required]) {
    const previous = byDistance.get(sample.distanceMeters);
    byDistance.set(sample.distanceMeters, {
      distanceMeters: sample.distanceMeters,
      elevationMeters: sample.elevationMeters,
      ...(previous?.breakBefore || sample.breakBefore ? { breakBefore: true } : {}),
    });
  }
  return [...byDistance.values()].sort((a, b) => a.distanceMeters - b.distanceMeters);
}

function preserveElevationBreakSamples(
  source: readonly ElevationProfileSample[],
  selected: readonly ElevationProfileSample[],
): ElevationProfileSample[] {
  const required: ElevationProfileSample[] = [];
  for (let index = 0; index < source.length; index++) {
    if (!source[index].breakBefore) continue;
    if (index > 0) required.push(source[index - 1]);
    required.push(source[index]);
  }
  return mergeElevationProfileSamples(selected, required);
}

/**
 * Min/max bucket downsampling. Every bucket keeps its local low and high in
 * source order while the route/window endpoints are always retained.
 */
export function downsampleElevationExtrema(
  samples: readonly ElevationProfileSample[],
  maxSamples: number,
): ElevationProfileSample[] {
  const budget = Math.floor(maxSamples);
  if (!Number.isFinite(maxSamples) || budget < 2) {
    throw new RangeError("maxSamples must be a finite number greater than or equal to 2");
  }
  if (samples.length <= budget) return Array.from(samples);

  const first = samples[0];
  const last = samples[samples.length - 1];
  if (budget === 2) return preserveElevationBreakSamples(samples, [first, last]);

  if (budget === 3) {
    const distanceSpan = last.distanceMeters - first.distanceMeters;
    let selectedIndex = 1;
    let largestDeviation = -1;

    for (let index = 1; index < samples.length - 1; index++) {
      const progress =
        distanceSpan > 0
          ? (samples[index].distanceMeters - first.distanceMeters) / distanceSpan
          : 0;
      const baseline =
        first.elevationMeters + (last.elevationMeters - first.elevationMeters) * progress;
      const deviation = Math.abs(samples[index].elevationMeters - baseline);
      if (deviation > largestDeviation) {
        selectedIndex = index;
        largestDeviation = deviation;
      }
    }

    return preserveElevationBreakSamples(samples, [first, samples[selectedIndex], last]);
  }

  const bucketCount = Math.floor((budget - 2) / 2);
  const distanceSpan = last.distanceMeters - first.distanceMeters;
  const minimumIndexes = Array.from({ length: bucketCount }, () => -1);
  const maximumIndexes = Array.from({ length: bucketCount }, () => -1);
  const result: ElevationProfileSample[] = [first];

  for (let index = 1; index < samples.length - 1; index++) {
    const distanceProgress =
      distanceSpan > 0
        ? (samples[index].distanceMeters - first.distanceMeters) / distanceSpan
        : index / (samples.length - 1);
    const bucketIndex = Math.min(
      bucketCount - 1,
      Math.max(0, Math.floor(distanceProgress * bucketCount)),
    );
    const minimumIndex = minimumIndexes[bucketIndex];
    const maximumIndex = maximumIndexes[bucketIndex];

    if (
      minimumIndex === -1 ||
      samples[index].elevationMeters < samples[minimumIndex].elevationMeters
    ) {
      minimumIndexes[bucketIndex] = index;
    }
    if (
      maximumIndex === -1 ||
      samples[index].elevationMeters > samples[maximumIndex].elevationMeters
    ) {
      maximumIndexes[bucketIndex] = index;
    }
  }

  for (let bucketIndex = 0; bucketIndex < bucketCount; bucketIndex++) {
    const minimumIndex = minimumIndexes[bucketIndex];
    const maximumIndex = maximumIndexes[bucketIndex];
    if (minimumIndex === -1 || maximumIndex === -1) continue;

    if (minimumIndex === maximumIndex) {
      result.push(samples[minimumIndex]);
    } else if (minimumIndex < maximumIndex) {
      result.push(samples[minimumIndex], samples[maximumIndex]);
    } else {
      result.push(samples[maximumIndex], samples[minimumIndex]);
    }
  }

  result.push(last);
  return preserveElevationBreakSamples(samples, result);
}

export function getElevationSampleBudget(
  pixelWidth: number,
  samplesPerPixel = 1,
  maxSamples = Number.MAX_SAFE_INTEGER,
): number {
  const safePixelWidth = Number.isFinite(pixelWidth) ? Math.max(0, pixelWidth) : 0;
  const safeSamplesPerPixel =
    Number.isFinite(samplesPerPixel) && samplesPerPixel > 0 ? samplesPerPixel : 1;
  const safeMaximum = Number.isFinite(maxSamples)
    ? Math.max(2, Math.floor(maxSamples))
    : Number.MAX_SAFE_INTEGER;
  const requested = Math.ceil(safePixelWidth * safeSamplesPerPixel);
  const pixelBudget = Number.isSafeInteger(requested)
    ? Math.max(2, requested)
    : Number.MAX_SAFE_INTEGER;

  return Math.min(pixelBudget, safeMaximum);
}

/**
 * Returns a distance interval that keeps interval-based sampling near a fixed
 * output limit, including the route endpoints.
 */
export function getElevationIntervalForSampleLimit(
  totalDistanceMeters: number,
  maxSamples: number,
  minimumIntervalMeters = 0,
): number {
  const safeTotalDistance = Number.isFinite(totalDistanceMeters)
    ? Math.max(0, totalDistanceMeters)
    : 0;
  const safeMaximum = Number.isFinite(maxSamples) ? Math.max(2, Math.floor(maxSamples)) : 2;
  const safeMinimumInterval = Number.isFinite(minimumIntervalMeters)
    ? Math.max(0, minimumIntervalMeters)
    : 0;

  // Leave one spare slot because interval samplers commonly append the exact
  // endpoint after their floating-point stepping loop.
  return Math.max(safeMinimumInterval, safeTotalDistance / Math.max(1, safeMaximum - 2));
}

/**
 * Builds a finite profile and bounds its output by rendered pixel density.
 * The route is scanned without materializing a normalized copy, so additional
 * storage remains O(output budget), not O(route point count).
 */
export function sampleElevationProfileForPixels(
  points: readonly RoutePoint[],
  options: ElevationProfileSamplingOptions,
): ElevationProfileSample[] {
  const budget = getElevationSampleBudget(
    options.pixelWidth,
    options.samplesPerPixel,
    options.maxSamples,
  );
  let hasRouteDistance = false;
  let firstRouteDistanceMeters = 0;
  let lastRouteDistanceMeters = 0;

  forEachCanonicalRouteElevation(points, ({ distanceMeters }) => {
    if (!hasRouteDistance) {
      hasRouteDistance = true;
      firstRouteDistanceMeters = distanceMeters;
    }
    lastRouteDistanceMeters = distanceMeters;
  });
  if (!hasRouteDistance) return [];

  let requestedStart = options.startDistanceMeters ?? firstRouteDistanceMeters;
  let requestedEnd = options.endDistanceMeters ?? lastRouteDistanceMeters;
  if (Number.isNaN(requestedStart)) requestedStart = firstRouteDistanceMeters;
  if (Number.isNaN(requestedEnd)) requestedEnd = lastRouteDistanceMeters;
  if (requestedStart > requestedEnd)
    [requestedStart, requestedEnd] = [requestedEnd, requestedStart];

  const startDistanceMeters = clamp(
    requestedStart,
    firstRouteDistanceMeters,
    lastRouteDistanceMeters,
  );
  const endDistanceMeters = clamp(requestedEnd, firstRouteDistanceMeters, lastRouteDistanceMeters);
  const distanceSpan = endDistanceMeters - startDistanceMeters;
  const bucketCount = budget >= 4 && distanceSpan > 0 ? Math.floor((budget - 2) / 2) : 0;
  const minimumDistances = new Float64Array(bucketCount);
  const minimumElevations = new Float64Array(bucketCount);
  const maximumDistances = new Float64Array(bucketCount);
  const maximumElevations = new Float64Array(bucketCount);
  minimumElevations.fill(Number.POSITIVE_INFINITY);
  maximumElevations.fill(Number.NEGATIVE_INFINITY);

  const startAnchor = emptyBoundaryAnchor();
  const endAnchor = emptyBoundaryAnchor();
  const requiredBreakSamples: ElevationProfileSample[] = [];
  let breakBeforeNextFiniteSample = false;
  forEachCanonicalRouteElevation(points, (sample) => {
    const { distanceMeters, elevationMeters } = sample;
    if (sample.breakBefore) breakBeforeNextFiniteSample = true;
    if (elevationMeters == null) return;

    if (
      sample.breakAfter &&
      distanceMeters >= startDistanceMeters &&
      distanceMeters <= endDistanceMeters
    ) {
      requiredBreakSamples.push({ distanceMeters, elevationMeters });
    }
    if (breakBeforeNextFiniteSample) {
      if (distanceMeters > startDistanceMeters && distanceMeters <= endDistanceMeters) {
        requiredBreakSamples.push({
          distanceMeters,
          elevationMeters,
          breakBefore: true,
        });
      }
      breakBeforeNextFiniteSample = false;
    }

    updateBoundaryAnchor(startAnchor, startDistanceMeters, distanceMeters, elevationMeters);
    updateBoundaryAnchor(endAnchor, endDistanceMeters, distanceMeters, elevationMeters);

    if (
      bucketCount === 0 ||
      distanceMeters <= startDistanceMeters ||
      distanceMeters >= endDistanceMeters
    ) {
      return;
    }

    const distanceProgress = (distanceMeters - startDistanceMeters) / distanceSpan;
    const bucketIndex = Math.min(bucketCount - 1, Math.floor(distanceProgress * bucketCount));
    if (elevationMeters < minimumElevations[bucketIndex]) {
      minimumDistances[bucketIndex] = distanceMeters;
      minimumElevations[bucketIndex] = elevationMeters;
    }
    if (elevationMeters > maximumElevations[bucketIndex]) {
      maximumDistances[bucketIndex] = distanceMeters;
      maximumElevations[bucketIndex] = elevationMeters;
    }
  });

  const startElevationMeters = resolveBoundaryElevation(startAnchor, startDistanceMeters);
  const endElevationMeters = resolveBoundaryElevation(endAnchor, endDistanceMeters);
  const firstSample = {
    distanceMeters: startDistanceMeters,
    elevationMeters: startElevationMeters,
  };
  if (distanceSpan === 0) return mergeElevationProfileSamples([firstSample], requiredBreakSamples);

  const lastSample = { distanceMeters: endDistanceMeters, elevationMeters: endElevationMeters };
  if (budget === 2) {
    return mergeElevationProfileSamples([firstSample, lastSample], requiredBreakSamples);
  }

  if (budget === 3) {
    let selectedDistanceMeters = 0;
    let selectedElevationMeters = 0;
    let largestDeviation = -1;

    forEachCanonicalRouteElevation(points, ({ distanceMeters, elevationMeters }) => {
      if (
        elevationMeters == null ||
        distanceMeters <= startDistanceMeters ||
        distanceMeters >= endDistanceMeters
      ) {
        return;
      }

      const distanceProgress = (distanceMeters - startDistanceMeters) / distanceSpan;
      const baseline =
        startElevationMeters + (endElevationMeters - startElevationMeters) * distanceProgress;
      const deviation = Math.abs(elevationMeters - baseline);
      if (deviation > largestDeviation) {
        selectedDistanceMeters = distanceMeters;
        selectedElevationMeters = elevationMeters;
        largestDeviation = deviation;
      }
    });

    const selected =
      largestDeviation >= 0
        ? [
            firstSample,
            {
              distanceMeters: selectedDistanceMeters,
              elevationMeters: selectedElevationMeters,
            },
            lastSample,
          ]
        : [firstSample, lastSample];
    return mergeElevationProfileSamples(selected, requiredBreakSamples);
  }

  const result: ElevationProfileSample[] = [firstSample];
  for (let bucketIndex = 0; bucketIndex < bucketCount; bucketIndex++) {
    const minimumElevation = minimumElevations[bucketIndex];
    const maximumElevation = maximumElevations[bucketIndex];
    if (!Number.isFinite(minimumElevation) || !Number.isFinite(maximumElevation)) continue;

    const minimumDistance = minimumDistances[bucketIndex];
    const maximumDistance = maximumDistances[bucketIndex];
    if (minimumDistance === maximumDistance) {
      result.push({ distanceMeters: minimumDistance, elevationMeters: minimumElevation });
    } else if (minimumDistance < maximumDistance) {
      result.push(
        { distanceMeters: minimumDistance, elevationMeters: minimumElevation },
        { distanceMeters: maximumDistance, elevationMeters: maximumElevation },
      );
    } else {
      result.push(
        { distanceMeters: maximumDistance, elevationMeters: maximumElevation },
        { distanceMeters: minimumDistance, elevationMeters: minimumElevation },
      );
    }
  }
  result.push(lastSample);
  return mergeElevationProfileSamples(result, requiredBreakSamples);
}

/**
 * Finds samples intersecting a distance range. Adjacent samples are included by
 * default so a renderer can interpolate both tile edges without visible seams.
 */
export function getElevationSampleIndexRange(
  samples: readonly ElevationProfileSample[],
  startDistanceMeters: number,
  endDistanceMeters: number,
  includeAdjacentSamples = true,
): ElevationSampleIndexRange {
  if (samples.length === 0) return { startIndex: 0, endIndexExclusive: 0 };

  let start = Number.isNaN(startDistanceMeters) ? samples[0].distanceMeters : startDistanceMeters;
  let end = Number.isNaN(endDistanceMeters)
    ? samples[samples.length - 1].distanceMeters
    : endDistanceMeters;
  if (start > end) [start, end] = [end, start];

  let startIndex = lowerBound(samples, start);
  let endIndexExclusive = upperBound(samples, end);

  if (includeAdjacentSamples) {
    startIndex = Math.max(0, startIndex - 1);
    endIndexExclusive = Math.min(samples.length, endIndexExclusive + 1);
  }

  return { startIndex, endIndexExclusive };
}

/** Returns the inclusive tile indexes needed for a viewport plus overscan. */
export function getVisibleElevationTileRange(
  options: VisibleElevationTileRangeOptions,
): ElevationTileIndexRange | null {
  const { viewportWidthPixels, tileWidthPixels, contentWidthPixels } = options;
  if (
    !Number.isFinite(viewportWidthPixels) ||
    !Number.isFinite(tileWidthPixels) ||
    !Number.isFinite(contentWidthPixels) ||
    viewportWidthPixels <= 0 ||
    tileWidthPixels <= 0 ||
    contentWidthPixels <= 0
  ) {
    return null;
  }

  const tileCount = Math.ceil(contentWidthPixels / tileWidthPixels);
  const maxScrollOffset = Math.max(0, contentWidthPixels - viewportWidthPixels);
  const requestedScrollOffset = Number.isFinite(options.scrollOffsetPixels)
    ? options.scrollOffsetPixels
    : 0;
  const scrollOffset = clamp(requestedScrollOffset, 0, maxScrollOffset);
  const visibleEnd = Math.min(contentWidthPixels, scrollOffset + viewportWidthPixels);
  const overscan =
    Number.isFinite(options.overscanTiles) && options.overscanTiles! > 0
      ? Math.floor(options.overscanTiles!)
      : 0;
  const firstVisibleTile = Math.floor(scrollOffset / tileWidthPixels);
  const lastVisibleTile = Math.max(firstVisibleTile, Math.ceil(visibleEnd / tileWidthPixels) - 1);

  return {
    firstTileIndex: Math.max(0, firstVisibleTile - overscan),
    lastTileIndex: Math.min(tileCount - 1, lastVisibleTile + overscan),
  };
}

/** Maps one horizontal render tile to its clamped route-distance range. */
export function getElevationTileDistanceRange(
  options: ElevationTileDistanceRangeOptions,
): ElevationDistanceRange | null {
  const {
    tileIndex,
    tileWidthPixels,
    pixelsPerMeter,
    contentStartDistanceMeters,
    contentEndDistanceMeters,
  } = options;

  if (
    !Number.isFinite(tileIndex) ||
    !Number.isFinite(tileWidthPixels) ||
    !Number.isFinite(pixelsPerMeter) ||
    !Number.isFinite(contentStartDistanceMeters) ||
    !Number.isFinite(contentEndDistanceMeters) ||
    tileIndex < 0 ||
    tileWidthPixels <= 0 ||
    pixelsPerMeter <= 0 ||
    contentEndDistanceMeters <= contentStartDistanceMeters
  ) {
    return null;
  }

  const normalizedTileIndex = Math.floor(tileIndex);
  const tileDistanceWidth = tileWidthPixels / pixelsPerMeter;
  const startDistanceMeters = contentStartDistanceMeters + normalizedTileIndex * tileDistanceWidth;
  if (startDistanceMeters >= contentEndDistanceMeters) return null;

  return {
    startDistanceMeters,
    endDistanceMeters: Math.min(contentEndDistanceMeters, startDistanceMeters + tileDistanceWidth),
  };
}
