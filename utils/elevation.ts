import type { RoutePoint } from "@/types";

export const ELEVATION_SMOOTHING_WINDOW_M = 200;
export const ELEVATION_GAIN_THRESHOLD_M = 10;
export const ETA_GRADIENT_WINDOW_M = 200;

interface ElevationProcessingOptions {
  smoothingWindowMeters?: number;
  gainThresholdMeters?: number;
}

interface ProcessedElevationProfile {
  points: RoutePoint[];
  totalDistanceMeters: number;
  totalAscentMeters: number;
  totalDescentMeters: number;
}

function isFiniteElevation(value: number | null): value is number {
  return value != null && Number.isFinite(value);
}

function roundMeters(value: number): number {
  return Math.round(value * 10) / 10;
}

function buildFilledElevationSeries(points: RoutePoint[]): number[] | null {
  if (points.length === 0) return [];

  const raw = points.map((point) =>
    isFiniteElevation(point.elevationMeters) ? point.elevationMeters : null,
  );
  if (!raw.some((value) => value != null)) return null;

  const nextKnownIndex = Array.from<number>({ length: raw.length });
  let next = -1;
  for (let i = raw.length - 1; i >= 0; i--) {
    if (raw[i] != null) next = i;
    nextKnownIndex[i] = next;
  }

  const filled = Array.from<number>({ length: raw.length });
  let previous = -1;

  for (let i = 0; i < raw.length; i++) {
    const value = raw[i];
    if (value != null) {
      filled[i] = value;
      previous = i;
      continue;
    }

    const nextIndex = nextKnownIndex[i];
    if (previous >= 0 && nextIndex >= 0) {
      const previousElevation = raw[previous]!;
      const nextElevation = raw[nextIndex]!;
      const previousDistance = points[previous].distanceFromStartMeters;
      const nextDistance = points[nextIndex].distanceFromStartMeters;
      const span = nextDistance - previousDistance;
      const t = span > 0 ? (points[i].distanceFromStartMeters - previousDistance) / span : 0;
      filled[i] = previousElevation + t * (nextElevation - previousElevation);
    } else if (previous >= 0) {
      filled[i] = raw[previous]!;
    } else {
      filled[i] = raw[nextIndex]!;
    }
  }

  return filled;
}

function smoothElevationSeries(
  points: RoutePoint[],
  elevations: number[],
  windowMeters: number,
): number[] {
  if (points.length <= 2 || windowMeters <= 0) return elevations.slice();

  const halfWindow = windowMeters / 2;
  const smoothed = Array.from<number>({ length: elevations.length });
  let windowStart = 0;
  let windowEnd = 0;
  let windowSum = 0;
  let windowCount = 0;

  for (let i = 0; i < points.length; i++) {
    const centerDistance = points[i].distanceFromStartMeters;
    const lo = centerDistance - halfWindow;
    const hi = centerDistance + halfWindow;

    while (windowEnd < points.length && points[windowEnd].distanceFromStartMeters <= hi) {
      windowSum += elevations[windowEnd];
      windowCount++;
      windowEnd++;
    }

    while (windowStart < points.length && points[windowStart].distanceFromStartMeters < lo) {
      windowSum -= elevations[windowStart];
      windowCount--;
      windowStart++;
    }

    smoothed[i] = windowCount > 0 ? windowSum / windowCount : elevations[i];
  }

  return smoothed;
}

export function computeTrustedElevationTotals(
  points: Array<{ elevationMeters: number | null }>,
  thresholdMeters = ELEVATION_GAIN_THRESHOLD_M,
): { ascent: number; descent: number } {
  const elevations = points
    .map((point) => point.elevationMeters)
    .filter((value): value is number => isFiniteElevation(value));

  if (elevations.length < 2) return { ascent: 0, descent: 0 };

  const threshold = Math.max(0, thresholdMeters);
  if (threshold === 0) {
    let ascent = 0;
    let descent = 0;
    for (let i = 1; i < elevations.length; i++) {
      const diff = elevations[i] - elevations[i - 1];
      if (diff > 0) ascent += diff;
      else descent += Math.abs(diff);
    }
    return { ascent: roundMeters(ascent), descent: roundMeters(descent) };
  }

  let ascent = 0;
  let descent = 0;
  let trend: -1 | 0 | 1 = 0;
  let anchor = elevations[0];
  let extreme = elevations[0];
  let low = elevations[0];
  let high = elevations[0];
  let lowIndex = 0;
  let highIndex = 0;

  for (let i = 1; i < elevations.length; i++) {
    const elevation = elevations[i];

    if (trend === 0) {
      if (elevation < low) {
        low = elevation;
        lowIndex = i;
      }
      if (elevation > high) {
        high = elevation;
        highIndex = i;
      }
      if (high - low >= threshold) {
        if (lowIndex < highIndex) {
          trend = 1;
          anchor = low;
          extreme = high;
        } else {
          trend = -1;
          anchor = high;
          extreme = low;
        }
      }
      continue;
    }

    if (trend === 1) {
      if (elevation >= extreme) {
        extreme = elevation;
      } else if (extreme - elevation >= threshold) {
        ascent += extreme - anchor;
        trend = -1;
        anchor = extreme;
        extreme = elevation;
      }
      continue;
    }

    if (elevation <= extreme) {
      extreme = elevation;
    } else if (elevation - extreme >= threshold) {
      descent += anchor - extreme;
      trend = 1;
      anchor = extreme;
      extreme = elevation;
    }
  }

  if (trend === 1) ascent += extreme - anchor;
  else if (trend === -1) descent += anchor - extreme;

  return { ascent: roundMeters(ascent), descent: roundMeters(descent) };
}

