import { computeCachedRouteTotalETAInChunks } from "@/services/etaCalculator";
import {
  buildPatchVariantRoutePoints,
  routeEndDistance,
  sliceRoutePointsByDistance,
} from "@/services/stitchingService";
import {
  allocateMapCoordinateBudget,
  interpolateRoutePointAtDistance,
  MAX_VARIANT_MAP_GEOJSON_POINTS,
  prepareRouteMapGeoJSONForKey,
} from "@/utils/geo";
import type {
  CollectionSegmentWithRoute,
  DisplayFerryCrossing,
  FerryCrossing,
  PowerModelConfig,
  RoutePoint,
} from "@/types";
import {
  computeRidingElevationTotals,
  toDisplayFerryCrossing,
  totalRidingDistanceMeters,
} from "@/services/ferryCrossings";
import { toDisplayDistanceMeters } from "@/services/displayDistance";
import { ferryMapGeometrySignature } from "@/services/ferryGeometry";
import { buildFerryMapDisplayPoints, ferriesContainedInDistanceRange } from "@/utils/ferryMapRoute";

export interface CollectionVariantMetric {
  distanceMeters: number;
  ascentMeters: number;
  ridingTime: number | null;
}

export interface CollectionVariantDisplayData {
  metricsByKey: Record<string, CollectionVariantMetric>;
  overlaysByKey: Record<string, CollectionVariantOverlayGeometry>;
}

export interface CollectionVariantOverlayGeometry {
  geoJSON: GeoJSON.Feature<GeoJSON.LineString>;
  labelCoordinate: [number, number] | null;
  cacheKey: string;
}

export type LoadRoutePoints = (routeId: string) => Promise<RoutePoint[]>;
export type LoadRouteFerries = (routeId: string) => Promise<FerryCrossing[]>;

export interface LoadCollectionVariantDisplayDataOptions {
  shouldCancel?: () => boolean;
  loadRouteFerries?: LoadRouteFerries;
}

interface VariantOverlaySection {
  kind: "land" | "ferry";
  points: RoutePoint[];
}

const FERRY_DISTANCE_EPSILON_METERS = 0.01;

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

export function getEffectiveVariantFerries(
  sw: CollectionSegmentWithRoute,
  pointsByRouteId: Record<string, RoutePoint[]>,
  ferriesByRouteId: Record<string, FerryCrossing[]>,
): DisplayFerryCrossing[] {
  if (sw.segment.variantKind !== "patch") {
    return (ferriesByRouteId[sw.route.id] ?? []).map((ferry) => toDisplayFerryCrossing(ferry));
  }
  const { baseRouteId, replaceStartDistanceMeters, replaceEndDistanceMeters } = sw.segment;
  if (!baseRouteId || replaceStartDistanceMeters == null || replaceEndDistanceMeters == null) {
    return (ferriesByRouteId[sw.route.id] ?? []).map((ferry) => toDisplayFerryCrossing(ferry));
  }
  const patchDistance = routeEndDistance(pointsByRouteId[sw.route.id] ?? []);
  const suffixOffset = replaceStartDistanceMeters + patchDistance - replaceEndDistanceMeters;
  const result: DisplayFerryCrossing[] = [];
  for (const ferry of ferriesByRouteId[baseRouteId] ?? []) {
    if (ferry.endDistanceMeters <= replaceStartDistanceMeters) {
      result.push(toDisplayFerryCrossing(ferry));
    } else if (ferry.startDistanceMeters >= replaceEndDistanceMeters) {
      result.push(toDisplayFerryCrossing(ferry, undefined, undefined, suffixOffset));
    }
  }
  for (const ferry of ferriesByRouteId[sw.route.id] ?? []) {
    result.push(
      toDisplayFerryCrossing(
        ferry,
        ferry.startDistanceMeters,
        ferry.endDistanceMeters,
        replaceStartDistanceMeters,
      ),
    );
  }
  return result;
}

