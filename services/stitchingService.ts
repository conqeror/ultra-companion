import { getRouteWithPoints, getCollectionSegments } from "@/db/database";
import {
  findSourceSpanForDistance,
  toDisplayDistanceMeters,
  toDisplayPOI,
} from "@/services/displayDistance";
import { isDistanceInWindow, type DistanceWindow } from "@/utils/ridingHorizon";
import { measureAsync } from "@/utils/perfMarks";
import {
  computeSliceElevationTotalsFromDistance,
  findRouteSegmentCandidates,
  interpolateRoutePointAtDistance,
} from "@/utils/geo";
import type {
  StitchedCollection,
  StitchedSegmentInfo,
  StitchedSourceSpan,
  StitchedSourceSpanKind,
  RoutePoint,
  RouteWithPoints,
  POI,
  DisplayPOI,
  CollectionSegment,
} from "@/types";

interface StitchCollectionOptions {
  /** Keep raw per-segment point arrays in the returned view model. */
  includePointsByRouteId?: boolean;
  /** Stop obsolete long-route work before another source route is retained. */
  shouldCancel?: () => boolean;
}

interface StitchAccumulator {
  collectionId: string;
  includePointsByRouteId: boolean;
  stitchedPoints: RoutePoint[];
  segmentInfos: StitchedSegmentInfo[];
  sourceSpans: StitchedSourceSpan[];
  pointsByRouteId: Record<string, RoutePoint[]>;
  cumulativeDistance: number;
  globalIndex: number;
  totalAscent: number;
  totalDescent: number;
}

export interface PatchVariantProposal {
  baseRouteId: string;
  patchRouteId: string;
  replaceStartDistanceMeters: number;
  replaceEndDistanceMeters: number;
  startEndpointDistanceMeters: number;
  endEndpointDistanceMeters: number;
  isReversed: boolean;
}

const PATCH_ENDPOINT_WARNING_M = 5_000;

class StitchCollectionCancelledError extends Error {
  constructor() {
    super("Collection stitching cancelled");
    this.name = "StitchCollectionCancelledError";
  }
}

function throwIfStitchCancelled(options: StitchCollectionOptions): void {
  if (options.shouldCancel?.()) throw new StitchCollectionCancelledError();
}

export function routeEndDistance(points: RoutePoint[]): number {
  return points[points.length - 1]?.distanceFromStartMeters ?? 0;
}

function clampDistance(points: RoutePoint[], distanceMeters: number): number {
  return Math.max(0, Math.min(routeEndDistance(points), distanceMeters));
}

function pointFromInterpolated(
  point: NonNullable<ReturnType<typeof interpolateRoutePointAtDistance>>,
): RoutePoint {
  return {
    latitude: point.latitude,
    longitude: point.longitude,
    elevationMeters: point.elevationMeters,
    distanceFromStartMeters: point.distanceFromStartMeters,
    idx: point.nearestIndex,
  };
}

export function sliceRoutePointsByDistance(
  points: RoutePoint[],
  startDistanceMeters: number,
  endDistanceMeters: number,
): RoutePoint[] {
  if (points.length === 0) return [];
  const start = clampDistance(points, startDistanceMeters);
  const end = clampDistance(points, endDistanceMeters);
  if (end < start) return [];

  const startPoint = interpolateRoutePointAtDistance(points, start);
  const endPoint = interpolateRoutePointAtDistance(points, end);
  if (!startPoint || !endPoint) return [];

  const out = [pointFromInterpolated(startPoint)];
  for (const point of points) {
    if (point.distanceFromStartMeters > start && point.distanceFromStartMeters < end) {
      out.push(point);
    }
  }
  if (end > start) out.push(pointFromInterpolated(endPoint));
  return out;
}

function appendRebasedRoutePoints(
  out: RoutePoint[],
  points: RoutePoint[],
  rawStartDistanceMeters: number,
  effectiveStartDistanceMeters: number,
) {
  const offset = effectiveStartDistanceMeters - rawStartDistanceMeters;
  for (const point of points) {
    const effectiveDistance = point.distanceFromStartMeters + offset;
    const prev = out[out.length - 1];
    if (prev && Math.abs(prev.distanceFromStartMeters - effectiveDistance) < 0.001) continue;
    out.push({
      ...point,
      idx: out.length,
      distanceFromStartMeters: effectiveDistance,
    });
  }
}

