import { findNearestPointOnRoute } from "@/utils/geo";
import type { RoutePoint, SnappedPosition } from "@/types";

const MAX_SNAP_DISTANCE_M = 1000; // Don't snap if >1km from route
const LOCAL_SEARCH_WINDOW_POINTS = 500;
const LOCAL_EDGE_GUARD_POINTS = 25;
const TRUST_LOCAL_DISTANCE_M = 50;
const SPATIAL_CELL_SIZE_DEG = 0.01; // ~1.1km latitude; checked with a 2-cell radius below.
const SPATIAL_QUERY_RADIUS_CELLS = 2;

interface RoutePointSpatialIndex {
  cells: Map<string, number[]>;
}

const routePointIndexCache = new WeakMap<RoutePoint[], RoutePointSpatialIndex>();

function cellKey(latCell: number, lonCell: number): string {
  return `${latCell}:${lonCell}`;
}

function buildSpatialIndex(points: RoutePoint[]): RoutePointSpatialIndex {
  const cached = routePointIndexCache.get(points);
  if (cached) return cached;

  const cells = new Map<string, number[]>();
  for (let i = 0; i < points.length; i++) {
    const latCell = Math.floor(points[i].latitude / SPATIAL_CELL_SIZE_DEG);
    const lonCell = Math.floor(points[i].longitude / SPATIAL_CELL_SIZE_DEG);
    const key = cellKey(latCell, lonCell);
    const bucket = cells.get(key);
    if (bucket) bucket.push(i);
    else cells.set(key, [i]);
  }

  const index = { cells };
  routePointIndexCache.set(points, index);
  return index;
}

function findNearestPointWithSpatialIndex(
  lat: number,
  lon: number,
  points: RoutePoint[],
): { index: number; distanceMeters: number } {
  const index = buildSpatialIndex(points);
  const latCell = Math.floor(lat / SPATIAL_CELL_SIZE_DEG);
  const lonCell = Math.floor(lon / SPATIAL_CELL_SIZE_DEG);
  const candidateIndexes = new Set<number>();

  for (let dLat = -SPATIAL_QUERY_RADIUS_CELLS; dLat <= SPATIAL_QUERY_RADIUS_CELLS; dLat++) {
    for (let dLon = -SPATIAL_QUERY_RADIUS_CELLS; dLon <= SPATIAL_QUERY_RADIUS_CELLS; dLon++) {
      const bucket = index.cells.get(cellKey(latCell + dLat, lonCell + dLon));
      if (!bucket) continue;
      for (const pointIndex of bucket) candidateIndexes.add(pointIndex);
    }
  }

  if (candidateIndexes.size === 0) {
    return findNearestPointOnRoute(lat, lon, points);
  }

  let nearest: { index: number; distanceMeters: number } | null = null;
  for (const pointIndex of candidateIndexes) {
    const candidate = findNearestPointOnRoute(lat, lon, points, {
      startIndex: pointIndex,
      endIndex: pointIndex,
    });
    if (!nearest || candidate.distanceMeters < nearest.distanceMeters) {
      nearest = candidate;
    }
  }
  return nearest!;
}

function isTrustedLocalSnap(
  nearest: { index: number; distanceMeters: number },
  startIndex: number,
  endIndex: number,
): boolean {
  if (nearest.distanceMeters > TRUST_LOCAL_DISTANCE_M) return false;
  if (nearest.index - startIndex <= LOCAL_EDGE_GUARD_POINTS) return false;
  if (endIndex - nearest.index <= LOCAL_EDGE_GUARD_POINTS) return false;
  return true;
}

export function snapToRoute(
  lat: number,
  lon: number,
  routeId: string,
  points: RoutePoint[],
  options?: { previousPointIndex?: number | null },
): SnappedPosition | null {
  if (points.length === 0) return null;

  let nearest: { index: number; distanceMeters: number } | null = null;
  const previousPointIndex = options?.previousPointIndex;
  if (previousPointIndex != null && previousPointIndex >= 0 && previousPointIndex < points.length) {
    const startIndex = Math.max(0, previousPointIndex - LOCAL_SEARCH_WINDOW_POINTS);
    const endIndex = Math.min(points.length - 1, previousPointIndex + LOCAL_SEARCH_WINDOW_POINTS);
    nearest = findNearestPointOnRoute(lat, lon, points, {
      startIndex,
      endIndex,
    });

    if (!isTrustedLocalSnap(nearest, startIndex, endIndex)) {
      nearest = findNearestPointWithSpatialIndex(lat, lon, points);
    }
  }

  if (!nearest) {
    nearest = findNearestPointWithSpatialIndex(lat, lon, points);
  }

  const { index, distanceMeters } = nearest;

  if (distanceMeters > MAX_SNAP_DISTANCE_M) return null;

  return {
    routeId,
    pointIndex: index,
    distanceAlongRouteMeters: points[index].distanceFromStartMeters,
    distanceFromRouteMeters: distanceMeters,
  };
}
