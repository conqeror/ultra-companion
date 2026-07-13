import { computeCachedRouteTotalETA } from "@/services/etaCalculator";
import {
  buildPatchVariantRoutePoints,
  routeEndDistance,
  sliceRoutePointsByDistance,
} from "@/services/stitchingService";
import { computeSliceAscentFromDistance } from "@/utils/geo";
import type { CollectionSegmentWithRoute, PowerModelConfig, RoutePoint } from "@/types";

export interface CollectionVariantMetric {
  distanceMeters: number;
  ascentMeters: number;
  ridingTime: number | null;
}

export interface CollectionVariantDisplayData {
  metricsByKey: Record<string, CollectionVariantMetric>;
  overlayPointsByKey: Record<string, RoutePoint[]>;
}

export type LoadRoutePoints = (routeId: string) => Promise<RoutePoint[]>;

export function collectionVariantKey(sw: CollectionSegmentWithRoute): string {
  return `${sw.segment.collectionId}:${sw.segment.position}:${sw.route.id}:${sw.segment.variantKind}`;
}

function groupCollectionSegments(
  segments: CollectionSegmentWithRoute[],
): CollectionSegmentWithRoute[][] {
  const grouped = new Map<number, CollectionSegmentWithRoute[]>();
  for (const sw of segments) {
    if (!grouped.has(sw.segment.position)) grouped.set(sw.segment.position, []);
    grouped.get(sw.segment.position)!.push(sw);
  }
  return [...grouped.entries()].sort(([a], [b]) => a - b).map(([, variants]) => variants);
}

function effectiveVariantPoints(
  sw: CollectionSegmentWithRoute,
  pointsByRouteId: Record<string, RoutePoint[]>,
): RoutePoint[] | null {
  const routePoints = pointsByRouteId[sw.route.id];
  if (sw.segment.variantKind !== "patch") return routePoints ?? null;

  const { baseRouteId, replaceStartDistanceMeters, replaceEndDistanceMeters } = sw.segment;
  if (
    !baseRouteId ||
    replaceStartDistanceMeters == null ||
    replaceEndDistanceMeters == null ||
    !routePoints
  ) {
    return routePoints ?? null;
  }

  const basePoints = pointsByRouteId[baseRouteId];
  if (!basePoints) return routePoints;
  const stitched = buildPatchVariantRoutePoints(
    basePoints,
    routePoints,
    replaceStartDistanceMeters,
    replaceEndDistanceMeters,
  );
  return stitched.length >= 2 ? stitched : routePoints;
}

function effectiveVariantAscentMeters(
  sw: CollectionSegmentWithRoute,
  pointsByRouteId: Record<string, RoutePoint[]>,
): number {
  const { baseRouteId, replaceStartDistanceMeters, replaceEndDistanceMeters } = sw.segment;
  if (
    sw.segment.variantKind === "patch" &&
    baseRouteId &&
    replaceStartDistanceMeters != null &&
    replaceEndDistanceMeters != null
  ) {
    const basePoints = pointsByRouteId[baseRouteId];
    if (basePoints?.length) {
      const baseEnd = routeEndDistance(basePoints);
      return (
        computeSliceAscentFromDistance(basePoints, 0, replaceStartDistanceMeters) +
        sw.route.totalAscentMeters +
        computeSliceAscentFromDistance(basePoints, replaceEndDistanceMeters, baseEnd)
      );
    }
  }
  return sw.route.totalAscentMeters;
}

/**
 * Fetch only variant positions. Raw arrays exist only while their metrics are
 * calculated; returned arrays are the exact geometry the overlay draws.
 */
export async function loadCollectionVariantDisplayData(
  segments: CollectionSegmentWithRoute[],
  powerConfig: PowerModelConfig,
  loadRoutePoints: LoadRoutePoints,
): Promise<CollectionVariantDisplayData> {
  const metricsByKey: Record<string, CollectionVariantMetric> = {};
  const overlayPointsByKey: Record<string, RoutePoint[]> = {};

  for (const variants of groupCollectionSegments(segments)) {
    if (variants.length <= 1) continue;

    const routeIds = new Set<string>();
    for (const sw of variants) {
      routeIds.add(sw.route.id);
      if (sw.segment.variantKind === "patch" && sw.segment.baseRouteId) {
        routeIds.add(sw.segment.baseRouteId);
      }
    }

    // Sequential loading bounds the temporary raw geometry held while a
    // large collection's variants are being prepared.
    const pointsByRouteId: Record<string, RoutePoint[]> = {};
    for (const routeId of routeIds) {
      pointsByRouteId[routeId] = await loadRoutePoints(routeId);
    }

    for (const sw of variants) {
      const points = effectiveVariantPoints(sw, pointsByRouteId);
      if (!points || points.length < 2) continue;
      metricsByKey[collectionVariantKey(sw)] = {
        distanceMeters: routeEndDistance(points),
        ascentMeters: effectiveVariantAscentMeters(sw, pointsByRouteId),
        ridingTime: computeCachedRouteTotalETA(collectionVariantKey(sw), points, powerConfig),
      };
    }

    const reference = variants.find((sw) => sw.segment.isSelected) ?? variants[0];
    for (const sw of variants) {
      if (sw.segment.isSelected) continue;
      const rawPoints = pointsByRouteId[sw.route.id];
      const points =
        rawPoints &&
        sw.segment.variantKind === "full" &&
        reference.segment.variantKind === "patch" &&
        reference.segment.baseRouteId === sw.route.id &&
        reference.segment.replaceStartDistanceMeters != null &&
        reference.segment.replaceEndDistanceMeters != null
          ? sliceRoutePointsByDistance(
              rawPoints,
              reference.segment.replaceStartDistanceMeters,
              reference.segment.replaceEndDistanceMeters,
            )
          : rawPoints;
      if (points?.length >= 2) overlayPointsByKey[collectionVariantKey(sw)] = points;
    }
  }

  return { metricsByKey, overlayPointsByKey };
}