export function buildPatchVariantRoutePoints(
  basePoints: RoutePoint[],
  patchPoints: RoutePoint[],
  replaceStartDistanceMeters: number,
  replaceEndDistanceMeters: number,
): RoutePoint[] {
  if (basePoints.length < 2 || patchPoints.length < 2) return [];

  const out: RoutePoint[] = [];
  const baseEnd = routeEndDistance(basePoints);
  const patchEnd = routeEndDistance(patchPoints);
  const basePrefix = sliceRoutePointsByDistance(basePoints, 0, replaceStartDistanceMeters);
  const baseSuffix = sliceRoutePointsByDistance(basePoints, replaceEndDistanceMeters, baseEnd);

  appendRebasedRoutePoints(out, basePrefix, 0, 0);
  appendRebasedRoutePoints(out, patchPoints, 0, replaceStartDistanceMeters);
  appendRebasedRoutePoints(
    out,
    baseSuffix,
    replaceEndDistanceMeters,
    replaceStartDistanceMeters + patchEnd,
  );
  return out;
}

interface AppendRouteSliceOptions {
  route: RouteWithPoints;
  position: number;
  kind: StitchedSourceSpanKind;
  rawStartDistanceMeters: number;
  rawEndDistanceMeters: number;
  effectiveStartDistanceMeters: number;
  stitchedPoints: RoutePoint[];
  globalIndex: number;
}

function appendRouteSlice({
  route,
  position,
  kind,
  rawStartDistanceMeters,
  rawEndDistanceMeters,
  effectiveStartDistanceMeters,
  stitchedPoints,
  globalIndex,
}: AppendRouteSliceOptions): {
  span: StitchedSourceSpan | null;
  globalIndex: number;
  distanceMeters: number;
  ascentMeters: number;
  descentMeters: number;
} {
  const rawStart = clampDistance(route.points, rawStartDistanceMeters);
  const rawEnd = clampDistance(route.points, rawEndDistanceMeters);
  if (rawEnd <= rawStart) {
    return { span: null, globalIndex, distanceMeters: 0, ascentMeters: 0, descentMeters: 0 };
  }

  const startPoint = interpolateRoutePointAtDistance(route.points, rawStart);
  const endPoint = interpolateRoutePointAtDistance(route.points, rawEnd);
  if (!startPoint || !endPoint) {
    return { span: null, globalIndex, distanceMeters: 0, ascentMeters: 0, descentMeters: 0 };
  }

  const startPointIndex = globalIndex;
  const offset = effectiveStartDistanceMeters - rawStart;
  const appendPoint = (pt: {
    latitude: number;
    longitude: number;
    elevationMeters: number | null;
    distanceFromStartMeters: number;
  }) => {
    stitchedPoints.push({
      latitude: pt.latitude,
      longitude: pt.longitude,
      elevationMeters: pt.elevationMeters,
      distanceFromStartMeters: pt.distanceFromStartMeters + offset,
      idx: globalIndex,
    });
    globalIndex++;
  };

  appendPoint(startPoint);
  for (const point of route.points) {
    if (point.distanceFromStartMeters > rawStart && point.distanceFromStartMeters < rawEnd) {
      appendPoint(point);
    }
  }
  if (rawEnd > rawStart) appendPoint(endPoint);

  const effectiveEnd = rawEnd + offset;
  const isWholeRoute = rawStart === 0 && rawEnd === route.totalDistanceMeters;
  const elevationTotals = isWholeRoute
    ? { ascent: route.totalAscentMeters, descent: route.totalDescentMeters }
    : computeSliceElevationTotalsFromDistance(route.points, rawStart, rawEnd);

  return {
    span: {
      routeId: route.id,
      routeName: route.name,
      position,
      kind,
      startPointIndex,
      endPointIndex: globalIndex - 1,
      rawStartDistanceMeters: rawStart,
      rawEndDistanceMeters: rawEnd,
      effectiveStartDistanceMeters: toDisplayDistanceMeters(effectiveStartDistanceMeters),
      effectiveEndDistanceMeters: toDisplayDistanceMeters(effectiveEnd),
      distanceOffsetMeters: offset,
    },
    globalIndex,
    distanceMeters: rawEnd - rawStart,
    ascentMeters: elevationTotals.ascent,
    descentMeters: elevationTotals.descent,
  };
}

