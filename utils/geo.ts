import type { RoutePoint } from "@/types";

const EARTH_RADIUS_M = 6_371_000;
const METERS_PER_LAT_DEGREE = 111_320;
const MAP_SIMPLIFY_TOLERANCE_M = 20;
const mapGeoJSONCache = new WeakMap<RoutePoint[], GeoJSON.Feature<GeoJSON.LineString>>();

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
  let totalAscent = 0;
  let totalDescent = 0;

  const points: RoutePoint[] = coords.map((coord, i) => {
    if (i > 0) {
      const prev = coords[i - 1];
      totalDistance += haversineDistance(
        prev.latitude,
        prev.longitude,
        coord.latitude,
        coord.longitude,
      );

      if (coord.elevation != null && prev.elevation != null) {
        const elevDiff = coord.elevation - prev.elevation;
        if (elevDiff > 0) totalAscent += elevDiff;
        else totalDescent += Math.abs(elevDiff);
      }
    }

    return {
      latitude: coord.latitude,
      longitude: coord.longitude,
      elevationMeters: coord.elevation,
      distanceFromStartMeters: totalDistance,
      idx: i,
    };
  });

  return {
    points,
    totalDistanceMeters: totalDistance,
    totalAscentMeters: totalAscent,
    totalDescentMeters: totalDescent,
  };
}

/**
 * Find the nearest point on a route to a given position.
 * Returns the index of the nearest point and perpendicular distance.
 */
export function findNearestPointOnRoute(
  lat: number,
  lon: number,
  points: RoutePoint[],
  options?: { startIndex?: number; endIndex?: number },
): { index: number; distanceMeters: number } {
  let minDist = Infinity;
  let minIndex = options?.startIndex ?? 0;
  const startIndex = Math.max(0, options?.startIndex ?? 0);
  const endIndex = Math.min(points.length - 1, options?.endIndex ?? points.length - 1);

  for (let i = startIndex; i <= endIndex; i++) {
    const d = haversineDistance(lat, lon, points[i].latitude, points[i].longitude);
    if (d < minDist) {
      minDist = d;
      minIndex = i;
    }
  }

  return { index: minIndex, distanceMeters: minDist };
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

/** Downsample an array to at most maxPoints using Ramer-Douglas-Peucker on elevation vs distance */
export function downsampleForChart<
  T extends { distanceFromStartMeters: number; elevationMeters: number | null },
>(points: T[], maxPoints: number): T[] {
  if (points.length <= maxPoints) return points;

  // Simple uniform sampling — preserves first and last
  const step = (points.length - 1) / (maxPoints - 1);
  const result: T[] = [];
  for (let i = 0; i < maxPoints; i++) {
    result.push(points[Math.round(i * step)]);
  }
  return result;
}

/** Compute elevation gain/loss done and remaining at a given point index */
export function computeElevationProgress(
  points: RoutePoint[],
  currentIndex: number,
): {
  ascentDone: number;
  descentDone: number;
  ascentRemaining: number;
  descentRemaining: number;
} {
  let ascentDone = 0;
  let descentDone = 0;
  let ascentRemaining = 0;
  let descentRemaining = 0;

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1].elevationMeters;
    const curr = points[i].elevationMeters;
    if (prev == null || curr == null) continue;
    const diff = curr - prev;
    if (i <= currentIndex) {
      if (diff > 0) ascentDone += diff;
      else descentDone += Math.abs(diff);
    } else {
      if (diff > 0) ascentRemaining += diff;
      else descentRemaining += Math.abs(diff);
    }
  }

  return { ascentDone, descentDone, ascentRemaining, descentRemaining };
}

function addElevationDelta(
  fromElevation: number,
  toElevation: number,
  bucket: { ascent: number; descent: number },
): void {
  const diff = toElevation - fromElevation;
  if (diff > 0) bucket.ascent += diff;
  else bucket.descent += Math.abs(diff);
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
  const done = { ascent: 0, descent: 0 };
  const remaining = { ascent: 0, descent: 0 };

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    if (prev.elevationMeters == null || curr.elevationMeters == null) continue;

    const startDist = prev.distanceFromStartMeters;
    const endDist = curr.distanceFromStartMeters;

    if (currentDistanceMeters >= endDist) {
      addElevationDelta(prev.elevationMeters, curr.elevationMeters, done);
    } else if (currentDistanceMeters <= startDist) {
      addElevationDelta(prev.elevationMeters, curr.elevationMeters, remaining);
    } else {
      const t = (currentDistanceMeters - startDist) / (endDist - startDist);
      const currentElevation =
        prev.elevationMeters + t * (curr.elevationMeters - prev.elevationMeters);
      addElevationDelta(prev.elevationMeters, currentElevation, done);
      addElevationDelta(currentElevation, curr.elevationMeters, remaining);
    }
  }

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

