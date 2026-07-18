import type { DisplayFerryCrossing, FerryCrossing } from "@/types";
import { haversineDistance } from "@/utils/geo";

export interface FerryGeometryPoint {
  latitude: number;
  longitude: number;
}

/**
 * `providerRefs.osmGeometryV1` stores a JSON-encoded GeoJSON-order
 * `[longitude, latitude][]` array. The version lives in the key so a later
 * representation can coexist without a ferry-table migration.
 */
export const OSM_FERRY_GEOMETRY_PROVIDER_REF = "osmGeometryV1";
export const MAX_OSM_FERRY_GEOMETRY_POINTS = 2_048;
export const MAX_OSM_FERRY_GEOMETRY_JSON_LENGTH = 200_000;

const ANCHOR_DEDUPE_METERS = 5;
const CONSECUTIVE_DEDUPE_METERS = 0.25;
const MAX_STORED_ENDPOINT_JUMP_METERS = 2_000;
const MAX_STORED_GEOMETRY_SEGMENT_METERS = 250_000;
const MAX_STORED_GEOMETRY_TOTAL_METERS = 1_000_000;

function validPoint(point: FerryGeometryPoint): boolean {
  return (
    Number.isFinite(point.latitude) &&
    Number.isFinite(point.longitude) &&
    point.latitude >= -90 &&
    point.latitude <= 90 &&
    point.longitude >= -180 &&
    point.longitude <= 180
  );
}

function sampledPoints(
  points: readonly FerryGeometryPoint[],
  maxPoints = MAX_OSM_FERRY_GEOMETRY_POINTS,
): FerryGeometryPoint[] {
  if (points.length <= maxPoints) return points.map((point) => ({ ...point }));
  const sampled = Array.from<FerryGeometryPoint>({ length: maxPoints });
  const sourceSpan = points.length - 1;
  const targetSpan = maxPoints - 1;
  for (let index = 0; index < maxPoints; index++) {
    sampled[index] = { ...points[Math.round((index * sourceSpan) / targetSpan)] };
  }
  return sampled;
}

export function encodeOSMFerryGeometry(points: readonly FerryGeometryPoint[]): string | null {
  if (points.length < 2 || points.some((point) => !validPoint(point))) return null;
  return JSON.stringify(
    sampledPoints(points).map((point) => [point.longitude, point.latitude] as const),
  );
}

export function decodeOSMFerryGeometry(
  providerRefs: Readonly<Record<string, string>>,
): FerryGeometryPoint[] | null {
  const encoded = providerRefs[OSM_FERRY_GEOMETRY_PROVIDER_REF];
  if (!encoded || encoded.length > MAX_OSM_FERRY_GEOMETRY_JSON_LENGTH) return null;
  try {
    const value: unknown = JSON.parse(encoded);
    if (!Array.isArray(value) || value.length < 2) return null;
    const points: FerryGeometryPoint[] = [];
    for (const coordinate of value) {
      if (
        !Array.isArray(coordinate) ||
        coordinate.length !== 2 ||
        typeof coordinate[0] !== "number" ||
        typeof coordinate[1] !== "number"
      ) {
        return null;
      }
      const point = { longitude: coordinate[0], latitude: coordinate[1] };
      if (!validPoint(point)) return null;
      points.push(point);
    }
    return sampledPoints(points);
  } catch {
    return null;
  }
}

export function orientFerryGeometry(
  points: readonly FerryGeometryPoint[],
  start: FerryGeometryPoint,
  end: FerryGeometryPoint,
): FerryGeometryPoint[] {
  if (points.length < 2) return points.map((point) => ({ ...point }));
  const first = points[0];
  const last = points[points.length - 1];
  const forwardCost =
    haversineDistance(start.latitude, start.longitude, first.latitude, first.longitude) +
    haversineDistance(end.latitude, end.longitude, last.latitude, last.longitude);
  const reverseCost =
    haversineDistance(start.latitude, start.longitude, last.latitude, last.longitude) +
    haversineDistance(end.latitude, end.longitude, first.latitude, first.longitude);
  const oriented = reverseCost < forwardCost ? points.toReversed() : points;
  return oriented.map((point) => ({
    latitude: point.latitude,
    longitude: point.longitude,
  }));
}