function ferriesForVariantOverlay(
  sw: CollectionSegmentWithRoute,
  points: RoutePoint[],
  effectiveFerries: readonly DisplayFerryCrossing[],
): DisplayFerryCrossing[] {
  const firstDistance = points[0]?.distanceFromStartMeters;
  const lastDistance = routeEndDistance(points);
  if (firstDistance == null) return [];

  if (sw.segment.variantKind === "patch" && sw.segment.replaceStartDistanceMeters != null) {
    const distanceOffset = sw.segment.replaceStartDistanceMeters;
    const projected = effectiveFerries
      .filter((ferry) => ferry.routeId === sw.route.id)
      .map((ferry) =>
        Object.assign({}, ferry, {
          effectiveStartDistanceMeters: toDisplayDistanceMeters(
            ferry.effectiveStartDistanceMeters - distanceOffset,
          ),
          effectiveEndDistanceMeters: toDisplayDistanceMeters(
            ferry.effectiveEndDistanceMeters - distanceOffset,
          ),
        }),
      );
    return ferriesContainedInDistanceRange(projected, firstDistance, lastDistance);
  }

  return ferriesContainedInDistanceRange(effectiveFerries, firstDistance, lastDistance);
}

function variantOverlaySections(
  points: RoutePoint[],
  ferries: readonly DisplayFerryCrossing[],
): VariantOverlaySection[] {
  if (points.length === 0) return [];
  if (ferries.length === 0) return [{ kind: "land", points }];

  const sortedFerries = [...ferries].sort(
    (a, b) => a.effectiveStartDistanceMeters - b.effectiveStartDistanceMeters,
  );
  const sections: VariantOverlaySection[] = [];
  let ferryIndex = 0;

  for (const point of points) {
    while (
      ferryIndex < sortedFerries.length &&
      point.distanceFromStartMeters >
        sortedFerries[ferryIndex].effectiveEndDistanceMeters + FERRY_DISTANCE_EPSILON_METERS
    ) {
      ferryIndex += 1;
    }
    const ferry = sortedFerries[ferryIndex];
    const kind: VariantOverlaySection["kind"] =
      ferry &&
      point.distanceFromStartMeters >=
        ferry.effectiveStartDistanceMeters - FERRY_DISTANCE_EPSILON_METERS &&
      point.distanceFromStartMeters <=
        ferry.effectiveEndDistanceMeters + FERRY_DISTANCE_EPSILON_METERS
        ? "ferry"
        : "land";
    const previous = sections[sections.length - 1];
    if (previous?.kind === kind) {
      previous.points.push(point);
    } else {
      sections.push({ kind, points: [point] });
    }
  }

  return sections;
}

function variantOverlaySectionBudgets(
  sections: readonly VariantOverlaySection[],
  maxPoints: number,
): number[] {
  const budgets = sections.map(() => 0);
  let remaining = Math.max(0, Math.floor(maxPoints));

  for (let index = 0; index < sections.length; index++) {
    if (sections[index].points.length !== 1 || remaining === 0) continue;
    budgets[index] = 1;
    remaining -= 1;
  }

  const ferryIndexes = sections.flatMap((section, index) =>
    section.kind === "ferry" && section.points.length >= 2 ? [index] : [],
  );
  const landIndexes = sections.flatMap((section, index) =>
    section.kind === "land" && section.points.length >= 2 ? [index] : [],
  );
  const minimumLandBudget = landIndexes.length * 2;
  const ferryPointCounts = ferryIndexes.map((index) => sections[index].points.length);
  const ferryBudget = Math.min(
    ferryPointCounts.reduce((total, count) => total + count, 0),
    Math.max(0, remaining - minimumLandBudget),
  );
  const ferryAllocations = allocateMapCoordinateBudget(ferryPointCounts, ferryBudget);
  ferryIndexes.forEach((sectionIndex, allocationIndex) => {
    budgets[sectionIndex] = Math.min(
      sections[sectionIndex].points.length,
      ferryAllocations[allocationIndex] ?? 0,
    );
  });
  remaining -= ferryIndexes.reduce((total, index) => total + budgets[index], 0);

  const landPointCounts = landIndexes.map((index) => sections[index].points.length);
  const landAllocations = allocateMapCoordinateBudget(landPointCounts, remaining);
  landIndexes.forEach((sectionIndex, allocationIndex) => {
    budgets[sectionIndex] = Math.min(
      sections[sectionIndex].points.length,
      landAllocations[allocationIndex] ?? 0,
    );
  });
  return budgets;
}