function buildFallbackSegmentInfo(
  segment: CollectionSegment,
  route: RouteWithPoints,
  startPointIndex: number,
  endPointIndex: number,
  distanceOffsetMeters: number,
  sourceSpans: StitchedSourceSpan[],
  segmentDistanceMeters: number,
  segmentAscentMeters: number,
  segmentDescentMeters: number,
): StitchedSegmentInfo {
  return {
    routeId: route.id,
    routeName: route.name,
    position: segment.position,
    variantKind: segment.variantKind,
    baseRouteId: segment.baseRouteId,
    replaceStartDistanceMeters: segment.replaceStartDistanceMeters,
    replaceEndDistanceMeters: segment.replaceEndDistanceMeters,
    startPointIndex,
    endPointIndex,
    distanceOffsetMeters,
    segmentDistanceMeters,
    segmentAscentMeters,
    segmentDescentMeters,
    sourceSpans,
  };
}

function createStitchAccumulator(
  collectionId: string,
  options: StitchCollectionOptions,
): StitchAccumulator {
  return {
    collectionId,
    includePointsByRouteId: options.includePointsByRouteId ?? true,
    stitchedPoints: [],
    segmentInfos: [],
    sourceSpans: [],
    pointsByRouteId: {},
    cumulativeDistance: 0,
    globalIndex: 0,
    totalAscent: 0,
    totalDescent: 0,
  };
}

function appendSegmentToStitch(
  accumulator: StitchAccumulator,
  segment: CollectionSegment,
  route: RouteWithPoints,
  baseRoute?: RouteWithPoints,
): void {
  const { includePointsByRouteId, stitchedPoints, segmentInfos, sourceSpans, pointsByRouteId } =
    accumulator;

  if (includePointsByRouteId) {
    pointsByRouteId[route.id] = route.points;
  }
  const startPointIndex = accumulator.globalIndex;
  const segmentOffset = accumulator.cumulativeDistance;
  const segmentSourceSpans: StitchedSourceSpan[] = [];
  let segmentDistance = 0;
  let segmentAscent = 0;
  let segmentDescent = 0;

  if (
    segment.variantKind === "patch" &&
    segment.baseRouteId &&
    segment.replaceStartDistanceMeters != null &&
    segment.replaceEndDistanceMeters != null &&
    baseRoute
  ) {
    const replaceStart = segment.replaceStartDistanceMeters;
    const replaceEnd = segment.replaceEndDistanceMeters;
    if (includePointsByRouteId) {
      pointsByRouteId[baseRoute.id] = baseRoute.points;
    }
    const pieces = [
      {
        route: baseRoute,
        kind: "base-prefix" as const,
        rawStartDistanceMeters: 0,
        rawEndDistanceMeters: replaceStart,
        effectiveStartDistanceMeters: accumulator.cumulativeDistance,
      },
      {
        route,
        kind: "patch" as const,
        rawStartDistanceMeters: 0,
        rawEndDistanceMeters: route.totalDistanceMeters,
        effectiveStartDistanceMeters: accumulator.cumulativeDistance + replaceStart,
      },
      {
        route: baseRoute,
        kind: "base-suffix" as const,
        rawStartDistanceMeters: replaceEnd,
        rawEndDistanceMeters: baseRoute.totalDistanceMeters,
        effectiveStartDistanceMeters:
          accumulator.cumulativeDistance + replaceStart + route.totalDistanceMeters,
      },
    ];

    for (const piece of pieces) {
      const result = appendRouteSlice({
        ...piece,
        position: segment.position,
        stitchedPoints,
        globalIndex: accumulator.globalIndex,
      });
      accumulator.globalIndex = result.globalIndex;
      if (result.span) {
        segmentSourceSpans.push(result.span);
        sourceSpans.push(result.span);
      }
      segmentDistance += result.distanceMeters;
      segmentAscent += result.ascentMeters;
      segmentDescent += result.descentMeters;
    }
  }

  if (segmentSourceSpans.length === 0) {
    const result = appendRouteSlice({
      route,
      position: segment.position,
      kind: "full",
      rawStartDistanceMeters: 0,
      rawEndDistanceMeters: route.totalDistanceMeters,
      effectiveStartDistanceMeters: accumulator.cumulativeDistance,
      stitchedPoints,
      globalIndex: accumulator.globalIndex,
    });
    accumulator.globalIndex = result.globalIndex;
    if (result.span) {
      segmentSourceSpans.push(result.span);
      sourceSpans.push(result.span);
    }
    segmentDistance = result.distanceMeters;
    segmentAscent = result.ascentMeters;
    segmentDescent = result.descentMeters;
  }

  const endPointIndex = accumulator.globalIndex - 1;

  segmentInfos.push(
    buildFallbackSegmentInfo(
      segment,
      route,
      startPointIndex,
      endPointIndex,
      segmentOffset,
      segmentSourceSpans,
      segmentDistance,
      segmentAscent,
      segmentDescent,
    ),
  );

  accumulator.cumulativeDistance += segmentDistance;
  accumulator.totalAscent += segmentAscent;
  accumulator.totalDescent += segmentDescent;
}

