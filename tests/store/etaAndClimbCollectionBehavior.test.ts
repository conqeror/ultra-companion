import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildClimb } from "@/tests/fixtures/climb";
import { buildStitchedCollection, stitchedSegmentsFixture } from "@/tests/fixtures/collection";
import { buildPoi } from "@/tests/fixtures/poi";
import { buildRoutePoint } from "@/tests/fixtures/route";
import { createStitchedCollectionHarness } from "@/tests/helpers/stitchedCollectionHarness";
import { etaCalculatorMocks } from "@/tests/mocks/etaCalculator";
import { toDisplayPOI } from "@/services/displayDistance";

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
      isClimbZoomed: false,
    });
    stitchedHarness.reset();
    etaCalculatorMocks.computeRouteETA.mockReset();
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

    stitchedHarness.routeState.snappedPosition = { pointIndex: 0 };
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

    stitchedHarness.routeState.snappedPosition = { pointIndex: 0 };
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

  it("recomputes ETA cache when collection variant swaps points array with same route id", () => {
    const pointsA = [buildRoutePoint(0, 0), buildRoutePoint(1_000, 1)];
    const pointsB = [buildRoutePoint(0, 0), buildRoutePoint(1_200, 1)];
    etaCalculatorMocks.computeRouteETA.mockReturnValueOnce([0, 100]).mockReturnValueOnce([0, 140]);

    useEtaStore.getState().computeETAForRoute("collection-1", pointsA);
    useEtaStore.getState().computeETAForRoute("collection-1", pointsA);
    useEtaStore.getState().computeETAForRoute("collection-1", pointsB);

    expect(etaCalculatorMocks.computeRouteETA).toHaveBeenCalledTimes(2);
    expect(useEtaStore.getState().cumulativeTime).toEqual([0, 140]);
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
});
