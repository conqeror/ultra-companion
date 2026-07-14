import type { RoutePoint } from "@/types";
import { computeTrustedElevationTotals, processRouteElevations } from "@/utils/elevation";
import { measureSync } from "@/utils/perfMarks";

const EARTH_RADIUS_M = 6_371_000;
const METERS_PER_LAT_DEGREE = 111_320;
const MAP_SIMPLIFY_TOLERANCE_M = 20;
const WEB_MERCATOR_WORLD_SIZE_PX = 512;
const EARTH_CIRCUMFERENCE_M = 2 * Math.PI * 6_378_137;
const DEFAULT_MAP_GEOMETRY_VIEWPORT = {
  latitude: 48.2,
  widthPx: 390,
  heightPx: 844,
};
const MAP_SIMPLIFY_TOLERANCE_BY_VISIBLE_SPAN = [
  { maxVisibleSpanMeters: 30_000, toleranceMeters: 0 },
  { maxVisibleSpanMeters: 250_000, toleranceMeters: 12 },
  { maxVisibleSpanMeters: Infinity, toleranceMeters: 120 },
] as const;
export const MAX_ROUTE_MAP_GEOJSON_POINTS = 60_000;
export const MAX_VARIANT_MAP_GEOJSON_POINTS = 20_000;
export const MAX_KEYED_MAP_GEOJSON_CACHE_ENTRIES = 32;
const mapGeoJSONCache = new WeakMap<
  RoutePoint[],
  Map<number, GeoJSON.Feature<GeoJSON.LineString>>
>();
const keyedMapGeoJSONCache = new Map<
  string,
  {
    pointsRef: WeakRef<RoutePoint[]> | null;
    fingerprint: string;
    geoJSON: GeoJSON.Feature<GeoJSON.LineString>;
  }
>();

export interface RoutePointIndexRange {
  startPointIndex?: number;
  endPointIndex?: number;
  maxPoints?: number;
}

/** Allocate a shared coordinate budget without starving any renderable line. */
export function allocateMapCoordinateBudget(
  pointCounts: readonly number[],
  totalBudget: number,
): number[] {
  if (pointCounts.length === 0) return [];
  const budget = Math.max(0, Math.floor(totalBudget));
  const normalizedCounts = pointCounts.map((count) =>
    Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0,
  );
  const totalPoints = normalizedCounts.reduce((total, count) => total + count, 0);
  if (totalPoints === 0) return normalizedCounts.map(() => 0);

  const allocations = normalizedCounts.map((count) =>
    count >= 2 ? Math.max(2, Math.floor((budget * count) / totalPoints)) : 0,
  );
  let excess = allocations.reduce((total, count) => total + count, 0) - budget;
  if (excess <= 0) return allocations;

  for (const allocationIndex of allocations
    .map((allocation, candidateIndex) => ({ allocation, candidateIndex }))
    .sort((a, b) => b.allocation - a.allocation)
    .map((entry) => entry.candidateIndex)) {
    if (excess <= 0) break;
    const reducible = Math.max(0, allocations[allocationIndex] - 2);
    const reduction = Math.min(reducible, excess);
    allocations[allocationIndex] -= reduction;
    excess -= reduction;
  }

  return allocations;
}

export function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function toDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

/** Bearing in degrees (0=N, clockwise) from point A to point B */
export function computeBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Haversine distance between two points in meters */
export function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Compute cumulative distances and elevation stats for an array of raw coordinates */
export function computeRouteStats(
  coords: { latitude: number; longitude: number; elevation: number | null }[],
): {
  points: RoutePoint[];
  totalDistanceMeters: number;
  totalAscentMeters: number;
  totalDescentMeters: number;
} {
  let totalDistance = 0;

  const points: RoutePoint[] = coords.map((coord, i) => {
    if (i > 0) {
      const prev = coords[i - 1];
      totalDistance += haversineDistance(
        prev.latitude,
        prev.longitude,
        coord.latitude,
        coord.longitude,
      );
    }

    return {
      latitude: coord.latitude,
      longitude: coord.longitude,
      elevationMeters: coord.elevation,
      distanceFromStartMeters: totalDistance,
      idx: i,
    };
  });
  const processed = processRouteElevations(points);

  return {
    points: processed.points,
    totalDistanceMeters: totalDistance,
    totalAscentMeters: processed.totalAscentMeters,
    totalDescentMeters: processed.totalDescentMeters,
  };
}

export interface DownsampleRoutePointsOptions<TOutput> {
  intervalMeters: number;
  mapPoint: (point: RoutePoint) => TOutput;
  isSameOutput?: (a: TOutput, b: TOutput) => boolean;
}

/** Downsample route points by route distance while preserving first and last points. */
export function downsampleRoutePointsByDistance<TOutput>(
  points: RoutePoint[],
  options: DownsampleRoutePointsOptions<TOutput>,
): TOutput[] {
  if (points.length === 0) return [];

  const { intervalMeters, mapPoint, isSameOutput } = options;
  const result: TOutput[] = [mapPoint(points[0])];
  let lastIncludedDistance = points[0].distanceFromStartMeters;
  let lastIncludedIndex = 0;

  for (let i = 1; i < points.length; i++) {
    if (points[i].distanceFromStartMeters - lastIncludedDistance >= intervalMeters) {
      result.push(mapPoint(points[i]));
      lastIncludedDistance = points[i].distanceFromStartMeters;
      lastIncludedIndex = i;
    }
  }

  if (lastIncludedIndex !== points.length - 1) {
    const endpoint = mapPoint(points[points.length - 1]);
    const previous = result[result.length - 1];
    if (!isSameOutput || !isSameOutput(endpoint, previous)) {
      result.push(endpoint);
    }
  }

  return result;
}