/** Compute ascent within a distance-bounded slice starting at a given index */
export function computeSliceAscent(
  points: RoutePoint[],
  startIndex: number,
  endDistanceMeters: number,
): number {
  let ascent = 0;
  const endIndex = findLastPointAtOrBeforeDistance(points, endDistanceMeters, startIndex + 1);
  for (let i = startIndex + 1; i <= endIndex; i++) {
    const prev = points[i - 1].elevationMeters;
    const curr = points[i].elevationMeters;
    if (prev != null && curr != null && curr > prev) ascent += curr - prev;
  }
  return ascent;
}

function computeSliceElevationTotals(
  points: RoutePoint[],
  startDistanceMeters: number,
  endDistanceMeters: number,
): { ascent: number; descent: number } {
  const totals = { ascent: 0, descent: 0 };
  if (endDistanceMeters <= startDistanceMeters) return totals;

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    if (prev.elevationMeters == null || curr.elevationMeters == null) continue;

    const segStart = prev.distanceFromStartMeters;
    const segEnd = curr.distanceFromStartMeters;
    if (segEnd <= startDistanceMeters) continue;
    if (segStart >= endDistanceMeters) break;
    if (segEnd <= segStart) continue;

    const fromDistance = Math.max(startDistanceMeters, segStart);
    const toDistance = Math.min(endDistanceMeters, segEnd);
    if (toDistance <= fromDistance) continue;

    const fromT = (fromDistance - segStart) / (segEnd - segStart);
    const toT = (toDistance - segStart) / (segEnd - segStart);
    const fromElevation =
      prev.elevationMeters + fromT * (curr.elevationMeters - prev.elevationMeters);
    const toElevation = prev.elevationMeters + toT * (curr.elevationMeters - prev.elevationMeters);
    addElevationDelta(fromElevation, toElevation, totals);
  }

  return totals;
}

export function computeSliceAscentFromDistance(
  points: RoutePoint[],
  startDistanceMeters: number,
  endDistanceMeters: number,
): number {
  return computeSliceElevationTotals(points, startDistanceMeters, endDistanceMeters).ascent;
}

/** Compute descent within a distance-bounded slice starting at a given index */
export function computeSliceDescent(
  points: RoutePoint[],
  startIndex: number,
  endDistanceMeters: number,
): number {
  let descent = 0;
  const endIndex = findLastPointAtOrBeforeDistance(points, endDistanceMeters, startIndex + 1);
  for (let i = startIndex + 1; i <= endIndex; i++) {
    const prev = points[i - 1].elevationMeters;
    const curr = points[i].elevationMeters;
    if (prev != null && curr != null && curr < prev) descent += prev - curr;
  }
  return descent;
}

export function computeSliceDescentFromDistance(
  points: RoutePoint[],
  startDistanceMeters: number,
  endDistanceMeters: number,
): number {
  return computeSliceElevationTotals(points, startDistanceMeters, endDistanceMeters).descent;
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
): RoutePoint[] {
  if (points.length <= 2) return points;

  const origin = points[0];
  const projected = points.map((point) => projectedPoint(point, origin));
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  const stack: [number, number][] = [[0, points.length - 1]];
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
  for (let i = 0; i < points.length; i++) {
    if (keep[i]) simplified.push(points[i]);
  }
  return simplified;
}

/** Convert route points to simplified, cached GeoJSON for Mapbox rendering. */
export function routeToMapGeoJSON(points: RoutePoint[]): GeoJSON.Feature<GeoJSON.LineString> {
  const cached = mapGeoJSONCache.get(points);
  if (cached) return cached;
  const simplified = simplifyRoutePointsForMap(points);
  const geoJSON = routeToGeoJSON(simplified);
  mapGeoJSONCache.set(points, geoJSON);
  return geoJSON;
}
