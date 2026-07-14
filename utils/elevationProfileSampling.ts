import type { RoutePoint } from "@/types";

export interface ElevationProfileSample {
  distanceMeters: number;
  elevationMeters: number;
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
}

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
  visitor: (distanceMeters: number, elevationMeters: number | null) => void,
): void {
  let hasPendingSample = false;
  let pendingDistanceMeters = 0;
  let pendingElevationMeters: number | null = null;

  const flushPendingSample = () => {
    if (hasPendingSample) visitor(pendingDistanceMeters, pendingElevationMeters);
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
      if (elevationMeters != null) pendingElevationMeters = elevationMeters;
      continue;
    }

    flushPendingSample();
    pendingDistanceMeters = distanceMeters;
    pendingElevationMeters = elevationMeters;
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

  for (const point of points) {
    const distanceMeters = point.distanceFromStartMeters;
    if (!Number.isFinite(distanceMeters)) continue;

    const elevationMeters =
      point.elevationMeters != null && Number.isFinite(point.elevationMeters)
        ? point.elevationMeters
        : null;
    const previous = pending[pending.length - 1];

    if (previous && distanceMeters < previous.distanceMeters) continue;
    if (previous && distanceMeters === previous.distanceMeters) {
      if (elevationMeters != null) previous.elevationMeters = elevationMeters;
      continue;
    }

    pending.push({ distanceMeters, elevationMeters });
  }

  if (pending.length === 0) return [];

  const firstKnownIndex = pending.findIndex((sample) => sample.elevationMeters != null);
  if (firstKnownIndex === -1) {
    return pending.map(({ distanceMeters }) => ({ distanceMeters, elevationMeters: 0 }));
  }

  const elevations = Array.from({ length: pending.length }, () => 0);
  const firstKnownElevation = pending[firstKnownIndex].elevationMeters!;
  for (let index = 0; index <= firstKnownIndex; index++) {
    elevations[index] = firstKnownElevation;
  }

  let previousKnownIndex = firstKnownIndex;
  for (let index = firstKnownIndex + 1; index < pending.length; index++) {
    const nextElevation = pending[index].elevationMeters;
    if (nextElevation == null) continue;

    const previousElevation = pending[previousKnownIndex].elevationMeters!;
    const previousDistance = pending[previousKnownIndex].distanceMeters;
    const distanceSpan = pending[index].distanceMeters - previousDistance;

    for (let gapIndex = previousKnownIndex + 1; gapIndex < index; gapIndex++) {
      const progress =
        distanceSpan > 0 ? (pending[gapIndex].distanceMeters - previousDistance) / distanceSpan : 0;
      elevations[gapIndex] = previousElevation + (nextElevation - previousElevation) * progress;
    }

    elevations[index] = nextElevation;
    previousKnownIndex = index;
  }

  const lastKnownElevation = elevations[previousKnownIndex];
  for (let index = previousKnownIndex + 1; index < pending.length; index++) {
    elevations[index] = lastKnownElevation;
  }

  return pending.map(({ distanceMeters }, index) => ({
    distanceMeters,
    elevationMeters: elevations[index],
  }));
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
  const result: ElevationProfileSample[] = [
    {
      distanceMeters: start,
      elevationMeters: interpolateElevationAtDistance(samples, start),
    },
  ];

  if (end === start) return result;

  const firstInteriorIndex = upperBound(samples, start);
  const endInteriorIndex = lowerBound(samples, end);
  for (let index = firstInteriorIndex; index < endInteriorIndex; index++) {
    result.push(samples[index]);
  }

  result.push({
    distanceMeters: end,
    elevationMeters: interpolateElevationAtDistance(samples, end),
  });
  return result;
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
  if (budget === 2) return [first, last];

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

    return [first, samples[selectedIndex], last];
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
  return result;
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

  forEachCanonicalRouteElevation(points, (distanceMeters) => {
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
  forEachCanonicalRouteElevation(points, (distanceMeters, elevationMeters) => {
    if (elevationMeters == null) return;

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
  if (distanceSpan === 0) return [firstSample];

  const lastSample = { distanceMeters: endDistanceMeters, elevationMeters: endElevationMeters };
  if (budget === 2) return [firstSample, lastSample];

  if (budget === 3) {
    let selectedDistanceMeters = 0;
    let selectedElevationMeters = 0;
    let largestDeviation = -1;

    forEachCanonicalRouteElevation(points, (distanceMeters, elevationMeters) => {
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

    return largestDeviation >= 0
      ? [
          firstSample,
          {
            distanceMeters: selectedDistanceMeters,
            elevationMeters: selectedElevationMeters,
          },
          lastSample,
        ]
      : [firstSample, lastSample];
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
  return result;
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