function finishStitch(accumulator: StitchAccumulator): StitchedCollection {
  return {
    collectionId: accumulator.collectionId,
    points: accumulator.stitchedPoints,
    segments: accumulator.segmentInfos,
    totalDistanceMeters: accumulator.cumulativeDistance,
    totalAscentMeters: accumulator.totalAscent,
    totalDescentMeters: accumulator.totalDescent,
    pointsByRouteId: accumulator.pointsByRouteId,
    sourceSpans: accumulator.sourceSpans,
  };
}

export function stitchCollectionFromData(
  collectionId: string,
  allSegments: CollectionSegment[],
  routesById: Record<string, RouteWithPoints | undefined>,
  options: StitchCollectionOptions = {},
): StitchedCollection {
  const selected = allSegments.filter((s) => s.isSelected);
  selected.sort((a, b) => a.position - b.position);
  const accumulator = createStitchAccumulator(collectionId, options);

  for (const segment of selected) {
    const route = routesById[segment.routeId];
    if (!route) continue;
    const baseRoute = segment.baseRouteId ? routesById[segment.baseRouteId] : undefined;
    appendSegmentToStitch(accumulator, segment, route, baseRoute);
  }

  return finishStitch(accumulator);
}

async function loadAndAppendSegment(
  accumulator: StitchAccumulator,
  segment: CollectionSegment,
  options: StitchCollectionOptions,
): Promise<void> {
  throwIfStitchCancelled(options);
  const route = await getRouteWithPoints(segment.routeId);
  throwIfStitchCancelled(options);
  if (!route) return;

  const baseRoute =
    segment.variantKind === "patch" &&
    segment.baseRouteId &&
    segment.replaceStartDistanceMeters != null &&
    segment.replaceEndDistanceMeters != null
      ? ((await getRouteWithPoints(segment.baseRouteId)) ?? undefined)
      : undefined;

  throwIfStitchCancelled(options);
  appendSegmentToStitch(accumulator, segment, route, baseRoute);
}

async function stitchCollectionSequentially(
  collectionId: string,
  allSegments: CollectionSegment[],
  options: StitchCollectionOptions,
): Promise<StitchedCollection> {
  const selected = allSegments.filter((segment) => segment.isSelected);
  selected.sort((a, b) => a.position - b.position);
  const accumulator = createStitchAccumulator(collectionId, options);

  for (const segment of selected) {
    // Keep at most the current segment's route (and its patch base) alive. The
    // accumulator only stores cloned stitched points when raw arrays are not
    // requested, so completed source arrays can be reclaimed before the next
    // native query resolves.
    await loadAndAppendSegment(accumulator, segment, options);
  }

  throwIfStitchCancelled(options);
  return finishStitch(accumulator);
}