export interface SplitRoutePointsOptions {
  maxSegmentLengthMeters: number;
  balanceSegments?: boolean;
  includeShortRoute?: boolean;
}

/** Split route points by distance with a one-point overlap between adjacent segments. */
export function splitRoutePointsByDistance(
  points: RoutePoint[],
  options: SplitRoutePointsOptions,
): RoutePoint[][] {
  if (points.length < 2) return options.includeShortRoute ? [points] : [];

  const totalDistance =
    points[points.length - 1].distanceFromStartMeters - points[0].distanceFromStartMeters;
  if (totalDistance <= options.maxSegmentLengthMeters) return [points];

  const segmentLength = options.balanceSegments
    ? totalDistance / Math.ceil(totalDistance / options.maxSegmentLengthMeters)
    : options.maxSegmentLengthMeters;
  const segments: RoutePoint[][] = [];
  let segmentStart = 0;
  let segmentStartDistance = points[0].distanceFromStartMeters;

  for (let i = 1; i < points.length; i++) {
    if (points[i].distanceFromStartMeters - segmentStartDistance >= segmentLength) {
      segments.push(points.slice(segmentStart, i + 1));
      segmentStart = i;
      segmentStartDistance = points[i].distanceFromStartMeters;
    }
  }

  if (segmentStart < points.length - 1) {
    segments.push(points.slice(segmentStart));
  }

  return segments;
}