function prepareFerryAwareVariantOverlay(
  cacheKey: string,
  points: RoutePoint[],
  ferries: readonly DisplayFerryCrossing[],
  maxPoints: number,
): {
  geoJSON: GeoJSON.Feature<GeoJSON.LineString>;
  displayPoints: RoutePoint[];
} {
  const displayPoints = buildFerryMapDisplayPoints(points, ferries);
  const sections = variantOverlaySections(displayPoints, ferries);
  const budgets = variantOverlaySectionBudgets(sections, maxPoints);
  const coordinates: GeoJSON.Position[] = [];

  sections.forEach((section, sectionIndex) => {
    const budget = budgets[sectionIndex] ?? 0;
    if (budget === 0) return;
    const sectionCoordinates =
      section.points.length === 1
        ? [[section.points[0].longitude, section.points[0].latitude]]
        : prepareRouteMapGeoJSONForKey(
            `${cacheKey}:${section.kind}:${sectionIndex}`,
            section.points,
            20,
            undefined,
            { maxPoints: budget },
          ).geometry.coordinates;
    for (const coordinate of sectionCoordinates) {
      const previous = coordinates[coordinates.length - 1];
      if (previous?.[0] === coordinate[0] && previous[1] === coordinate[1]) continue;
      coordinates.push(coordinate);
    }
  });

  return {
    geoJSON: {
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates },
    },
    displayPoints,
  };
}

function prepareCollectionVariantPreviewOverlay(
  sw: CollectionSegmentWithRoute,
  reference: CollectionSegmentWithRoute,
  pointsByRouteId: Record<string, RoutePoint[]>,
  ferriesByRouteId: Record<string, FerryCrossing[]>,
  maxPoints: number,
): CollectionVariantOverlayGeometry | null {
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
  if (!points || points.length < 2) return null;

  const key = collectionVariantKey(sw);
  const firstDistance = points[0].distanceFromStartMeters;
  const lastDistance = routeEndDistance(points);
  const effectiveFerries = getEffectiveVariantFerries(sw, pointsByRouteId, ferriesByRouteId);
  const overlayFerries = ferriesForVariantOverlay(sw, points, effectiveFerries);
  const ferryGeometryKey = ferryMapGeometrySignature(overlayFerries) || "none";
  const cacheKey = `variant-overlay:${key}:ferries:${ferryGeometryKey}`;
  const prepared = prepareFerryAwareVariantOverlay(cacheKey, points, overlayFerries, maxPoints);
  const labelPoint = interpolateRoutePointAtDistance(
    prepared.displayPoints,
    firstDistance + (lastDistance - firstDistance) / 2,
  );
  return {
    geoJSON: prepared.geoJSON,
    labelCoordinate: labelPoint ? [labelPoint.longitude, labelPoint.latitude] : null,
    cacheKey,
  };
}

/**
 * Prepare only inactive collection variants for preview rendering. The result
 * owns bounded GeoJSON rather than duplicate raw route arrays, and each variant
 * is composed with ferries from its own full/patch source routes.
 */
