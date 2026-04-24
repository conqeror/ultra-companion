import type { RoutePoint, StitchedCollection, StitchedSegmentInfo } from "@/types";

export const stitchedSegmentsFixture: StitchedSegmentInfo[] = [
  {
    routeId: "r1",
    routeName: "r1",
    position: 0,
    startPointIndex: 0,
    endPointIndex: 1,
    distanceOffsetMeters: 0,
    segmentDistanceMeters: 1_000,
    segmentAscentMeters: 100,
    segmentDescentMeters: 0,
  },
  {
    routeId: "r2",
    routeName: "r2",
    position: 1,
    startPointIndex: 2,
    endPointIndex: 3,
    distanceOffsetMeters: 1_000,
    segmentDistanceMeters: 2_000,
    segmentAscentMeters: 200,
    segmentDescentMeters: 100,
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
}

export function buildStitchedCollection({
  collectionId = "c1",
  points,
  segments = stitchedSegmentsFixture,
  totalDistanceMeters = points[points.length - 1]?.distanceFromStartMeters ?? 0,
  totalAscentMeters = 300,
  totalDescentMeters = 100,
  pointsByRouteId = {},
}: BuildStitchedCollectionOptions): StitchedCollection {
  return {
    collectionId,
    points,
    segments,
    totalDistanceMeters,
    totalAscentMeters,
    totalDescentMeters,
    pointsByRouteId,
  };
}