/** First point index with distance >= targetDistanceMeters. Returns points.length if none. */
export function findFirstPointAtOrAfterDistance(
  points: RoutePoint[],
  targetDistanceMeters: number,
  startIndex = 0,
): number {
  let lo = Math.max(0, startIndex);
  let hi = points.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (points[mid].distanceFromStartMeters < targetDistanceMeters) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Last point index with distance <= targetDistanceMeters. Returns startIndex - 1 if none. */
export function findLastPointAtOrBeforeDistance(
  points: RoutePoint[],
  targetDistanceMeters: number,
  startIndex = 0,
): number {
  let lo = Math.max(0, startIndex);
  let hi = points.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (points[mid].distanceFromStartMeters <= targetDistanceMeters) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

export function findPointIndexAtOrAfterDistance(
  points: RoutePoint[],
  targetDistanceMeters: number,
  startIndex = 0,
): number {
  if (points.length === 0) return 0;
  return Math.min(
    points.length - 1,
    Math.max(0, findFirstPointAtOrAfterDistance(points, targetDistanceMeters, startIndex)),
  );
}

export function findPointIndexAtOrBeforeDistance(
  points: RoutePoint[],
  targetDistanceMeters: number,
  startIndex = 0,
): number {
  if (points.length === 0) return 0;
  return Math.max(
    0,
    Math.min(
      points.length - 1,
      findLastPointAtOrBeforeDistance(points, targetDistanceMeters, startIndex),
    ),
  );
}

export function findNearestPointIndexAtDistance(
  points: RoutePoint[],
  targetDistanceMeters: number,
): number {
  if (points.length === 0) return 0;
  const hi = findPointIndexAtOrAfterDistance(points, targetDistanceMeters);
  if (points[hi].distanceFromStartMeters === targetDistanceMeters) {
    return findPointIndexAtOrBeforeDistance(points, targetDistanceMeters, hi);
  }
  const lo = findPointIndexAtOrBeforeDistance(points, targetDistanceMeters);
  const hiDelta = Math.abs(points[hi].distanceFromStartMeters - targetDistanceMeters);
  const loDelta = Math.abs(targetDistanceMeters - points[lo].distanceFromStartMeters);
  return hiDelta < loDelta ? hi : lo;
}

export interface InterpolatedRoutePoint {
  latitude: number;
  longitude: number;
  elevationMeters: number | null;
  distanceFromStartMeters: number;
  nearestIndex: number;
  segmentIndex: number;
}

export function interpolateRoutePointAtDistance(
  points: RoutePoint[],
  targetDistanceMeters: number,
): InterpolatedRoutePoint | null {
  if (points.length === 0) return null;
  if (points.length === 1 || targetDistanceMeters <= points[0].distanceFromStartMeters) {
    const first = points[0];
    return {
      latitude: first.latitude,
      longitude: first.longitude,
      elevationMeters: first.elevationMeters,
      distanceFromStartMeters: first.distanceFromStartMeters,
      nearestIndex: 0,
      segmentIndex: 0,
    };
  }

  if (targetDistanceMeters >= points[points.length - 1].distanceFromStartMeters) {
    const lastIndex = points.length - 1;
    const segmentIndex = Math.max(0, lastIndex - 1);
    const last = points[lastIndex];
    return {
      latitude: last.latitude,
      longitude: last.longitude,
      elevationMeters: last.elevationMeters,
      distanceFromStartMeters: last.distanceFromStartMeters,
      nearestIndex: lastIndex,
      segmentIndex,
    };
  }

  const lo = findPointIndexAtOrBeforeDistance(points, targetDistanceMeters);
  if (points[lo].distanceFromStartMeters === targetDistanceMeters) {
    const exactIndex = lo;
    const segmentIndex = Math.min(exactIndex, points.length - 2);
    const exact = points[exactIndex];
    return {
      latitude: exact.latitude,
      longitude: exact.longitude,
      elevationMeters: exact.elevationMeters,
      distanceFromStartMeters: exact.distanceFromStartMeters,
      nearestIndex: exactIndex,
      segmentIndex,
    };
  }

  const hi = lo + 1;
  const a = points[lo];
  const b = points[hi];
  const segmentMeters = b.distanceFromStartMeters - a.distanceFromStartMeters;
  const t =
    segmentMeters > 0 ? (targetDistanceMeters - a.distanceFromStartMeters) / segmentMeters : 0;
  const elevationMeters =
    a.elevationMeters != null && b.elevationMeters != null
      ? a.elevationMeters + t * (b.elevationMeters - a.elevationMeters)
      : null;

  return {
    latitude: a.latitude + t * (b.latitude - a.latitude),
    longitude: a.longitude + t * (b.longitude - a.longitude),
    elevationMeters,
    distanceFromStartMeters: targetDistanceMeters,
    nearestIndex: t < 0.5 ? lo : hi,
    segmentIndex: lo,
  };
}

export function computeElevationProgressAtDistance(
  points: RoutePoint[],
  currentDistanceMeters: number,
): {
  ascentDone: number;
  descentDone: number;
  ascentRemaining: number;
  descentRemaining: number;
} {
  if (points.length < 2) {
    return { ascentDone: 0, descentDone: 0, ascentRemaining: 0, descentRemaining: 0 };
  }

  const routeStart = points[0].distanceFromStartMeters;
  const routeEnd = points[points.length - 1].distanceFromStartMeters;
  const currentDistance = Math.max(routeStart, Math.min(routeEnd, currentDistanceMeters));
  const done = computeSliceElevationTotalsFromDistance(points, routeStart, currentDistance);
  const remaining = computeSliceElevationTotalsFromDistance(points, currentDistance, routeEnd);

  return {
    ascentDone: done.ascent,
    descentDone: done.descent,
    ascentRemaining: remaining.ascent,
    descentRemaining: remaining.descent,
  };
}

/**
 * Extract a slice of route points starting at startIndex, going forward by maxDistanceM.
 * Returns re-indexed points with distances re-zeroed from the slice start.
 */
export function extractRouteSlice(
  points: RoutePoint[],
  startIndex: number,
  maxDistanceM: number,
): RoutePoint[] {
  if (startIndex < 0 || startIndex >= points.length) return [];

  const startDist = points[startIndex].distanceFromStartMeters;
  const endDist = startDist + maxDistanceM;

  // Include one point past the boundary for a complete slice.
  const endIndex = Math.min(
    points.length - 1,
    findFirstPointAtOrAfterDistance(points, endDist, startIndex),
  );

  const slice = points.slice(startIndex, endIndex + 1);
  return slice.map((p, i) => ({
    latitude: p.latitude,
    longitude: p.longitude,
    elevationMeters: p.elevationMeters,
    distanceFromStartMeters: p.distanceFromStartMeters - startDist,
    idx: i,
  }));
}

/** Compute bounding box for an array of route points */
export function computeBounds(points: RoutePoint[]): {
  ne: [number, number];
  sw: [number, number];
} {
  let minLat = Infinity,
    maxLat = -Infinity,
    minLon = Infinity,
    maxLon = -Infinity;
  for (const p of points) {
    if (p.latitude < minLat) minLat = p.latitude;
    if (p.latitude > maxLat) maxLat = p.latitude;
    if (p.longitude < minLon) minLon = p.longitude;
    if (p.longitude > maxLon) maxLon = p.longitude;
  }
  return {
    ne: [maxLon, maxLat],
    sw: [minLon, minLat],
  };
}

export function computeSliceElevationTotalsFromDistance(
  points: RoutePoint[],
  startDistanceMeters: number,
  endDistanceMeters: number,
): { ascent: number; descent: number } {
  if (points.length < 2 || endDistanceMeters <= startDistanceMeters) {
    return { ascent: 0, descent: 0 };
  }

  const routeStart = points[0].distanceFromStartMeters;
  const routeEnd = points[points.length - 1].distanceFromStartMeters;
  const start = Math.max(routeStart, Math.min(routeEnd, startDistanceMeters));
  const end = Math.max(routeStart, Math.min(routeEnd, endDistanceMeters));
  if (end <= start) return { ascent: 0, descent: 0 };

  const startPoint = interpolateRoutePointAtDistance(points, start);
  const endPoint = interpolateRoutePointAtDistance(points, end);
  if (!startPoint || !endPoint) return { ascent: 0, descent: 0 };

  // Elevation totals only read elevationMeters, so retain references to the
  // interior points instead of copying complete RoutePoint objects. Binary
  // search also keeps a short window from scanning an entire long route.
  const slice: Array<{ elevationMeters: number | null }> = [
    { elevationMeters: startPoint.elevationMeters },
  ];
  const firstCandidateIndex = findFirstPointAtOrAfterDistance(points, start);
  const endExclusiveIndex = findFirstPointAtOrAfterDistance(points, end, firstCandidateIndex);

  for (let index = firstCandidateIndex; index < endExclusiveIndex; index++) {
    const point = points[index];
    if (point.distanceFromStartMeters > start) slice.push(point);
  }

  slice.push({ elevationMeters: endPoint.elevationMeters });

  return computeTrustedElevationTotals(slice);
}

export function computeSliceAscentFromDistance(
  points: RoutePoint[],
  startDistanceMeters: number,
  endDistanceMeters: number,
): number {
  return computeSliceElevationTotalsFromDistance(points, startDistanceMeters, endDistanceMeters)
    .ascent;
}

export function computeSliceDescentFromDistance(
  points: RoutePoint[],
  startDistanceMeters: number,
  endDistanceMeters: number,
): number {
  return computeSliceElevationTotalsFromDistance(points, startDistanceMeters, endDistanceMeters)
    .descent;
}

// --- Phase 3: POI-to-route association ---

/**
 * Perpendicular distance from a point to a line segment, using planar
 * approximation with latitude-corrected longitude. Returns the distance
 * in meters and the fraction (0–1) along the segment of the closest point.
 */
export function pointToSegmentDistance(
  pLat: number,
  pLon: number,
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
): { distanceMeters: number; fraction: number } {
  // Convert to approximate meters using local tangent plane
  const cosLat = Math.cos(toRad((aLat + bLat) / 2));
  const px = (pLon - aLon) * cosLat;
  const py = pLat - aLat;
  const bx = (bLon - aLon) * cosLat;
  const by = bLat - aLat;

  const segLenSq = bx * bx + by * by;
  let fraction: number;

  if (segLenSq < 1e-12) {
    // Degenerate segment (a == b)
    fraction = 0;
  } else {
    fraction = Math.max(0, Math.min(1, (px * bx + py * by) / segLenSq));
  }

  const projLat = aLat + fraction * (bLat - aLat);
  const projLon = aLon + fraction * (bLon - aLon);

  return {
    distanceMeters: haversineDistance(pLat, pLon, projLat, projLon),
    fraction,
  };
}

export interface RouteSegmentProjectionCandidate {
  segmentIndex: number;
  nearestPointIndex: number;
  fraction: number;
  distanceMeters: number;
  distanceAlongRouteMeters: number;
  bearingDegrees: number;
}

export interface RouteSegmentSpatialIndex {
  points: RoutePoint[];
  cellSizeDeg: number;
  segmentsByCell: Map<string, number[]>;
}

function cellKey(latCell: number, lonCell: number): string {
  return `${latCell}:${lonCell}`;
}

function degreePaddingForMeters(meters: number, latitude: number): { lat: number; lon: number } {
  const lat = meters / METERS_PER_LAT_DEGREE;
  const cosLat = Math.max(0.2, Math.abs(Math.cos(toRad(latitude))));
  return { lat, lon: meters / (METERS_PER_LAT_DEGREE * cosLat) };
}

export function buildRouteSegmentSpatialIndex(
  routePoints: RoutePoint[],
  corridorWidthM: number,
): RouteSegmentSpatialIndex | null {
  if (routePoints.length < 2) return null;

  const cellSizeDeg = Math.max(0.02, Math.min(0.2, (Math.max(corridorWidthM, 500) * 2) / 111_320));
  const segmentsByCell = new Map<string, number[]>();

  for (let i = 0; i < routePoints.length - 1; i++) {
    const a = routePoints[i];
    const b = routePoints[i + 1];
    const midLat = (a.latitude + b.latitude) / 2;
    const pad = degreePaddingForMeters(corridorWidthM, midLat);

    const minLat = Math.min(a.latitude, b.latitude) - pad.lat;
    const maxLat = Math.max(a.latitude, b.latitude) + pad.lat;
    const minLon = Math.min(a.longitude, b.longitude) - pad.lon;
    const maxLon = Math.max(a.longitude, b.longitude) + pad.lon;

    const minLatCell = Math.floor(minLat / cellSizeDeg);
    const maxLatCell = Math.floor(maxLat / cellSizeDeg);
    const minLonCell = Math.floor(minLon / cellSizeDeg);
    const maxLonCell = Math.floor(maxLon / cellSizeDeg);

    for (let latCell = minLatCell; latCell <= maxLatCell; latCell++) {
      for (let lonCell = minLonCell; lonCell <= maxLonCell; lonCell++) {
        const key = cellKey(latCell, lonCell);
        const bucket = segmentsByCell.get(key);
        if (bucket) bucket.push(i);
        else segmentsByCell.set(key, [i]);
      }
    }
  }

  return { points: routePoints, cellSizeDeg, segmentsByCell };
}

function getCandidateSegmentIndexes(
  poiLat: number,
  poiLon: number,
  index?: RouteSegmentSpatialIndex | null,
): number[] | null {
  if (!index) return null;
  const latCell = Math.floor(poiLat / index.cellSizeDeg);
  const lonCell = Math.floor(poiLon / index.cellSizeDeg);
  const candidates = new Set<number>();

  for (let dLat = -1; dLat <= 1; dLat++) {
    for (let dLon = -1; dLon <= 1; dLon++) {
      const bucket = index.segmentsByCell.get(cellKey(latCell + dLat, lonCell + dLon));
      if (!bucket) continue;
      for (const segmentIndex of bucket) candidates.add(segmentIndex);
    }
  }

  return candidates.size > 0 ? [...candidates] : null;
}

export function findRouteSegmentCandidates(
  lat: number,
  lon: number,
  routePoints: RoutePoint[],
  options?: {
    spatialIndex?: RouteSegmentSpatialIndex | null;
    maxDistanceMeters?: number;
    maxCandidates?: number;
    startSegmentIndex?: number;
    endSegmentIndex?: number;
  },
): RouteSegmentProjectionCandidate[] {
  if (routePoints.length === 0) return [];

  if (routePoints.length === 1) {
    return [
      {
        segmentIndex: 0,
        nearestPointIndex: 0,
        fraction: 0,
        distanceMeters: haversineDistance(
          lat,
          lon,
          routePoints[0].latitude,
          routePoints[0].longitude,
        ),
        distanceAlongRouteMeters: routePoints[0].distanceFromStartMeters,
        bearingDegrees: 0,
      },
    ];
  }

  const startSegmentIndex = Math.max(0, options?.startSegmentIndex ?? 0);
  const endSegmentIndex = Math.min(
    routePoints.length - 2,
    options?.endSegmentIndex ?? routePoints.length - 2,
  );
  const indexedCandidates = getCandidateSegmentIndexes(lat, lon, options?.spatialIndex);
  const segmentIndexes =
    indexedCandidates ??
    Array.from(
      { length: endSegmentIndex - startSegmentIndex + 1 },
      (_, i) => i + startSegmentIndex,
    );

  const candidates: RouteSegmentProjectionCandidate[] = [];
  let nearestOutsideRange: RouteSegmentProjectionCandidate | null = null;

  for (const segmentIndex of segmentIndexes) {
    if (segmentIndex < startSegmentIndex || segmentIndex > endSegmentIndex) continue;

    const a = routePoints[segmentIndex];
    const b = routePoints[segmentIndex + 1];
    const { distanceMeters, fraction } = pointToSegmentDistance(
      lat,
      lon,
      a.latitude,
      a.longitude,
      b.latitude,
      b.longitude,
    );
    const candidate = {
      segmentIndex,
      nearestPointIndex: fraction < 0.5 ? segmentIndex : segmentIndex + 1,
      fraction,
      distanceMeters,
      distanceAlongRouteMeters:
        a.distanceFromStartMeters +
        fraction * (b.distanceFromStartMeters - a.distanceFromStartMeters),
      bearingDegrees: computeBearing(a.latitude, a.longitude, b.latitude, b.longitude),
    };

    if (options?.maxDistanceMeters == null || distanceMeters <= options.maxDistanceMeters) {
      candidates.push(candidate);
    } else if (!nearestOutsideRange || distanceMeters < nearestOutsideRange.distanceMeters) {
      nearestOutsideRange = candidate;
    }
  }

  const sorted = candidates.sort((a, b) => {
    if (a.distanceMeters !== b.distanceMeters) return a.distanceMeters - b.distanceMeters;
    return a.distanceAlongRouteMeters - b.distanceAlongRouteMeters;
  });

  if (sorted.length === 0 && nearestOutsideRange) return [nearestOutsideRange];

  return sorted.slice(0, options?.maxCandidates ?? 80);
}

/**
 * For a POI at (lat, lon), find the nearest point on the route
 * and compute both perpendicular distance and distance along route.
 * Uses segment projection for accuracy.
 */
export function computePOIRouteAssociation(
  poiLat: number,
  poiLon: number,
  routePoints: RoutePoint[],
  spatialIndex?: RouteSegmentSpatialIndex | null,
): {
  distanceFromRouteMeters: number;
  distanceAlongRouteMeters: number;
  nearestIndex: number;
} {
  if (routePoints.length === 0) {
    return { distanceFromRouteMeters: Infinity, distanceAlongRouteMeters: 0, nearestIndex: 0 };
  }

  if (routePoints.length === 1) {
    return {
      distanceFromRouteMeters: haversineDistance(
        poiLat,
        poiLon,
        routePoints[0].latitude,
        routePoints[0].longitude,
      ),
      distanceAlongRouteMeters: routePoints[0].distanceFromStartMeters,
      nearestIndex: 0,
    };
  }

  let bestDist = Infinity;
  let bestAlongRoute = 0;
  let bestIndex = 0;
  const candidateIndexes = getCandidateSegmentIndexes(poiLat, poiLon, spatialIndex);
  const segmentsToCheck =
    candidateIndexes ?? Array.from({ length: routePoints.length - 1 }, (_, i) => i);

  for (const i of segmentsToCheck) {
    const a = routePoints[i];
    const b = routePoints[i + 1];

    const { distanceMeters, fraction } = pointToSegmentDistance(
      poiLat,
      poiLon,
      a.latitude,
      a.longitude,
      b.latitude,
      b.longitude,
    );

    if (distanceMeters < bestDist) {
      bestDist = distanceMeters;
      // Interpolate the along-route distance
      bestAlongRoute =
        a.distanceFromStartMeters +
        fraction * (b.distanceFromStartMeters - a.distanceFromStartMeters);
      bestIndex = fraction < 0.5 ? i : i + 1;
    }
  }

  return {
    distanceFromRouteMeters: bestDist,
    distanceAlongRouteMeters: bestAlongRoute,
    nearestIndex: bestIndex,
  };
}

/** Convert route points to GeoJSON LineString for Mapbox */
export function routeToGeoJSON(points: RoutePoint[]): GeoJSON.Feature<GeoJSON.LineString> {
  return {
    type: "Feature",
    properties: {},
    geometry: {
      type: "LineString",
      coordinates: points.map((p) => [p.longitude, p.latitude]),
    },
  };
}

export interface MapSimplifyViewport {
  latitude?: number | null;
  viewportWidthPx?: number | null;
  viewportHeightPx?: number | null;
}

export function estimateMapVisibleSpanMeters(
  zoomLevel: number | null | undefined,
  viewport: MapSimplifyViewport = {},
): number | null {
  if (zoomLevel == null || !Number.isFinite(zoomLevel)) return null;
  const latitude = Number.isFinite(viewport.latitude)
    ? Math.max(-85, Math.min(85, viewport.latitude ?? 0))
    : DEFAULT_MAP_GEOMETRY_VIEWPORT.latitude;
  const widthPx =
    viewport.viewportWidthPx != null && Number.isFinite(viewport.viewportWidthPx)
      ? Math.max(1, viewport.viewportWidthPx)
      : DEFAULT_MAP_GEOMETRY_VIEWPORT.widthPx;
  const heightPx =
    viewport.viewportHeightPx != null && Number.isFinite(viewport.viewportHeightPx)
      ? Math.max(1, viewport.viewportHeightPx)
      : DEFAULT_MAP_GEOMETRY_VIEWPORT.heightPx;
  const metersPerPixel =
    (EARTH_CIRCUMFERENCE_M * Math.cos(toRad(latitude))) /
    (WEB_MERCATOR_WORLD_SIZE_PX * 2 ** zoomLevel);
  return Math.max(widthPx, heightPx) * metersPerPixel;
}

export function getMapSimplifyToleranceForVisibleSpan(
  visibleSpanMeters: number | null | undefined,
): number {
  if (visibleSpanMeters == null || !Number.isFinite(visibleSpanMeters)) {
    return MAP_SIMPLIFY_TOLERANCE_M;
  }

  for (const bucket of MAP_SIMPLIFY_TOLERANCE_BY_VISIBLE_SPAN) {
    if (visibleSpanMeters <= bucket.maxVisibleSpanMeters) return bucket.toleranceMeters;
  }

  return MAP_SIMPLIFY_TOLERANCE_M;
}

export function getMapSimplifyToleranceForZoom(
  zoomLevel?: number,
  viewport?: MapSimplifyViewport,
): number {
  return getMapSimplifyToleranceForVisibleSpan(estimateMapVisibleSpanMeters(zoomLevel, viewport));
}

function normalizedRoutePointRange(
  points: readonly RoutePoint[],
  options?: RoutePointIndexRange,
): {
  startPointIndex: number;
  endPointIndex: number;
  pointCount: number;
  maxPoints: number | null;
} {
  const startPointIndex = Math.max(
    0,
    Math.min(points.length, Math.floor(options?.startPointIndex ?? 0)),
  );
  const endPointIndex = Math.max(
    startPointIndex - 1,
    Math.min(points.length - 1, Math.floor(options?.endPointIndex ?? points.length - 1)),
  );
  const requestedMaxPoints = options?.maxPoints;
  const maxPoints =
    requestedMaxPoints != null && Number.isFinite(requestedMaxPoints)
      ? Math.max(2, Math.floor(requestedMaxPoints))
      : null;
  return {
    startPointIndex,
    endPointIndex,
    pointCount: Math.max(0, endPointIndex - startPointIndex + 1),
    maxPoints,
  };
}

function fingerprintNumber(value: number, scale = 1): number {
  if (Number.isNaN(value)) return 0x7fc00000;
  if (value === Infinity) return 0x7f800000;
  if (value === -Infinity) return -0x00800000;
  return Math.round(value * scale);
}

function sampledRangePointCount(range: ReturnType<typeof normalizedRoutePointRange>): number {
  return range.maxPoints == null ? range.pointCount : Math.min(range.pointCount, range.maxPoints);
}

function sampledRangePointIndex(
  range: ReturnType<typeof normalizedRoutePointRange>,
  sampleIndex: number,
  sampleCount: number,
): number {
  if (sampleCount <= 1 || range.pointCount <= 1) return range.startPointIndex;
  return (
    range.startPointIndex + Math.round((sampleIndex * (range.pointCount - 1)) / (sampleCount - 1))
  );
}

function sampledRoutePoints(
  points: RoutePoint[],
  range: ReturnType<typeof normalizedRoutePointRange>,
): RoutePoint[] {
  const sampleCount = sampledRangePointCount(range);
  if (sampleCount === 0) return [];
  if (
    sampleCount === points.length &&
    range.startPointIndex === 0 &&
    range.endPointIndex === points.length - 1
  ) {
    return points;
  }
  if (sampleCount === range.pointCount) {
    return points.slice(range.startPointIndex, range.endPointIndex + 1);
  }
  return Array.from(
    { length: sampleCount },
    (_, sampleIndex) => points[sampledRangePointIndex(range, sampleIndex, sampleCount)],
  );
}

/**
 * Allocation-bounded fingerprint for route-derived caches.
 *
 * Coordinates retain the previous six-decimal precision, while two independent
 * 32-bit streams keep the compact key collision-resistant without constructing
 * one giant per-point string.
 */
export function routePointArrayFingerprint(
  points: RoutePoint[],
  options?: RoutePointIndexRange,
): string {
  const range = normalizedRoutePointRange(points, options);
  if (range.pointCount === 0) return "empty";

  let hashA = 0x811c9dc5;
  let hashB = 0x9e3779b9;
  const mix = (value: number) => {
    const integer = value | 0;
    hashA = Math.imul(hashA ^ integer, 0x01000193) >>> 0;
    hashB = Math.imul(hashB ^ integer, 0x85ebca6b) >>> 0;
    hashB = (hashB ^ (hashB >>> 13)) >>> 0;
  };

  mix(range.pointCount);
  const sampleCount = sampledRangePointCount(range);
  mix(sampleCount);
  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
    const pointIndex = sampledRangePointIndex(range, sampleIndex, sampleCount);
    const point = points[pointIndex];
    mix(pointIndex - range.startPointIndex);
    mix(fingerprintNumber(point.idx));
    mix(fingerprintNumber(point.distanceFromStartMeters));
    mix(fingerprintNumber(point.latitude, 1_000_000));
    mix(fingerprintNumber(point.longitude, 1_000_000));
    if (point.elevationMeters == null) {
      mix(0x7fffffff);
    } else {
      mix(fingerprintNumber(point.elevationMeters));
    }
  }

  return `${range.pointCount}:${hashA.toString(16).padStart(8, "0")}${hashB
    .toString(16)
    .padStart(8, "0")}`;
}

function projectedPoint(point: RoutePoint, origin: RoutePoint): { x: number; y: number } {
  const cosLat = Math.cos(toRad(origin.latitude));
  return {
    x: (point.longitude - origin.longitude) * METERS_PER_LAT_DEGREE * cosLat,
    y: (point.latitude - origin.latitude) * METERS_PER_LAT_DEGREE,
  };
}

function perpendicularDistanceMeters(
  point: { x: number; y: number },
  start: { x: number; y: number },
  end: { x: number; y: number },
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }
  const t = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)),
  );
  const projX = start.x + t * dx;
  const projY = start.y + t * dy;
  return Math.hypot(point.x - projX, point.y - projY);
}

