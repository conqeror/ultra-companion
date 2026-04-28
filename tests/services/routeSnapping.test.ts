import { describe, expect, it } from "vitest";
import { snapToRoute, snapToRouteDetailed } from "@/services/routeSnapping";
import type { RoutePoint, RouteSnapCandidate, RouteSnapHistorySample } from "@/types";

const DEG_PER_METER = 1 / 111_320;

function coord(xMeters: number, yMeters = 0): { latitude: number; longitude: number } {
  return {
    latitude: yMeters * DEG_PER_METER,
    longitude: xMeters * DEG_PER_METER,
  };
}

function point(
  idx: number,
  xMeters: number,
  yMeters: number,
  distanceFromStartMeters: number,
): RoutePoint {
  const position = coord(xMeters, yMeters);
  return {
    ...position,
    elevationMeters: 0,
    distanceFromStartMeters,
    idx,
  };
}

function linePoint(idx: number): RoutePoint {
  return point(idx, 0, idx * 100, idx * 100);
}

function snapAndRecord(
  xMeters: number,
  yMeters: number,
  routeId: string,
  points: RoutePoint[],
  history: RouteSnapHistorySample[],
  timestamp: number,
  options?: { headingDegrees?: number; speedMetersPerSecond?: number },
) {
  const position = coord(xMeters, yMeters);
  const result = snapToRouteDetailed(position.latitude, position.longitude, routeId, points, {
    history,
    headingDegrees: options?.headingDegrees,
    speedMetersPerSecond: options?.speedMetersPerSecond,
    timestamp,
  });
  if (!result) throw new Error("Expected position to snap to route");

  history.push({
    routeId,
    latitude: position.latitude,
    longitude: position.longitude,
    timestamp,
    heading: options?.headingDegrees ?? null,
    speed: options?.speedMetersPerSecond ?? null,
    selectedCandidate: result.selectedCandidate,
  });

  return result;
}

function candidate(
  segmentIndex: number,
  pointIndex: number,
  distanceAlongRouteMeters: number,
  segmentBearingDegrees: number,
): RouteSnapCandidate {
  return {
    segmentIndex,
    pointIndex,
    projectedFraction: 0,
    distanceAlongRouteMeters,
    distanceFromRouteMeters: 0,
    segmentBearingDegrees,
  };
}

