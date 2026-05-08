import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildClimb } from "@/tests/fixtures/climb";
import { buildStitchedCollection, stitchedSegmentsFixture } from "@/tests/fixtures/collection";
import { buildPoi } from "@/tests/fixtures/poi";
import { buildRoutePoint } from "@/tests/fixtures/route";
import { createStitchedCollectionHarness } from "@/tests/helpers/stitchedCollectionHarness";
import { etaCalculatorMocks } from "@/tests/mocks/etaCalculator";
import { toDisplayDistanceMeters, toDisplayPOI } from "@/services/displayDistance";
import type { StitchedSegmentInfo } from "@/types";

const stitchedHarness = createStitchedCollectionHarness();

vi.mock("@/services/etaCalculator", async () => {
  const actual = await vi.importActual<typeof import("@/services/etaCalculator")>(
    "@/services/etaCalculator",
  );
  return {
    ...actual,
    computeRouteETA: etaCalculatorMocks.computeRouteETA,
  };
});

vi.mock("@/store/routeStore", () => ({
  useRouteStore: {
    getState: () => stitchedHarness.routeState,
  },
}));

vi.mock("@/store/collectionStore", () => ({
  useCollectionStore: {
    getState: () => stitchedHarness.collectionState,
  },
}));

vi.mock("@/store/poiStore", () => ({
  usePoiStore: {
    getState: () => stitchedHarness.poiState,
  },
}));

