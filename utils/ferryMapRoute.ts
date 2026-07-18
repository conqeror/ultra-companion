import {
  ferryMapGeometrySignature,
  resolveFerryMapGeometry,
  type FerryGeometryPoint,
} from "@/services/ferryGeometry";
import type { DisplayFerryCrossing, RoutePoint } from "@/types";
import { haversineDistance, interpolateRoutePointAtDistance } from "@/utils/geo";

const DISTANCE_EPSILON_METERS = 0.01;

interface ResolvedFerryMapSpan {
  crossing: DisplayFerryCrossing;
  startDistanceMeters: number;
  endDistanceMeters: number;
  geometry: FerryGeometryPoint[];
}

export interface FerryMapRouteComposition {
  /** Base-route pieces with every complete ferry interval removed. */
  landPieces: RoutePoint[][];
  /** Map-only continuous points using the ferry line in place of raw route points. */
  displayPoints: RoutePoint[];
}

export interface FerryAwarePreviewLayer {
  id: string;
  cacheKey?: string;
  points: RoutePoint[];
  isActive: boolean;
}

function resolvedFerriesForPoints(
  points: RoutePoint[],
  crossings: readonly DisplayFerryCrossing[],
): ResolvedFerryMapSpan[] {
  if (points.length < 2 || crossings.length === 0) return [];
  const routeStart = points[0].distanceFromStartMeters;
  const routeEnd = points[points.length - 1].distanceFromStartMeters;
  const resolved: ResolvedFerryMapSpan[] = [];
  let previousEnd = Number.NEGATIVE_INFINITY;

  for (const crossing of [...crossings].sort(
    (a, b) => a.effectiveStartDistanceMeters - b.effectiveStartDistanceMeters,
  )) {
    const startDistanceMeters = crossing.effectiveStartDistanceMeters;
    const endDistanceMeters = crossing.effectiveEndDistanceMeters;
    if (
      startDistanceMeters < routeStart - DISTANCE_EPSILON_METERS ||
      endDistanceMeters > routeEnd + DISTANCE_EPSILON_METERS ||
      endDistanceMeters <= startDistanceMeters + DISTANCE_EPSILON_METERS ||
      startDistanceMeters < previousEnd - DISTANCE_EPSILON_METERS
    ) {
      continue;
    }
    const geometry = resolveFerryMapGeometry(crossing);
    if (!geometry || geometry.length < 2) continue;
    resolved.push({ crossing, startDistanceMeters, endDistanceMeters, geometry });
    previousEnd = endDistanceMeters;
  }
  return resolved;
}

function anchorPoint(
  points: RoutePoint[],
  crossing: DisplayFerryCrossing,
  boundary: "start" | "end",
): RoutePoint {
  const distanceFromStartMeters =
    boundary === "start"
      ? crossing.effectiveStartDistanceMeters
      : crossing.effectiveEndDistanceMeters;
  const interpolated = interpolateRoutePointAtDistance(points, distanceFromStartMeters);
  return {
    idx: -1,
    distanceFromStartMeters,
    latitude: boundary === "start" ? crossing.startLatitude : crossing.endLatitude,
    longitude: boundary === "start" ? crossing.startLongitude : crossing.endLongitude,
    elevationMeters: interpolated?.elevationMeters ?? null,
  };
}

function pushDistinct(points: RoutePoint[], point: RoutePoint): void {
  const previous = points[points.length - 1];
  if (
    previous &&
    Math.abs(previous.distanceFromStartMeters - point.distanceFromStartMeters) <=
      DISTANCE_EPSILON_METERS &&
    previous.latitude === point.latitude &&
    previous.longitude === point.longitude
  ) {
    return;
  }
  points.push(point);
}

function landPiecesForResolvedFerries(
  points: RoutePoint[],
  ferries: readonly ResolvedFerryMapSpan[],
): RoutePoint[][] {
  if (ferries.length === 0) return [points];
  const pieces: RoutePoint[][] = [];
  let sourceIndex = 0;
  let current: RoutePoint[] = [];

  for (const ferry of ferries) {
    while (
      sourceIndex < points.length &&
      points[sourceIndex].distanceFromStartMeters <
        ferry.startDistanceMeters - DISTANCE_EPSILON_METERS
    ) {
      pushDistinct(current, points[sourceIndex++]);
    }
    pushDistinct(current, anchorPoint(points, ferry.crossing, "start"));
    if (current.length >= 2) pieces.push(current);

    current = [anchorPoint(points, ferry.crossing, "end")];
    while (
      sourceIndex < points.length &&
      points[sourceIndex].distanceFromStartMeters <=
        ferry.endDistanceMeters + DISTANCE_EPSILON_METERS
    ) {
      sourceIndex += 1;
    }
  }

  while (sourceIndex < points.length) pushDistinct(current, points[sourceIndex++]);
  if (current.length >= 2) pieces.push(current);
  return pieces;
}

