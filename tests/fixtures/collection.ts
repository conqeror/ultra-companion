import { toDisplayDistanceMeters } from "@/services/displayDistance";
import type {
  RoutePoint,
  StitchedCollection,
  StitchedSegmentInfo,
  StitchedSourceSpan,
} from "@/types";

const sourceSpan = (
  routeId: string,
  routeName: string,
  position: number,
  startPointIndex: number,
  endPointIndex: number,
  rawStartDistanceMeters: number,
  rawEndDistanceMeters: number,
  distanceOffsetMeters: number,
): StitchedSourceSpan => ({
  routeId,
  routeName,
  position,
  kind: "full",
  startPointIndex,
  endPointIndex,
  rawStartDistanceMeters,
  rawEndDistanceMeters,
  effectiveStartDistanceMeters: toDisplayDistanceMeters(
    rawStartDistanceMeters + distanceOffsetMeters,
  ),
  effectiveEndDistanceMeters: toDisplayDistanceMeters(rawEndDistanceMeters + distanceOffsetMeters),
  distanceOffsetMeters,
});

export const stitchedSegmentsFixture: StitchedSegmentInfo[] = [
  {
    routeId: "r1",
    routeName: "r1",
    position: 0,
    variantKind: "full",
    baseRouteId: null,
    replaceStartDistanceMeters: null,
    replaceEndDistanceMeters: null,
    startPointIndex: 0,
    endPointIndex: 1,
    distanceOffsetMeters: 0,
    segmentDistanceMeters: 1_000,
    segmentAscentMeters: 100,
    segmentDescentMeters: 0,
    sourceSpans: [sourceSpan("r1", "r1", 0, 0, 1, 0, 1_000, 0)],
  },
  {
    routeId: "r2",
    routeName: "r2",
    position: 1,
    variantKind: "full",
    baseRouteId: null,
    replaceStartDistanceMeters: null,
    replaceEndDistanceMeters: null,
    startPointIndex: 2,
    endPointIndex: 3,
    distanceOffsetMeters: 1_000,
    segmentDistanceMeters: 2_000,
    segmentAscentMeters: 200,
    segmentDescentMeters: 100,
    sourceSpans: [sourceSpan("r2", "r2", 1, 2, 3, 0, 2_000, 1_000)],
  },
];

interface BuildStitchedCollectionOptions {
  collectionId?: string;
  points: RoutePoint[];
  segments?: StitchedSegmentInfo[];
  totalDistanceMeters?: number;
  totalAscentMeters?: number;
  totalDescentMeters?: number;
  pointsByRouteId?: Record<string, RoutePoint[]>;
  sourceSpans?: StitchedSourceSpan[];
}

export function buildStitchedCollection({
  collectionId = "c1",
  points,
  segments = stitchedSegmentsFixture,
  totalDistanceMeters = points[points.length - 1]?.distanceFromStartMeters ?? 0,
  totalAscentMeters = 300,
  totalDescentMeters = 100,
  pointsByRouteId = {},
  sourceSpans = segments.flatMap((segment) => segment.sourceSpans),
}: BuildStitchedCollectionOptions): StitchedCollection {
  return {
    collectionId,
    points,
    segments,
    totalDistanceMeters,
    totalAscentMeters,
    totalDescentMeters,
    pointsByRouteId,
    sourceSpans,
  };
}