export function processRouteElevations(
  points: RoutePoint[],
  options: ElevationProcessingOptions = {},
): ProcessedElevationProfile {
  const totalDistanceMeters = points[points.length - 1]?.distanceFromStartMeters ?? 0;
  const filled = buildFilledElevationSeries(points);

  if (!filled) {
    return {
      points: points.map((point) => ({
        ...point,
        elevationMeters: isFiniteElevation(point.elevationMeters) ? point.elevationMeters : null,
      })),
      totalDistanceMeters,
      totalAscentMeters: 0,
      totalDescentMeters: 0,
    };
  }

  const smoothed = smoothElevationSeries(
    points,
    filled,
    options.smoothingWindowMeters ?? ELEVATION_SMOOTHING_WINDOW_M,
  );
  const processedPoints = points.map((point, index) => ({
    ...point,
    elevationMeters: roundMeters(smoothed[index]),
  }));
  const totals = computeTrustedElevationTotals(
    processedPoints,
    options.gainThresholdMeters ?? ELEVATION_GAIN_THRESHOLD_M,
  );

  return {
    points: processedPoints,
    totalDistanceMeters,
    totalAscentMeters: totals.ascent,
    totalDescentMeters: totals.descent,
  };
}

function findFirstPointAtOrAfterDistance(
  points: RoutePoint[],
  targetDistanceMeters: number,
): number {
  let lo = 0;
  let hi = points.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (points[mid].distanceFromStartMeters < targetDistanceMeters) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function interpolateElevationAtDistance(
  points: RoutePoint[],
  targetDistanceMeters: number,
): number | null {
  if (points.length === 0) return null;
  if (points.length === 1 || targetDistanceMeters <= points[0].distanceFromStartMeters) {
    return isFiniteElevation(points[0].elevationMeters) ? points[0].elevationMeters : null;
  }

  const last = points[points.length - 1];
  if (targetDistanceMeters >= last.distanceFromStartMeters) {
    return isFiniteElevation(last.elevationMeters) ? last.elevationMeters : null;
  }

  const hi = findFirstPointAtOrAfterDistance(points, targetDistanceMeters);
  const lo = Math.max(0, hi - 1);
  const a = points[lo];
  const b = points[hi];
  if (!isFiniteElevation(a.elevationMeters) || !isFiniteElevation(b.elevationMeters)) return null;

  const segmentMeters = b.distanceFromStartMeters - a.distanceFromStartMeters;
  if (segmentMeters <= 0) return a.elevationMeters;

  const t = (targetDistanceMeters - a.distanceFromStartMeters) / segmentMeters;
  return a.elevationMeters + t * (b.elevationMeters - a.elevationMeters);
}

export function computeWindowedGradient(
  points: RoutePoint[],
  segmentIndex: number,
  windowMeters = ETA_GRADIENT_WINDOW_M,
): number {
  if (segmentIndex <= 0 || segmentIndex >= points.length) return 0;

  const prev = points[segmentIndex - 1];
  const curr = points[segmentIndex];
  const segmentMeters = curr.distanceFromStartMeters - prev.distanceFromStartMeters;
  if (segmentMeters <= 0) return 0;

  const routeStart = points[0].distanceFromStartMeters;
  const routeEnd = points[points.length - 1].distanceFromStartMeters;
  const center = (prev.distanceFromStartMeters + curr.distanceFromStartMeters) / 2;
  const halfWindow = Math.max(0, windowMeters / 2);
  const fromDistance = Math.max(routeStart, center - halfWindow);
  const toDistance = Math.min(routeEnd, center + halfWindow);
  const gradientDistance = toDistance - fromDistance;

  if (gradientDistance <= 0) {
    const diff = (curr.elevationMeters ?? 0) - (prev.elevationMeters ?? 0);
    return diff / segmentMeters;
  }

  const fromElevation = interpolateElevationAtDistance(points, fromDistance);
  const toElevation = interpolateElevationAtDistance(points, toDistance);
  if (fromElevation == null || toElevation == null) return 0;

  return (toElevation - fromElevation) / gradientDistance;
}
