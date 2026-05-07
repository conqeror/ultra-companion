import { getRouteWithPoints, getCollectionSegments } from "@/db/database";
import {
  findSourceSpanForDistance,
  toDisplayDistanceMeters,
  toDisplayPOI,
} from "@/services/displayDistance";
import { isDistanceInWindow, type DistanceWindow } from "@/utils/ridingHorizon";
import {
  computeSliceAscentFromDistance,
  computeSliceDescentFromDistance,
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

  const rawSlice = sliceRoutePointsByDistance(route.points, rawStart, rawEnd);
  if (rawSlice.length === 0) {
    return { span: null, globalIndex, distanceMeters: 0, ascentMeters: 0, descentMeters: 0 };
  }

  const startPointIndex = globalIndex;
  const offset = effectiveStartDistanceMeters - rawStart;
  for (const pt of rawSlice) {
    stitchedPoints.push({
      latitude: pt.latitude,
      longitude: pt.longitude,
      elevationMeters: pt.elevationMeters,
      distanceFromStartMeters: pt.distanceFromStartMeters + offset,
      idx: globalIndex,
    });
    globalIndex++;
  }

  const effectiveEnd = rawEnd + offset;
  const isWholeRoute = rawStart === 0 && rawEnd === route.totalDistanceMeters;
  const ascentMeters = isWholeRoute
    ? route.totalAscentMeters
    : computeSliceAscentFromDistance(route.points, rawStart, rawEnd);
  const descentMeters = isWholeRoute
    ? route.totalDescentMeters
    : computeSliceDescentFromDistance(route.points, rawStart, rawEnd);

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
    ascentMeters,
    descentMeters,
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

export async function stitchCollection(
  collectionId: string,
  options: StitchCollectionOptions = {},
): Promise<StitchedCollection> {
  const allSegments = await getCollectionSegments(collectionId);
  const selected = allSegments.filter((s) => s.isSelected);
  selected.sort((a, b) => a.position - b.position);

  const stitchedPoints: RoutePoint[] = [];
  const segmentInfos: StitchedSegmentInfo[] = [];
  const sourceSpans: StitchedSourceSpan[] = [];
  const pointsByRouteId: Record<string, RoutePoint[]> = {};
  let cumulativeDistance = 0;
  let globalIndex = 0;
  let totalAscent = 0;
  let totalDescent = 0;

  for (let i = 0; i < selected.length; i++) {
    const segment = selected[i];
    const route = await getRouteWithPoints(segment.routeId);
    if (!route) continue;

    if (options.includePointsByRouteId ?? true) {
      pointsByRouteId[route.id] = route.points;
    }
    const startPointIndex = globalIndex;
    const segmentOffset = cumulativeDistance;
    const segmentSourceSpans: StitchedSourceSpan[] = [];
    let segmentDistance = 0;
    let segmentAscent = 0;
    let segmentDescent = 0;

    if (
      segment.variantKind === "patch" &&
      segment.baseRouteId &&
      segment.replaceStartDistanceMeters != null &&
      segment.replaceEndDistanceMeters != null
    ) {
      const baseRouteId = segment.baseRouteId;
      const replaceStart = segment.replaceStartDistanceMeters;
      const replaceEnd = segment.replaceEndDistanceMeters;
      const baseRoute = await getRouteWithPoints(baseRouteId);
      if (baseRoute) {
        if (options.includePointsByRouteId ?? true) {
          pointsByRouteId[baseRoute.id] = baseRoute.points;
        }
        const pieces = [
          {
            route: baseRoute,
            kind: "base-prefix" as const,
            rawStartDistanceMeters: 0,
            rawEndDistanceMeters: replaceStart,
            effectiveStartDistanceMeters: cumulativeDistance,
          },
          {
            route,
            kind: "patch" as const,
            rawStartDistanceMeters: 0,
            rawEndDistanceMeters: route.totalDistanceMeters,
            effectiveStartDistanceMeters: cumulativeDistance + replaceStart,
          },
          {
            route: baseRoute,
            kind: "base-suffix" as const,
            rawStartDistanceMeters: replaceEnd,
            rawEndDistanceMeters: baseRoute.totalDistanceMeters,
            effectiveStartDistanceMeters:
              cumulativeDistance + replaceStart + route.totalDistanceMeters,
          },
        ];

        for (const piece of pieces) {
          const result = appendRouteSlice({
            ...piece,
            position: segment.position,
            stitchedPoints,
            globalIndex,
          });
          globalIndex = result.globalIndex;
          if (result.span) {
            segmentSourceSpans.push(result.span);
            sourceSpans.push(result.span);
          }
          segmentDistance += result.distanceMeters;
          segmentAscent += result.ascentMeters;
          segmentDescent += result.descentMeters;
        }
      }
    }

    if (segmentSourceSpans.length === 0) {
      const result = appendRouteSlice({
        route,
        position: segment.position,
        kind: "full",
        rawStartDistanceMeters: 0,
        rawEndDistanceMeters: route.totalDistanceMeters,
        effectiveStartDistanceMeters: cumulativeDistance,
        stitchedPoints,
        globalIndex,
      });
      globalIndex = result.globalIndex;
      if (result.span) {
        segmentSourceSpans.push(result.span);
        sourceSpans.push(result.span);
      }
      segmentDistance = result.distanceMeters;
      segmentAscent = result.ascentMeters;
      segmentDescent = result.descentMeters;
    }

    const endPointIndex = globalIndex - 1;

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

    cumulativeDistance += segmentDistance;
    totalAscent += segmentAscent;
    totalDescent += segmentDescent;
  }

  return {
    collectionId,
    points: stitchedPoints,
    segments: segmentInfos,
    totalDistanceMeters: cumulativeDistance,
    totalAscentMeters: totalAscent,
    totalDescentMeters: totalDescent,
    pointsByRouteId,
    sourceSpans,
  };
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
