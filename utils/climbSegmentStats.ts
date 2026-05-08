import type { RoutePoint } from "@/types";
import {
  computeSliceElevationTotalsFromDistance,
  findFirstPointAtOrAfterDistance,
  interpolateRoutePointAtDistance,
} from "@/utils/geo";

const MAX_GRADIENT_WINDOW_M = 200;
const MIN_GRADIENT_WINDOW_M = 50;

export interface ClimbSegmentStats {
  gainMeters: number;
  lengthMeters: number;
  averageGradientPercent: number;
  maxGradientPercent: number;
}

interface ElevationSample {
  distanceMeters: number;
  elevationMeters: number;
}

export function computeClimbSegmentStats(
  points: RoutePoint[],
  startDistanceMeters: number,
  endDistanceMeters: number,
): ClimbSegmentStats | null {
  if (
    points.length < 2 ||
    !Number.isFinite(startDistanceMeters) ||
    !Number.isFinite(endDistanceMeters)
  ) {
    return null;
  }

  const routeStart = points[0].distanceFromStartMeters;
  const routeEnd = points[points.length - 1].distanceFromStartMeters;
  const start = Math.max(routeStart, Math.min(startDistanceMeters, routeEnd));
  const end = Math.max(start, Math.min(endDistanceMeters, routeEnd));
  const lengthMeters = end - start;
  if (lengthMeters <= 0) {
    return {
      gainMeters: 0,
      lengthMeters: 0,
      averageGradientPercent: 0,
      maxGradientPercent: 0,
    };
  }

  const gainMeters = computeSliceElevationTotalsFromDistance(points, start, end).ascent;
  const averageGradientPercent = (gainMeters / lengthMeters) * 100;
  const maxGradientPercent = computeMaxGradientPercent(points, start, end);

  return {
    gainMeters: roundOne(gainMeters),
    lengthMeters: roundOne(lengthMeters),
    averageGradientPercent: roundOne(averageGradientPercent),
    maxGradientPercent: roundOne(maxGradientPercent),
  };
}

function computeMaxGradientPercent(
  points: RoutePoint[],
  startDistanceMeters: number,
  endDistanceMeters: number,
): number {
  const samples = buildElevationSamples(points, startDistanceMeters, endDistanceMeters);
  if (samples.length < 2) return 0;

  let maxGradient = 0;
  for (let i = 0; i < samples.length - 1; i++) {
    const start = samples[i];
    const targetDistance = Math.min(
      start.distanceMeters + MAX_GRADIENT_WINDOW_M,
      endDistanceMeters,
    );
    const windowIndex = findSampleAtOrAfterDistance(samples, targetDistance, i + 1);
    const end = samples[windowIndex] ?? samples[samples.length - 1];
    const gradient = computePositiveGradient(start, end, MIN_GRADIENT_WINDOW_M);
    if (gradient > maxGradient) maxGradient = gradient;
  }

  if (maxGradient > 0) return maxGradient;

  for (let i = 1; i < samples.length; i++) {
    const gradient = computePositiveGradient(samples[i - 1], samples[i], 0);
    if (gradient > maxGradient) maxGradient = gradient;
  }
  return maxGradient;
}

function buildElevationSamples(
  points: RoutePoint[],
  startDistanceMeters: number,
  endDistanceMeters: number,
): ElevationSample[] {
  const samples: ElevationSample[] = [];
  addInterpolatedSample(samples, points, startDistanceMeters);

  const firstInteriorIndex = findFirstPointAtOrAfterDistance(points, startDistanceMeters);
  for (let i = firstInteriorIndex; i < points.length; i++) {
    const point = points[i];
    if (point.distanceFromStartMeters >= endDistanceMeters) break;
    if (point.distanceFromStartMeters <= startDistanceMeters) continue;
    if (point.elevationMeters == null) continue;
    addSample(samples, {
      distanceMeters: point.distanceFromStartMeters,
      elevationMeters: point.elevationMeters,
    });
  }

  addInterpolatedSample(samples, points, endDistanceMeters);
  return samples;
}

function addInterpolatedSample(
  samples: ElevationSample[],
  points: RoutePoint[],
  distanceMeters: number,
): void {
  const point = interpolateRoutePointAtDistance(points, distanceMeters);
  if (!point || point.elevationMeters == null) return;
  addSample(samples, {
    distanceMeters: point.distanceFromStartMeters,
    elevationMeters: point.elevationMeters,
  });
}

function addSample(samples: ElevationSample[], sample: ElevationSample): void {
  const last = samples[samples.length - 1];
  if (last && Math.abs(last.distanceMeters - sample.distanceMeters) < 0.001) {
    samples[samples.length - 1] = sample;
    return;
  }
  samples.push(sample);
}

function findSampleAtOrAfterDistance(
  samples: ElevationSample[],
  distanceMeters: number,
  startIndex: number,
): number {
  for (let i = startIndex; i < samples.length; i++) {
    if (samples[i].distanceMeters >= distanceMeters) return i;
  }
  return samples.length - 1;
}

function computePositiveGradient(
  start: ElevationSample,
  end: ElevationSample,
  minimumDistanceMeters: number,
): number {
  const lengthMeters = end.distanceMeters - start.distanceMeters;
  if (lengthMeters <= minimumDistanceMeters) return 0;

  const gainMeters = end.elevationMeters - start.elevationMeters;
  if (gainMeters <= 0) return 0;

  return (gainMeters / lengthMeters) * 100;
}

function roundOne(value: number): number {
  return Math.round(value * 10) / 10;
}