function appendIfDistinct(points: FerryGeometryPoint[], point: FerryGeometryPoint): void {
  const previous = points[points.length - 1];
  if (
    previous &&
    haversineDistance(previous.latitude, previous.longitude, point.latitude, point.longitude) <=
      CONSECUTIVE_DEDUPE_METERS
  ) {
    return;
  }
  points.push({ ...point });
}

function hasImplausibleGeometryJump(points: readonly FerryGeometryPoint[]): boolean {
  let totalMeters = 0;
  for (let index = 1; index < points.length; index++) {
    const previous = points[index - 1];
    const point = points[index];
    const segmentMeters = haversineDistance(
      previous.latitude,
      previous.longitude,
      point.latitude,
      point.longitude,
    );
    if (segmentMeters > MAX_STORED_GEOMETRY_SEGMENT_METERS) return true;
    totalMeters += segmentMeters;
    if (totalMeters > MAX_STORED_GEOMETRY_TOTAL_METERS) return true;
  }
  return false;
}

/** Returns an oriented map line with exact snapped route anchors at both ends. */
export function resolveFerryMapGeometry(
  crossing: Pick<
    FerryCrossing,
    "startLatitude" | "startLongitude" | "endLatitude" | "endLongitude" | "providerRefs"
  >,
): FerryGeometryPoint[] | null {
  const start = {
    latitude: crossing.startLatitude,
    longitude: crossing.startLongitude,
  };
  const end = {
    latitude: crossing.endLatitude,
    longitude: crossing.endLongitude,
  };
  if (!validPoint(start) || !validPoint(end)) return null;

  const decoded = decodeOSMFerryGeometry(crossing.providerRefs);
  if (!decoded) return [start, end];
  const oriented = orientFerryGeometry(decoded, start, end);
  const first = oriented[0];
  const last = oriented[oriented.length - 1];
  if (
    haversineDistance(start.latitude, start.longitude, first.latitude, first.longitude) >
      MAX_STORED_ENDPOINT_JUMP_METERS ||
    haversineDistance(end.latitude, end.longitude, last.latitude, last.longitude) >
      MAX_STORED_ENDPOINT_JUMP_METERS ||
    hasImplausibleGeometryJump(oriented)
  ) {
    return [start, end];
  }
  const result: FerryGeometryPoint[] = [{ ...start }];
  oriented.forEach((point, index) => {
    const distanceToStart = haversineDistance(
      start.latitude,
      start.longitude,
      point.latitude,
      point.longitude,
    );
    const distanceToEnd = haversineDistance(
      end.latitude,
      end.longitude,
      point.latitude,
      point.longitude,
    );
    if (index === 0 && distanceToStart <= ANCHOR_DEDUPE_METERS) return;
    if (index === oriented.length - 1 && distanceToEnd <= ANCHOR_DEDUPE_METERS) return;
    appendIfDistinct(result, point);
  });
  appendIfDistinct(result, end);
  if (result.length === 1) result.push({ ...end });
  result[result.length - 1] = { ...end };
  return result;
}

function hashString(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** Map cache signature; timing-only ferry edits intentionally do not affect it. */
export function ferryMapGeometrySignature(crossings: readonly DisplayFerryCrossing[]): string {
  return [...crossings]
    .sort(
      (a, b) =>
        a.effectiveStartDistanceMeters - b.effectiveStartDistanceMeters || a.id.localeCompare(b.id),
    )
    .map((crossing) => {
      const encoded = crossing.providerRefs[OSM_FERRY_GEOMETRY_PROVIDER_REF] ?? "";
      return [
        crossing.id,
        crossing.effectiveStartDistanceMeters.toFixed(1),
        crossing.effectiveEndDistanceMeters.toFixed(1),
        crossing.startLatitude.toFixed(6),
        crossing.startLongitude.toFixed(6),
        crossing.endLatitude.toFixed(6),
        crossing.endLongitude.toFixed(6),
        hashString(encoded),
      ].join(":");
    })
    .join("|");
}