export function buildCollectionVariantPreviewOverlays(
  segments: CollectionSegmentWithRoute[],
  pointsByRouteId: Record<string, RoutePoint[]>,
  ferriesByRouteId: Record<string, FerryCrossing[]>,
): Record<string, CollectionVariantOverlayGeometry> {
  const overlaysByKey: Record<string, CollectionVariantOverlayGeometry> = {};
  const groupedSegments = groupCollectionSegments(segments);
  const overlayCount = groupedSegments.reduce(
    (count, variants) =>
      count +
      (variants.length > 1 ? variants.filter((variant) => !variant.segment.isSelected).length : 0),
    0,
  );
  const overlayBudgets = allocateMapCoordinateBudget(
    Array.from({ length: overlayCount }, () => 2),
    MAX_VARIANT_MAP_GEOJSON_POINTS,
  );
  let overlayIndex = 0;

  for (const variants of groupedSegments) {
    if (variants.length <= 1) continue;
    const reference = variants.find((sw) => sw.segment.isSelected) ?? variants[0];
    for (const sw of variants) {
      if (sw.segment.isSelected) continue;
      const overlay = prepareCollectionVariantPreviewOverlay(
        sw,
        reference,
        pointsByRouteId,
        ferriesByRouteId,
        overlayBudgets[overlayIndex] ?? 0,
      );
      if (!overlay) continue;
      overlaysByKey[collectionVariantKey(sw)] = overlay;
      overlayIndex += 1;
    }
  }

  return overlaysByKey;
}

/**
 * Fetch only variant positions. Raw arrays exist only while their metrics are
 * calculated; returned overlays are bounded GeoJSON ready for Mapbox.
 */
export async function loadCollectionVariantDisplayData(
  segments: CollectionSegmentWithRoute[],
  powerConfig: PowerModelConfig,
  loadRoutePoints: LoadRoutePoints,
  options: LoadCollectionVariantDisplayDataOptions = {},
): Promise<CollectionVariantDisplayData> {
  const metricsByKey: Record<string, CollectionVariantMetric> = {};
  const overlaysByKey: Record<string, CollectionVariantOverlayGeometry> = {};
  const groupedSegments = groupCollectionSegments(segments);
  const overlayCount = groupedSegments.reduce(
    (count, variants) =>
      count +
      (variants.length > 1 ? variants.filter((variant) => !variant.segment.isSelected).length : 0),
    0,
  );
  const overlayBudgets = allocateMapCoordinateBudget(
    Array.from({ length: overlayCount }, () => 2),
    MAX_VARIANT_MAP_GEOJSON_POINTS,
  );
  let overlayIndex = 0;

  for (const variants of groupedSegments) {
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
    const ferriesByRouteId: Record<string, FerryCrossing[]> = {};
    for (const routeId of routeIds) {
      if (options.shouldCancel?.()) return { metricsByKey: {}, overlaysByKey: {} };
      pointsByRouteId[routeId] = await loadRoutePoints(routeId);
      ferriesByRouteId[routeId] = options.loadRouteFerries
        ? await options.loadRouteFerries(routeId)
        : [];
    }

    for (const sw of variants) {
      if (options.shouldCancel?.()) return { metricsByKey: {}, overlaysByKey: {} };
      const points = effectiveVariantPoints(sw, pointsByRouteId);
      if (!points || points.length < 2) continue;
      const ferries = getEffectiveVariantFerries(sw, pointsByRouteId, ferriesByRouteId);
      const ferrySpans = ferries.map((ferry) => ({
        startDistanceMeters: ferry.effectiveStartDistanceMeters,
        endDistanceMeters: ferry.effectiveEndDistanceMeters,
      }));
      metricsByKey[collectionVariantKey(sw)] = {
        distanceMeters: totalRidingDistanceMeters(routeEndDistance(points), ferrySpans),
        ascentMeters: computeRidingElevationTotals(points, ferrySpans).ascent,
        ridingTime: await computeCachedRouteTotalETAInChunks(
          collectionVariantKey(sw),
          points,
          powerConfig,
          {
            shouldCancel: options.shouldCancel,
            ferries,
          },
        ),
      };
    }

    if (options.shouldCancel?.()) return { metricsByKey: {}, overlaysByKey: {} };
    const reference = variants.find((sw) => sw.segment.isSelected) ?? variants[0];
    for (const sw of variants) {
      if (sw.segment.isSelected) continue;
      const overlay = prepareCollectionVariantPreviewOverlay(
        sw,
        reference,
        pointsByRouteId,
        ferriesByRouteId,
        overlayBudgets[overlayIndex] ?? 0,
      );
      if (!overlay) continue;
      overlaysByKey[collectionVariantKey(sw)] = overlay;
      overlayIndex += 1;
    }
  }

  return { metricsByKey, overlaysByKey };
}