describe("routeSnapping", () => {
  it("uses previous snap locality but falls back when the position jumps beyond the window", () => {
    const points = Array.from({ length: 1_200 }, (_, idx) => linePoint(idx));

    const localPosition = coord(0, 1_000);
    const jumpedPosition = coord(0, 110_000);
    const local = snapToRoute(localPosition.latitude, localPosition.longitude, "r1", points, {
      previousPointIndex: 9,
    });
    const jumped = snapToRoute(jumpedPosition.latitude, jumpedPosition.longitude, "r1", points, {
      previousPointIndex: 9,
    });

    expect(local?.pointIndex).toBe(10);
    expect(jumped?.pointIndex).toBe(1_100);
  });

  it("falls back globally when a stale local window has a plausible but wrong candidate", () => {
    const points = Array.from({ length: 1_200 }, (_, idx) =>
      point(idx, 0, 500_000 + idx * 100, idx * 100),
    );
    points[10] = point(10, 0, 556, 1_000);
    points[900] = point(900, 0, 0, 90_000);

    const snapped = snapToRoute(0, 0, "r1", points, { previousPointIndex: 10 });

    expect(snapped?.pointIndex).toBe(900);
    expect(snapped?.distanceAlongRouteMeters).toBe(90_000);
  });

  it("uses projected segment progress as authoritative route progress", () => {
    const points = [point(0, 0, 0, 0), point(1, 1_000, 0, 1_000)];
    const position = coord(250, 100);

    const snapped = snapToRouteDetailed(position.latitude, position.longitude, "r1", points);

    expect(snapped?.snappedPosition.pointIndex).toBe(0);
    expect(snapped?.snappedPosition.distanceAlongRouteMeters).toBeCloseTo(250, 1);
    expect(snapped?.selectedCandidate.distanceAlongRouteMeters).toBeCloseTo(250, 1);
    expect(snapped?.snappedPosition.distanceFromRouteMeters).toBeCloseTo(100, 0);
  });

  it("keeps out-and-back progress on the outbound leg before the turnaround", () => {
    const points = [
      point(0, 0, 0, 0),
      point(1, 1_000, 0, 1_000),
      point(2, 2_000, 0, 2_000),
      point(3, 3_000, 0, 3_000),
      point(4, 2_000, 0, 4_000),
      point(5, 1_000, 0, 5_000),
      point(6, 0, 0, 6_000),
    ];
    const history: RouteSnapHistorySample[] = [];

    const first = snapAndRecord(500, 0, "out-back", points, history, 0, {
      headingDegrees: 90,
      speedMetersPerSecond: 5,
    });
    const second = snapAndRecord(1_000, 0, "out-back", points, history, 60_000, {
      headingDegrees: 90,
      speedMetersPerSecond: 5,
    });
    const third = snapAndRecord(2_000, 0, "out-back", points, history, 120_000, {
      headingDegrees: 90,
      speedMetersPerSecond: 5,
    });

    expect(first.snappedPosition.distanceAlongRouteMeters).toBeCloseTo(500, 1);
    expect(second.snappedPosition.distanceAlongRouteMeters).toBeCloseTo(1_000, 1);
    expect(third.snappedPosition.distanceAlongRouteMeters).toBeCloseTo(2_000, 1);
  });

  it("moves out-and-back progress onto the return leg after the turnaround", () => {
    const points = [
      point(0, 0, 0, 0),
      point(1, 1_000, 0, 1_000),
      point(2, 2_000, 0, 2_000),
      point(3, 3_000, 0, 3_000),
      point(4, 2_000, 0, 4_000),
      point(5, 1_000, 0, 5_000),
      point(6, 0, 0, 6_000),
    ];
    const history: RouteSnapHistorySample[] = [];

    snapAndRecord(2_000, 0, "out-back", points, history, 0, {
      headingDegrees: 90,
      speedMetersPerSecond: 5,
    });
    snapAndRecord(3_000, 0, "out-back", points, history, 60_000, {
      headingDegrees: 90,
      speedMetersPerSecond: 5,
    });
    const returnLeg = snapAndRecord(2_500, 0, "out-back", points, history, 120_000, {
      headingDegrees: 270,
      speedMetersPerSecond: 5,
    });
    const laterReturnLeg = snapAndRecord(1_000, 0, "out-back", points, history, 180_000, {
      headingDegrees: 270,
      speedMetersPerSecond: 5,
    });

    expect(returnLeg.snappedPosition.distanceAlongRouteMeters).toBeCloseTo(3_500, 1);
    expect(laterReturnLeg.snappedPosition.distanceAlongRouteMeters).toBeCloseTo(5_000, 1);
  });

  it("ignores reported heading when speed is unknown", () => {
    const points = [
      point(0, 0, 0, 0),
      point(1, 1_000, 0, 1_000),
      point(2, 2_000, 0, 2_000),
      point(3, 3_000, 0, 3_000),
      point(4, 2_000, 0, 4_000),
      point(5, 1_000, 0, 5_000),
      point(6, 0, 0, 6_000),
    ];
    const history: RouteSnapHistorySample[] = [];
    snapAndRecord(2_000, 0, "out-back", points, history, 0, {
      headingDegrees: 90,
      speedMetersPerSecond: 5,
    });
    const position = coord(2_500, 0);

    const snapped = snapToRouteDetailed(position.latitude, position.longitude, "out-back", points, {
      history,
      headingDegrees: 270,
      speedMetersPerSecond: null,
      timestamp: 60_000,
    });

    expect(snapped?.snappedPosition.distanceAlongRouteMeters).toBeCloseTo(2_500, 1);
  });

  it("ignores invalid negative headings", () => {
    const points = [
      point(0, 0, 0, 0),
      point(1, 1_000, 0, 1_000),
      point(2, 2_000, 0, 2_000),
      point(3, 3_000, 0, 3_000),
      point(4, 2_000, 0, 4_000),
      point(5, 1_000, 0, 5_000),
      point(6, 0, 0, 6_000),
    ];
    const history: RouteSnapHistorySample[] = [];
    snapAndRecord(2_000, 0, "out-back", points, history, 0, {
      headingDegrees: 90,
      speedMetersPerSecond: 5,
    });
    const position = coord(2_500, 0);

    const snapped = snapToRouteDetailed(position.latitude, position.longitude, "out-back", points, {
      history,
      headingDegrees: -90,
      speedMetersPerSecond: 5,
      timestamp: 60_000,
    });

    expect(snapped?.snappedPosition.distanceAlongRouteMeters).toBeCloseTo(2_500, 1);
  });

  it("prefers the self-crossing leg consistent with recent movement", () => {
    const points = [
      point(0, -1_000, -1_000, 0),
      point(1, 0, 0, 1_414),
      point(2, 1_000, -1_000, 2_828),
      point(3, 1_000, 1_000, 4_828),
      point(4, 0, 0, 6_242),
      point(5, -1_000, 1_000, 7_656),
    ];
    const history: RouteSnapHistorySample[] = [];

    snapAndRecord(900, 900, "figure-eight", points, history, 0, {
      headingDegrees: 225,
      speedMetersPerSecond: 5,
    });
    const crossing = snapAndRecord(0, 0, "figure-eight", points, history, 60_000, {
      headingDegrees: 225,
      speedMetersPerSecond: 5,
    });

    expect(crossing.snappedPosition.distanceAlongRouteMeters).toBeCloseTo(6_242, 0);
  });

  it("disambiguates overlapping stitched collection segments with route progress history", () => {
    const points = [
      point(0, 0, 0, 0),
      point(1, 1_000, 0, 1_000),
      point(2, 2_000, 0, 2_000),
      point(3, 1_000, 0, 3_000),
      point(4, 2_000, 0, 4_000),
    ];
    const seed = coord(1_200, 0);
    const history: RouteSnapHistorySample[] = [
      {
        routeId: "collection",
        latitude: seed.latitude,
        longitude: seed.longitude,
        timestamp: 0,
        heading: 90,
        speed: 5,
        selectedCandidate: candidate(3, 3, 3_200, 90),
      },
    ];

    const snapped = snapAndRecord(1_500, 0, "collection", points, history, 60_000, {
      headingDegrees: 90,
      speedMetersPerSecond: 5,
    });

    expect(snapped.snappedPosition.distanceAlongRouteMeters).toBeCloseTo(3_500, 1);
  });
});
