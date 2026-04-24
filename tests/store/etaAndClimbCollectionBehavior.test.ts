import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Climb, POI, RoutePoint, StitchedCollection, StitchedSegmentInfo } from "@/types";

const {
  mockComputeRouteETA,
  mockRouteState,
  mockCollectionState,
  mockPoiState,
  mockGetClimbsForRoute,
  mockUpdateClimbName,
} = vi.hoisted(() => ({
  mockComputeRouteETA: vi.fn<(points: RoutePoint[]) => number[]>(),
  mockRouteState: {
    snappedPosition: null as { pointIndex: number } | null,
    visibleRoutePoints: {} as Record<string, RoutePoint[]>,
  },
  mockCollectionState: {
    activeStitchedCollection: null as StitchedCollection | null,
  },
  mockPoiState: {
    pois: {} as Record<string, POI[]>,
  },
  mockGetClimbsForRoute: vi.fn(),
  mockUpdateClimbName: vi.fn(),
}));

vi.mock("react-native-mmkv", () => ({
  createMMKV: () => ({
    getString: () => null,
    set: vi.fn(),
  }),
}));

vi.mock("@/services/etaCalculator", async () => {
  const actual = await vi.importActual<typeof import("@/services/etaCalculator")>(
    "@/services/etaCalculator",
  );
  return {
    ...actual,
    computeRouteETA: mockComputeRouteETA,
  };
});

vi.mock("@/store/routeStore", () => ({
  useRouteStore: {
    getState: () => mockRouteState,
  },
}));

vi.mock("@/store/collectionStore", () => ({
  useCollectionStore: {
    getState: () => mockCollectionState,
  },
}));

vi.mock("@/store/poiStore", () => ({
  usePoiStore: {
    getState: () => mockPoiState,
  },
}));

vi.mock("@/db/database", () => ({
  getClimbsForRoute: mockGetClimbsForRoute,
  updateClimbName: mockUpdateClimbName,
}));

import { useEtaStore } from "@/store/etaStore";
import { useClimbStore } from "@/store/climbStore";

const point = (distanceFromStartMeters: number, idx: number): RoutePoint => ({
  latitude: 0,
  longitude: idx,
  elevationMeters: 100,
  distanceFromStartMeters,
  idx,
});

const rawPoi = (id: string, routeId: string, distanceAlongRouteMeters: number): POI => ({
  id,
  sourceId: id,
  source: "osm",
  name: id,
  category: "water",
  latitude: 0,
  longitude: 0,
  tags: {},
  distanceFromRouteMeters: 0,
  distanceAlongRouteMeters,
  routeId,
});

const climb = (
  id: string,
  routeId: string,
  startDistanceMeters: number,
  endDistanceMeters: number,
): Climb => ({
  id,
  routeId,
  name: id,
  startDistanceMeters,
  endDistanceMeters,
  lengthMeters: endDistanceMeters - startDistanceMeters,
  totalAscentMeters: 120,
  startElevationMeters: 100,
  endElevationMeters: 220,
  averageGradientPercent: 7,
  maxGradientPercent: 10,
  difficultyScore: 100,
});

const segments: StitchedSegmentInfo[] = [
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

describe("stitched collection coordinate behavior", () => {
  beforeEach(() => {
    useEtaStore.setState({
      cumulativeTime: null,
      routeId: null,
      cachedPoints: null,
    });
    useClimbStore.setState({
      climbs: {},
      selectedClimb: null,
      currentClimbId: null,
      isClimbZoomed: false,
    });
    mockRouteState.snappedPosition = null;
    mockRouteState.visibleRoutePoints = {};
    mockCollectionState.activeStitchedCollection = null;
    mockPoiState.pois = {};
    mockComputeRouteETA.mockReset();
  });

  it("applies segment offsets for POI ETA and supports segment 0 and later segments", () => {
    const stitchedPoints = [point(0, 0), point(1_000, 1), point(2_000, 2), point(3_000, 3)];

    useEtaStore.setState({
      routeId: "c1",
      cumulativeTime: [0, 100, 200, 300],
      cachedPoints: stitchedPoints,
    });

    mockRouteState.snappedPosition = { pointIndex: 0 };
    mockRouteState.visibleRoutePoints = { c1: stitchedPoints };
    mockCollectionState.activeStitchedCollection = {
      collectionId: "c1",
      points: stitchedPoints,
      segments,
      totalDistanceMeters: 3_000,
      totalAscentMeters: 300,
      totalDescentMeters: 100,
      pointsByRouteId: {},
    };

    const etaSegment0 = useEtaStore.getState().getETAToPOI(rawPoi("p0", "r1", 900));
    const etaSegment1 = useEtaStore.getState().getETAToPOI(rawPoi("p1", "r2", 200));

    expect(etaSegment0?.ridingTimeSeconds).toBe(90);
    expect(etaSegment1?.ridingTimeSeconds).toBe(120);
  });

  it("uses canonical raw POI distance so pre-stitched POIs are not double-offset", () => {
    const stitchedPoints = [point(0, 0), point(1_000, 1), point(2_000, 2), point(3_000, 3)];

    useEtaStore.setState({
      routeId: "c1",
      cumulativeTime: [0, 100, 200, 300],
      cachedPoints: stitchedPoints,
    });

    mockRouteState.snappedPosition = { pointIndex: 0 };
    mockRouteState.visibleRoutePoints = { c1: stitchedPoints };
    mockCollectionState.activeStitchedCollection = {
      collectionId: "c1",
      points: stitchedPoints,
      segments,
      totalDistanceMeters: 3_000,
      totalAscentMeters: 300,
      totalDescentMeters: 100,
      pointsByRouteId: {},
    };
    mockPoiState.pois = {
      r2: [rawPoi("poi-late", "r2", 200)],
    };

    const preStitched = rawPoi("poi-late", "r2", 1_200);
    const eta = useEtaStore.getState().getETAToPOI(preStitched);

    expect(eta?.ridingTimeSeconds).toBe(120);
  });

  it("recomputes ETA cache when collection variant swaps points array with same route id", () => {
    const pointsA = [point(0, 0), point(1_000, 1)];
    const pointsB = [point(0, 0), point(1_200, 1)];
    mockComputeRouteETA.mockReturnValueOnce([0, 100]).mockReturnValueOnce([0, 140]);

    useEtaStore.getState().computeETAForRoute("collection-1", pointsA);
    useEtaStore.getState().computeETAForRoute("collection-1", pointsA);
    useEtaStore.getState().computeETAForRoute("collection-1", pointsB);

    expect(mockComputeRouteETA).toHaveBeenCalledTimes(2);
    expect(useEtaStore.getState().cumulativeTime).toEqual([0, 140]);
    expect(useEtaStore.getState().cachedPoints).toBe(pointsB);
  });

  it("offsets climb display coordinates for stitched segments and sorts by stitched distance", () => {
    useClimbStore.setState({
      climbs: {
        r1: [climb("c1", "r1", 700, 900)],
        r2: [climb("c2", "r2", 100, 400)],
      },
    });

    const display = useClimbStore.getState().getClimbsForDisplay(["r1", "r2"], segments);

    expect(display.map((c) => [c.id, c.startDistanceMeters, c.endDistanceMeters])).toEqual([
      ["c1", 700, 900],
      ["c2", 1_100, 1_400],
    ]);
  });
});