export function simplifyRoutePointsForMap(
  points: RoutePoint[],
  toleranceMeters = MAP_SIMPLIFY_TOLERANCE_M,
  options?: RoutePointIndexRange,
): RoutePoint[] {
  const range = normalizedRoutePointRange(points, options);
  if (range.pointCount === 0) return [];

  // Mapbox never receives more than maxPoints, so pre-sample before RDP as well.
  // This bounds the synchronous work for a single exceptionally dense segment.
  const sourcePoints = sampledRoutePoints(points, range);
  if (sourcePoints.length <= 2) return sourcePoints;
  if (toleranceMeters <= 0 || !Number.isFinite(toleranceMeters)) {
    return sourcePoints;
  }

  const origin = sourcePoints[0];
  const projected = Array.from<{ x: number; y: number }>({ length: sourcePoints.length });
  for (let index = 0; index < sourcePoints.length; index++) {
    projected[index] = projectedPoint(sourcePoints[index], origin);
  }
  const keep = new Uint8Array(sourcePoints.length);
  keep[0] = 1;
  keep[sourcePoints.length - 1] = 1;

  const stack: [number, number][] = [[0, sourcePoints.length - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    if (end <= start + 1) continue;

    let maxDistance = -1;
    let maxIndex = -1;
    for (let i = start + 1; i < end; i++) {
      const distance = perpendicularDistanceMeters(projected[i], projected[start], projected[end]);
      if (distance > maxDistance) {
        maxDistance = distance;
        maxIndex = i;
      }
    }

    if (maxIndex !== -1 && maxDistance > toleranceMeters) {
      keep[maxIndex] = 1;
      stack.push([start, maxIndex], [maxIndex, end]);
    }
  }

  const simplified: RoutePoint[] = [];
  for (let index = 0; index < sourcePoints.length; index++) {
    if (keep[index]) simplified.push(sourcePoints[index]);
  }
  return capRouteMapPoints(simplified, range.maxPoints);
}

function capRouteMapPoints(points: RoutePoint[], maxPoints: number | null): RoutePoint[] {
  if (maxPoints == null || points.length <= maxPoints) return points;

  const capped = Array.from<RoutePoint>({ length: maxPoints });
  const sourceSpan = points.length - 1;
  const targetSpan = maxPoints - 1;
  for (let index = 0; index < maxPoints; index++) {
    capped[index] = points[Math.round((index * sourceSpan) / targetSpan)];
  }
  return capped;
}

/** Convert route points to zoom-sensitive, simplified, cached GeoJSON for Mapbox rendering. */
export function routeToMapGeoJSON(
  points: RoutePoint[],
  zoomLevel?: number,
): GeoJSON.Feature<GeoJSON.LineString> {
  const toleranceMeters = getMapSimplifyToleranceForZoom(zoomLevel);
  let cachedByTolerance = mapGeoJSONCache.get(points);
  if (!cachedByTolerance) {
    cachedByTolerance = new Map();
    mapGeoJSONCache.set(points, cachedByTolerance);
  }

  const cached = cachedByTolerance.get(toleranceMeters);
  if (cached) return cached;

  const geoJSON = measureSync("map.routeGeoJSON", () => {
    const simplified = simplifyRoutePointsForMap(points, toleranceMeters);
    return routeToGeoJSON(simplified);
  });
  cachedByTolerance.set(toleranceMeters, geoJSON);
  return geoJSON;
}

export function routeToMapGeoJSONForKey(
  cacheKey: string,
  points: RoutePoint[],
  toleranceMeters = MAP_SIMPLIFY_TOLERANCE_M,
  options?: RoutePointIndexRange,
): GeoJSON.Feature<GeoJSON.LineString> {
  const key = keyedMapGeoJSONCacheKey(cacheKey, points, toleranceMeters, options);
  const cached = keyedMapGeoJSONCache.get(key);
  if (cached?.pointsRef?.deref() === points) {
    touchKeyedMapGeoJSONCacheEntry(key, cached);
    return cached.geoJSON;
  }

  const fingerprint = routePointArrayFingerprint(points, options);
  if (cached?.fingerprint === fingerprint) {
    touchKeyedMapGeoJSONCacheEntry(key, cached);
    return cached.geoJSON;
  }

  return prepareRouteMapGeoJSONForKey(cacheKey, points, toleranceMeters, fingerprint, options);
}

export function peekRouteMapGeoJSONForKey(
  cacheKey: string,
  points: RoutePoint[],
  toleranceMeters = MAP_SIMPLIFY_TOLERANCE_M,
  options?: RoutePointIndexRange,
): GeoJSON.Feature<GeoJSON.LineString> | null {
  const key = keyedMapGeoJSONCacheKey(cacheKey, points, toleranceMeters, options);
  const cached = keyedMapGeoJSONCache.get(key);
  if (cached?.pointsRef?.deref() === points) {
    touchKeyedMapGeoJSONCacheEntry(key, cached);
    return cached.geoJSON;
  }
  if (!cached) return null;

  const fingerprint = routePointArrayFingerprint(points, options);
  if (cached.fingerprint !== fingerprint) return null;
  touchKeyedMapGeoJSONCacheEntry(key, cached);
  return cached.geoJSON;
}

export function prepareRouteMapGeoJSONForKey(
  cacheKey: string,
  points: RoutePoint[],
  toleranceMeters = MAP_SIMPLIFY_TOLERANCE_M,
  knownFingerprint?: string,
  options?: RoutePointIndexRange,
): GeoJSON.Feature<GeoJSON.LineString> {
  const cached = peekRouteMapGeoJSONForKey(cacheKey, points, toleranceMeters, options);
  if (cached) return cached;

  const fingerprint = knownFingerprint ?? routePointArrayFingerprint(points, options);
  const geoJSON = measureSync("map.routeGeoJSON", () => {
    const simplified = simplifyRoutePointsForMap(points, toleranceMeters, options);
    return routeToGeoJSON(simplified);
  });
  const key = keyedMapGeoJSONCacheKey(cacheKey, points, toleranceMeters, options);
  setKeyedMapGeoJSONCacheEntry(key, {
    pointsRef: typeof WeakRef === "undefined" ? null : new WeakRef(points),
    fingerprint,
    geoJSON,
  });
  return geoJSON;
}

function keyedMapGeoJSONCacheKey(
  cacheKey: string,
  points: readonly RoutePoint[],
  toleranceMeters: number,
  options?: RoutePointIndexRange,
): string {
  const range = normalizedRoutePointRange(points, options);
  return `${cacheKey}:${toleranceMeters}:${range.startPointIndex}:${range.endPointIndex}:${range.maxPoints ?? "all"}`;
}

function touchKeyedMapGeoJSONCacheEntry(
  key: string,
  entry: {
    pointsRef: WeakRef<RoutePoint[]> | null;
    fingerprint: string;
    geoJSON: GeoJSON.Feature<GeoJSON.LineString>;
  },
): void {
  keyedMapGeoJSONCache.delete(key);
  keyedMapGeoJSONCache.set(key, entry);
}

function setKeyedMapGeoJSONCacheEntry(
  key: string,
  entry: {
    pointsRef: WeakRef<RoutePoint[]> | null;
    fingerprint: string;
    geoJSON: GeoJSON.Feature<GeoJSON.LineString>;
  },
): void {
  keyedMapGeoJSONCache.delete(key);
  keyedMapGeoJSONCache.set(key, entry);
  while (keyedMapGeoJSONCache.size > MAX_KEYED_MAP_GEOJSON_CACHE_ENTRIES) {
    const oldestKey = keyedMapGeoJSONCache.keys().next().value;
    if (oldestKey == null) break;
    keyedMapGeoJSONCache.delete(oldestKey);
  }
}
