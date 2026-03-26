import type { RoutePoint } from "@/types";

const EARTH_RADIUS_M = 6_371_000;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Haversine distance between two points in meters */
export function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
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
      index: i,
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
): { index: number; distanceMeters: number } {
  let minDist = Infinity;
  let minIndex = 0;

  for (let i = 0; i < points.length; i++) {
    const d = haversineDistance(lat, lon, points[i].latitude, points[i].longitude);
    if (d < minDist) {
      minDist = d;
      minIndex = i;
    }
  }

  return { index: minIndex, distanceMeters: minDist };
}

/** Downsample an array to at most maxPoints using Ramer-Douglas-Peucker on elevation vs distance */
export function downsampleForChart<T extends { distanceFromStartMeters: number; elevationMeters: number | null }>(
  points: T[],
  maxPoints: number,
): T[] {
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

  let endIndex = startIndex;
  while (endIndex < points.length - 1 && points[endIndex + 1].distanceFromStartMeters <= endDist) {
    endIndex++;
  }
  // Include one point past the boundary for a complete slice
  if (endIndex < points.length - 1) endIndex++;

  const slice = points.slice(startIndex, endIndex + 1);
  return slice.map((p, i) => ({
    ...p,
    distanceFromStartMeters: p.distanceFromStartMeters - startDist,
    index: i,
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
  for (let i = startIndex + 1; i < points.length; i++) {
    if (points[i].distanceFromStartMeters > endDistanceMeters) break;
    const prev = points[i - 1].elevationMeters;
    const curr = points[i].elevationMeters;
    if (prev != null && curr != null && curr > prev) ascent += curr - prev;
  }
  return ascent;
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