function geometryRoutePoints(ferry: ResolvedFerryMapSpan): RoutePoint[] {
  const cumulative = [0];
  for (let index = 1; index < ferry.geometry.length; index++) {
    const previous = ferry.geometry[index - 1];
    const point = ferry.geometry[index];
    cumulative.push(
      cumulative[index - 1] +
        haversineDistance(previous.latitude, previous.longitude, point.latitude, point.longitude),
    );
  }
  const totalGeometryMeters = cumulative[cumulative.length - 1];
  const routeSpanMeters = ferry.endDistanceMeters - ferry.startDistanceMeters;
  return ferry.geometry.map((point, index) => ({
    idx: -1,
    latitude: point.latitude,
    longitude: point.longitude,
    elevationMeters: null,
    distanceFromStartMeters:
      ferry.startDistanceMeters +
      routeSpanMeters *
        (totalGeometryMeters > 0
          ? cumulative[index] / totalGeometryMeters
          : index / Math.max(1, ferry.geometry.length - 1)),
  }));
}

function displayPointsForResolvedFerries(
  points: RoutePoint[],
  ferries: readonly ResolvedFerryMapSpan[],
): RoutePoint[] {
  if (ferries.length === 0) return points;
  const displayed: RoutePoint[] = [];
  let sourceIndex = 0;

  for (const ferry of ferries) {
    while (
      sourceIndex < points.length &&
      points[sourceIndex].distanceFromStartMeters <
        ferry.startDistanceMeters - DISTANCE_EPSILON_METERS
    ) {
      pushDistinct(displayed, points[sourceIndex++]);
    }
    geometryRoutePoints(ferry).forEach((point) => pushDistinct(displayed, point));
    while (
      sourceIndex < points.length &&
      points[sourceIndex].distanceFromStartMeters <=
        ferry.endDistanceMeters + DISTANCE_EPSILON_METERS
    ) {
      sourceIndex += 1;
    }
  }
  while (sourceIndex < points.length) pushDistinct(displayed, points[sourceIndex++]);
  return displayed;
}

/**
 * Build only the road pieces needed by route-line renderers. Keeping this path
 * separate prevents previews and per-segment rendering from allocating a
 * second full-route display array that they immediately discard.
 */
export function buildFerryMapLandPieces(
  points: RoutePoint[],
  crossings: readonly DisplayFerryCrossing[],
): RoutePoint[][] {
  return landPiecesForResolvedFerries(points, resolvedFerriesForPoints(points, crossings));
}

/**
 * Build the continuous map-only route with stored ferry geometry replacing raw
 * water points. Original road points are retained by reference; only ferry
 * geometry points are allocated.
 */
export function buildFerryMapDisplayPoints(
  points: RoutePoint[],
  crossings: readonly DisplayFerryCrossing[],
): RoutePoint[] {
  return displayPointsForResolvedFerries(points, resolvedFerriesForPoints(points, crossings));
}

/** Use only when one consumer needs both outputs; prefer the focused builders above otherwise. */
export function buildFerryMapRouteComposition(
  points: RoutePoint[],
  crossings: readonly DisplayFerryCrossing[],
): FerryMapRouteComposition {
  const ferries = resolvedFerriesForPoints(points, crossings);
  return {
    landPieces: landPiecesForResolvedFerries(points, ferries),
    displayPoints: displayPointsForResolvedFerries(points, ferries),
  };
}

/**
 * Splits active preview routes into land-only pieces. Ferry geometry is rendered
 * separately so overview simplification cannot reconnect or flatten a crossing.
 * Inactive variant overlays remain unchanged until they become selected.
 */
export function buildFerryAwarePreviewLayers<T extends FerryAwarePreviewLayer>(
  layers: readonly T[],
  crossings: readonly DisplayFerryCrossing[],
): T[] {
  if (crossings.length === 0) return layers.slice();
  const geometrySignature = ferryMapGeometrySignature(crossings);

  return layers.flatMap((layer) => {
    if (!layer.isActive || layer.points.length < 2) return [layer];
    const pieces = buildFerryMapLandPieces(layer.points, crossings);
    if (pieces.length === 1 && pieces[0] === layer.points) return [layer];

    return pieces.map(
      (points, pieceIndex) =>
        Object.assign({}, layer, {
          id: pieceIndex === 0 ? layer.id : `${layer.id}-land-${pieceIndex}`,
          cacheKey: `${layer.cacheKey ?? layer.id}:ferries:${geometrySignature}:land:${pieceIndex}`,
          points,
        }) as T,
    );
  });
}

export function ferriesContainedInDistanceRange(
  crossings: readonly DisplayFerryCrossing[],
  startDistanceMeters: number,
  endDistanceMeters: number,
): DisplayFerryCrossing[] {
  return crossings.filter(
    (crossing) =>
      crossing.effectiveStartDistanceMeters >= startDistanceMeters - DISTANCE_EPSILON_METERS &&
      crossing.effectiveEndDistanceMeters <= endDistanceMeters + DISTANCE_EPSILON_METERS,
  );
}