import { useEtaStore } from "@/store/etaStore";
import { useClimbStore } from "@/store/climbStore";

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
    });
    stitchedHarness.reset();
    etaCalculatorMocks.computeRouteETA.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("applies segment offsets for POI ETA and supports segment 0 and later segments", () => {
    const stitchedPoints = [
      buildRoutePoint(0, 0),
      buildRoutePoint(1_000, 1),
      buildRoutePoint(2_000, 2),
      buildRoutePoint(3_000, 3),
    ];

    useEtaStore.setState({
      routeId: "c1",
      cumulativeTime: [0, 100, 200, 300],
      cachedPoints: stitchedPoints,
    });

    stitchedHarness.routeState.snappedPosition = {
      routeId: "c1",
      pointIndex: 0,
      distanceAlongRouteMeters: 0,
      distanceFromRouteMeters: 0,
    };
    stitchedHarness.routeState.visibleRoutePoints = { c1: stitchedPoints };
    stitchedHarness.collectionState.activeStitchedCollection = buildStitchedCollection({
      points: stitchedPoints,
    });

    const etaSegment0 = useEtaStore.getState().getETAToPOI(toDisplayPOI(buildPoi("p0", "r1", 900)));
    const etaSegment1 = useEtaStore.getState().getETAToPOI(toDisplayPOI(buildPoi("p1", "r2", 200)));

    expect(etaSegment0?.ridingTimeSeconds).toBe(90);
    expect(etaSegment1?.ridingTimeSeconds).toBe(120);
  });

  it("uses canonical raw POI distance so pre-stitched POIs are not double-offset", () => {
    const stitchedPoints = [
      buildRoutePoint(0, 0),
      buildRoutePoint(1_000, 1),
      buildRoutePoint(2_000, 2),
      buildRoutePoint(3_000, 3),
    ];

    useEtaStore.setState({
      routeId: "c1",
      cumulativeTime: [0, 100, 200, 300],
      cachedPoints: stitchedPoints,
    });

    stitchedHarness.routeState.snappedPosition = {
      routeId: "c1",
      pointIndex: 0,
      distanceAlongRouteMeters: 0,
      distanceFromRouteMeters: 0,
    };
    stitchedHarness.routeState.visibleRoutePoints = { c1: stitchedPoints };
    stitchedHarness.collectionState.activeStitchedCollection = buildStitchedCollection({
      points: stitchedPoints,
    });
    stitchedHarness.poiState.pois = {
      r2: [buildPoi("poi-late", "r2", 200)],
    };

    const preStitched = toDisplayPOI(buildPoi("poi-late", "r2", 200), 1_000);
    const eta = useEtaStore.getState().getETAToPOI(preStitched);

    expect(eta?.ridingTimeSeconds).toBe(120);
  });

  it("uses projected snapped distance rather than point index for POI ETA", () => {
    const stitchedPoints = [
      buildRoutePoint(0, 0),
      buildRoutePoint(1_000, 1),
      buildRoutePoint(2_000, 2),
    ];

    useEtaStore.setState({
      routeId: "c1",
      cumulativeTime: [0, 100, 200],
      cachedPoints: stitchedPoints,
    });

    stitchedHarness.routeState.snappedPosition = {
      routeId: "c1",
      pointIndex: 0,
      distanceAlongRouteMeters: 250,
      distanceFromRouteMeters: 0,
    };
    stitchedHarness.routeState.visibleRoutePoints = { c1: stitchedPoints };
    stitchedHarness.collectionState.activeStitchedCollection = buildStitchedCollection({
      points: stitchedPoints,
    });

    const eta = useEtaStore.getState().getETAToPOI(toDisplayPOI(buildPoi("p0", "r1", 900)));

    expect(eta?.distanceMeters).toBe(650);
    expect(eta?.ridingTimeSeconds).toBe(65);
  });

  it("uses collection planned start as ETA base and route start before the race starts", () => {
    const stitchedPoints = [
      buildRoutePoint(0, 0),
      buildRoutePoint(1_000, 1),
      buildRoutePoint(2_000, 2),
    ];
    const plannedStartMs = new Date("2026-01-01T06:00:00.000Z").getTime();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T05:00:00.000Z"));

    useEtaStore.setState({
      routeId: "c1",
      cumulativeTime: [0, 100, 200],
      cachedPoints: stitchedPoints,
    });

    stitchedHarness.routeState.snappedPosition = {
      routeId: "c1",
      pointIndex: 0,
      distanceAlongRouteMeters: 700,
      distanceFromRouteMeters: 0,
    };
    stitchedHarness.routeState.visibleRoutePoints = { c1: stitchedPoints };
    stitchedHarness.collectionState.collections = [
      {
        id: "c1",
        name: "Race",
        isActive: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        plannedStartMs,
      },
    ];
    stitchedHarness.collectionState.activeStitchedCollection = buildStitchedCollection({
      points: stitchedPoints,
    });

    const eta = useEtaStore.getState().getETAToPOI(toDisplayPOI(buildPoi("p0", "r1", 900)));

    expect(eta?.distanceMeters).toBe(900);
    expect(eta?.ridingTimeSeconds).toBe(90);
    expect(eta?.eta.toISOString()).toBe("2026-01-01T06:01:30.000Z");
  });

  it("does not resolve ETA from stale snap progress for another route", () => {
    const stitchedPoints = [
      buildRoutePoint(0, 0),
      buildRoutePoint(1_000, 1),
      buildRoutePoint(2_000, 2),
    ];

    useEtaStore.setState({
      routeId: "c1",
      cumulativeTime: [0, 100, 200],
      cachedPoints: stitchedPoints,
    });

    stitchedHarness.routeState.snappedPosition = {
      routeId: "old-route",
      pointIndex: 0,
      distanceAlongRouteMeters: 250,
      distanceFromRouteMeters: 0,
    };
    stitchedHarness.routeState.visibleRoutePoints = { c1: stitchedPoints };

    const eta = useEtaStore.getState().getETAToPOI(toDisplayPOI(buildPoi("p0", "r1", 900)));

    expect(eta).toBeNull();
  });

  it("recomputes ETA cache when collection variant swaps points array with same route id", () => {
    const pointsA = [buildRoutePoint(0, 0), buildRoutePoint(1_000, 1)];
    const pointsB = [buildRoutePoint(0, 0), buildRoutePoint(1_200, 1)];

    useEtaStore.getState().computeETAForRoute("collection-1", pointsA);
    const cumulativeA = useEtaStore.getState().cumulativeTime;
    useEtaStore.getState().computeETAForRoute("collection-1", pointsA);
    useEtaStore.getState().computeETAForRoute("collection-1", pointsB);

    expect(useEtaStore.getState().cumulativeTime).not.toBe(cumulativeA);
    expect(useEtaStore.getState().cumulativeTime?.[1]).toBeGreaterThan(cumulativeA?.[1] ?? 0);
    expect(useEtaStore.getState().cachedPoints).toBe(pointsB);
  });

  it("offsets climb display coordinates for stitched segments and sorts by stitched distance", () => {
    useClimbStore.setState({
      climbs: {
        r1: [buildClimb("c1", "r1", 700, 900)],
        r2: [buildClimb("c2", "r2", 100, 400)],
      },
    });

    const display = useClimbStore
      .getState()
      .getClimbsForDisplay(["r1", "r2"], stitchedSegmentsFixture);

    expect(
      display.map((c) => [c.id, c.effectiveStartDistanceMeters, c.effectiveEndDistanceMeters]),
    ).toEqual([
      ["c1", 700, 900],
      ["c2", 1_100, 1_400],
    ]);
  });

  it("clips climb display coordinates to active patch source spans", () => {
    const patchSegment: StitchedSegmentInfo = {
      routeId: "patch",
      routeName: "patch",
      position: 0,
      variantKind: "patch",
      baseRouteId: "base",
      replaceStartDistanceMeters: 500,
      replaceEndDistanceMeters: 1_500,
      startPointIndex: 0,
      endPointIndex: 5,
      distanceOffsetMeters: 0,
      segmentDistanceMeters: 1_700,
      segmentAscentMeters: 100,
      segmentDescentMeters: 0,
      sourceSpans: [
        {
          routeId: "base",
          routeName: "base",
          position: 0,
          kind: "base-prefix",
          startPointIndex: 0,
          endPointIndex: 1,
          rawStartDistanceMeters: 0,
          rawEndDistanceMeters: 500,
          effectiveStartDistanceMeters: toDisplayDistanceMeters(0),
          effectiveEndDistanceMeters: toDisplayDistanceMeters(500),
          distanceOffsetMeters: 0,
        },
        {
          routeId: "patch",
          routeName: "patch",
          position: 0,
          kind: "patch",
          startPointIndex: 2,
          endPointIndex: 3,
          rawStartDistanceMeters: 0,
          rawEndDistanceMeters: 700,
          effectiveStartDistanceMeters: toDisplayDistanceMeters(500),
          effectiveEndDistanceMeters: toDisplayDistanceMeters(1_200),
          distanceOffsetMeters: 500,
        },
        {
          routeId: "base",
          routeName: "base",
          position: 0,
          kind: "base-suffix",
          startPointIndex: 4,
          endPointIndex: 5,
          rawStartDistanceMeters: 1_500,
          rawEndDistanceMeters: 2_000,
          effectiveStartDistanceMeters: toDisplayDistanceMeters(1_200),
          effectiveEndDistanceMeters: toDisplayDistanceMeters(1_700),
          distanceOffsetMeters: -300,
        },
      ],
    };

    useClimbStore.setState({
      climbs: {
        base: [
          buildClimb("before", "base", 200, 400),
          buildClimb("replaced", "base", 800, 1_000),
          buildClimb("after", "base", 1_700, 1_900),
        ],
        patch: [buildClimb("patch-climb", "patch", 100, 300)],
      },
    });

    const display = useClimbStore.getState().getClimbsForDisplay(["base", "patch"], [patchSegment]);

    expect(
      display.map((climb) => [
        climb.id,
        climb.effectiveStartDistanceMeters,
        climb.effectiveEndDistanceMeters,
      ]),
    ).toEqual([
      ["before", 200, 400],
      ["patch-climb", 600, 800],
      ["after", 1_400, 1_600],
    ]);
  });
});
