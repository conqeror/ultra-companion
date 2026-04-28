import type { RoutePoint } from "@/types";

export type MapCoordinate = [longitude: number, latitude: number];

export interface ClimbMapSample {
  longitude: number;
  latitude: number;
  distanceFromStartMeters: number;
  elevationMeters: number | null;
}

export interface MapCoordinateBounds {
  ne: MapCoordinate;
  sw: MapCoordinate;
  center: MapCoordinate;
  corners: MapCoordinate[];
}

export interface MapViewportPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

const DISTANCE_EPSILON_M = 0.01;
const MERCATOR_TILE_SIZE = 512;
const MAX_MERCATOR_LATITUDE = 85.05112878;

export function getClimbMapSamples(
  points: RoutePoint[],
  startDistanceMeters: number,
  endDistanceMeters: number,
): ClimbMapSample[] {
  if (points.length < 2 || endDistanceMeters <= startDistanceMeters) return [];

  const routeStart = points[0].distanceFromStartMeters;
  const routeEnd = points[points.length - 1].distanceFromStartMeters;
  const start = Math.max(routeStart, startDistanceMeters);
  const end = Math.min(routeEnd, endDistanceMeters);
  if (end <= start) return [];

  const samples: ClimbMapSample[] = [];
  addSample(samples, interpolateSampleAtDistance(points, start));

  for (const point of points) {
    if (point.distanceFromStartMeters <= start) continue;
    if (point.distanceFromStartMeters >= end) break;
    addSample(samples, sampleFromPoint(point));
  }

  addSample(samples, interpolateSampleAtDistance(points, end));
  return samples.length >= 2 ? samples : [];
}

export function getClimbMapBounds(
  points: RoutePoint[],
  startDistanceMeters: number,
  endDistanceMeters: number,
): MapCoordinateBounds | null {
  const samples = getClimbMapSamples(points, startDistanceMeters, endDistanceMeters);
  if (samples.length < 2) return null;

  let minLat = 90;
  let maxLat = -90;
  let minLon = 180;
  let maxLon = -180;

  for (const sample of samples) {
    minLat = Math.min(minLat, sample.latitude);
    maxLat = Math.max(maxLat, sample.latitude);
    minLon = Math.min(minLon, sample.longitude);
    maxLon = Math.max(maxLon, sample.longitude);
  }

  return {
    ne: [maxLon, maxLat],
    sw: [minLon, minLat],
    center: [(minLon + maxLon) / 2, (minLat + maxLat) / 2],
    corners: [
      [minLon, minLat],
      [minLon, maxLat],
      [maxLon, minLat],
      [maxLon, maxLat],
    ],
  };
}

export function getZoomLevelToFitBounds(
  currentZoom: number,
  bounds: MapCoordinateBounds,
  viewportWidth: number,
  viewportHeight: number,
  padding: MapViewportPadding,
): number {
  const availableWidth = viewportWidth - padding.left - padding.right;
  const availableHeight = viewportHeight - padding.top - padding.bottom;
  if (availableWidth <= 0 || availableHeight <= 0) return currentZoom;

  const [east, north] = bounds.ne;
  const [west, south] = bounds.sw;
  const xDelta = getWrappedMercatorDelta(mercatorX(east), mercatorX(west));
  const yDelta = Math.abs(mercatorY(north) - mercatorY(south));

  const fitZoomX = getFitZoom(availableWidth, xDelta);
  const fitZoomY = getFitZoom(availableHeight, yDelta);
  const fitZoom = Math.min(fitZoomX, fitZoomY);
  if (!Number.isFinite(fitZoom)) return currentZoom;

  return Math.min(currentZoom, fitZoom);
}

function addSample(samples: ClimbMapSample[], sample: ClimbMapSample): void {
  const previous = samples[samples.length - 1];
  if (
    previous &&
    Math.abs(previous.distanceFromStartMeters - sample.distanceFromStartMeters) < DISTANCE_EPSILON_M
  ) {
    samples[samples.length - 1] = sample;
    return;
  }
  samples.push(sample);
}

function getFitZoom(availablePoints: number, mercatorDelta: number): number {
  if (mercatorDelta <= 0) return Number.POSITIVE_INFINITY;
  return Math.log2(availablePoints / (MERCATOR_TILE_SIZE * mercatorDelta));
}

function mercatorX(longitude: number): number {
  return (longitude + 180) / 360;
}

function mercatorY(latitude: number): number {
  const clamped = Math.max(-MAX_MERCATOR_LATITUDE, Math.min(MAX_MERCATOR_LATITUDE, latitude));
  const radians = (clamped * Math.PI) / 180;
  return (1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2;
}

function getWrappedMercatorDelta(a: number, b: number): number {
  const delta = Math.abs(a - b);
  return Math.min(delta, 1 - delta);
}

function interpolateSampleAtDistance(points: RoutePoint[], distanceMeters: number): ClimbMapSample {
  if (distanceMeters <= points[0].distanceFromStartMeters) return sampleFromPoint(points[0]);

  for (let i = 1; i < points.length; i++) {
    const previous = points[i - 1];
    const next = points[i];
    if (distanceMeters > next.distanceFromStartMeters) continue;

    const segmentLength = next.distanceFromStartMeters - previous.distanceFromStartMeters;
    if (segmentLength <= 0) return sampleFromPoint(next);

    const ratio = (distanceMeters - previous.distanceFromStartMeters) / segmentLength;
    return {
      longitude: previous.longitude + (next.longitude - previous.longitude) * ratio,
      latitude: previous.latitude + (next.latitude - previous.latitude) * ratio,
      distanceFromStartMeters: distanceMeters,
      elevationMeters: interpolateElevation(previous.elevationMeters, next.elevationMeters, ratio),
    };
  }

  return sampleFromPoint(points[points.length - 1]);
}

function sampleFromPoint(point: RoutePoint): ClimbMapSample {
  return {
    longitude: point.longitude,
    latitude: point.latitude,
    distanceFromStartMeters: point.distanceFromStartMeters,
    elevationMeters: point.elevationMeters,
  };
}

function interpolateElevation(
  startElevation: number | null,
  endElevation: number | null,
  ratio: number,
): number | null {
  if (startElevation != null && endElevation != null) {
    return startElevation + (endElevation - startElevation) * ratio;
  }
  return startElevation ?? endElevation;
}
