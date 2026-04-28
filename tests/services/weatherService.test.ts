import { describe, expect, it } from "vitest";
import { sampleWaypoints } from "@/services/weatherService";
import type { RoutePoint } from "@/types";

const DEG_PER_METER = 1 / 111_320;

function point(idx: number, distanceFromStartMeters: number, latitude = 0): RoutePoint {
  return {
    latitude,
    longitude: distanceFromStartMeters * DEG_PER_METER,
    elevationMeters: 0,
    distanceFromStartMeters,
    idx,
  };
}

describe("weatherService", () => {
  it("samples the first weather waypoint from projected route progress", () => {
    const points = [point(0, 0), point(1, 1_000), point(2, 2_000)];

    const waypoints = sampleWaypoints(points, 250);

    expect(waypoints[0]).toMatchObject({
      distanceAlongRouteM: 0,
      index: 0,
    });
    expect(waypoints[0].longitude).toBeCloseTo(250 * DEG_PER_METER, 8);
  });

  it("samples exact collection joins from the forward segment", () => {
    const points = [point(0, 0, 0), point(1, 1_000, 0), point(2, 1_000, 1), point(3, 2_000, 2)];

    const waypoints = sampleWaypoints(points, 1_000);

    expect(waypoints[0]).toMatchObject({
      index: 2,
      segmentIndex: 2,
      latitude: 1,
    });
  });

  it("returns no weather waypoints for out-of-range progress", () => {
    const points = [point(0, 0), point(1, 1_000), point(2, 2_000)];

    expect(sampleWaypoints(points, -1)).toEqual([]);
    expect(sampleWaypoints(points, 2_001)).toEqual([]);
  });
});