export async function stitchCollection(
  collectionId: string,
  options: StitchCollectionOptions = {},
): Promise<StitchedCollection> {
  throwIfStitchCancelled(options);
  const allSegments = await getCollectionSegments(collectionId);
  throwIfStitchCancelled(options);

  if (options.includePointsByRouteId === false) {
    return measureAsync("collection.stitch.active", () =>
      stitchCollectionSequentially(collectionId, allSegments, options),
    );
  }

  const selected = allSegments.filter((s) => s.isSelected);
  const routeIds = new Set<string>();

  for (const segment of selected) {
    routeIds.add(segment.routeId);
    if (segment.variantKind === "patch" && segment.baseRouteId) {
      routeIds.add(segment.baseRouteId);
    }
  }

  const routesById: Record<string, RouteWithPoints | undefined> = {};
  await Promise.all(
    [...routeIds].map(async (routeId) => {
      routesById[routeId] = (await getRouteWithPoints(routeId)) ?? undefined;
    }),
  );

  throwIfStitchCancelled(options);
  return stitchCollectionFromData(collectionId, allSegments, routesById, options);
}

export function stitchPOIs(
  segments: StitchedSegmentInfo[],
  poisByRoute: Record<string, POI[]>,
  window?: DistanceWindow,
): DisplayPOI[] {
  const combined: DisplayPOI[] = [];
  const sourceSpans = segments.flatMap((seg) => seg.sourceSpans);

  for (const span of sourceSpans) {
    const pois = poisByRoute[span.routeId];
    if (!pois) continue;

    for (const poi of pois) {
      const sourceSpan = findSourceSpanForDistance(
        [span],
        poi.routeId,
        poi.distanceAlongRouteMeters,
      );
      if (!sourceSpan) continue;
      const effectiveDistanceMeters =
        poi.distanceAlongRouteMeters + sourceSpan.distanceOffsetMeters;
      if (!isDistanceInWindow(effectiveDistanceMeters, window)) continue;
      combined.push(toDisplayPOI(poi, sourceSpan.distanceOffsetMeters));
    }
  }

  combined.sort((a, b) => a.effectiveDistanceMeters - b.effectiveDistanceMeters);
  return combined;
}

export function proposePatchVariantFromPoints(
  baseRouteId: string,
  patchRouteId: string,
  basePoints: RoutePoint[],
  patchPoints: RoutePoint[],
): PatchVariantProposal | null {
  if (basePoints.length < 2 || patchPoints.length < 2) return null;
  const patchStart = patchPoints[0];
  const patchEnd = patchPoints[patchPoints.length - 1];
  const start = findRouteSegmentCandidates(patchStart.latitude, patchStart.longitude, basePoints, {
    maxCandidates: 1,
  })[0];
  const end = findRouteSegmentCandidates(patchEnd.latitude, patchEnd.longitude, basePoints, {
    maxCandidates: 1,
  })[0];
  if (!start || !end) return null;

  const isReversed = start.distanceAlongRouteMeters > end.distanceAlongRouteMeters;
  const replaceStartDistanceMeters = Math.min(
    start.distanceAlongRouteMeters,
    end.distanceAlongRouteMeters,
  );
  const replaceEndDistanceMeters = Math.max(
    start.distanceAlongRouteMeters,
    end.distanceAlongRouteMeters,
  );

  if (replaceEndDistanceMeters <= replaceStartDistanceMeters) return null;

  return {
    baseRouteId,
    patchRouteId,
    replaceStartDistanceMeters,
    replaceEndDistanceMeters,
    startEndpointDistanceMeters: start.distanceMeters,
    endEndpointDistanceMeters: end.distanceMeters,
    isReversed,
  };
}

export function isPatchVariantProposalPoorMatch(proposal: PatchVariantProposal): boolean {
  return (
    proposal.isReversed ||
    proposal.startEndpointDistanceMeters > PATCH_ENDPOINT_WARNING_M ||
    proposal.endEndpointDistanceMeters > PATCH_ENDPOINT_WARNING_M
  );
}

export function getStitchedSourceRouteIds(segments: StitchedSegmentInfo[]): string[] {
  const ids = new Set<string>();
  for (const segment of segments) {
    for (const span of segment.sourceSpans) {
      ids.add(span.routeId);
    }
  }
  return [...ids];
}
