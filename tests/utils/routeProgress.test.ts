import { describe, expect, it } from "vitest";
import { resolveRouteProgress } from "@/utils/routeProgress";
import type { RoutePoint, SnappedPosition } from "@/types";

function point(idx: number, distanceFromStartMeters: number): RoutePoint {
  return {
    latitude: 0,
    longitude: 0,
    elevationMeters: 0,
    distanceFromStartMeters,
    idx,
  };
}

function snap(overrides: Partial<SnappedPosition> = {}): SnappedPosition {
  return {
    routeId: "r1",
    pointIndex: 0,
    distanceAlongRouteMeters: 500,
    distanceFromRouteMeters: 10,
    ...overrides,
  };
}

describe("routeProgress", () => {
  const points = [point(0, 0), point(1, 1_000)];

  it("accepts only snapped progress that belongs to the route and its bounds", () => {
    expect(resolveRouteProgress(snap(), "r1", points)?.distanceAlongRouteMeters).toBe(500);
    expect(resolveRouteProgress(snap({ routeId: "old-route" }), "r1", points)).toBeNull();
    expect(resolveRouteProgress(snap({ distanceAlongRouteMeters: -1 }), "r1", points)).toBeNull();
    expect(
      resolveRouteProgress(snap({ distanceAlongRouteMeters: 1_001 }), "r1", points),
    ).toBeNull();
    expect(resolveRouteProgress(snap({ distanceFromRouteMeters: 1_001 }), "r1", points)).toBeNull();
    expect(
      resolveRouteProgress(snap({ distanceAlongRouteMeters: Number.NaN }), "r1", points),
    ).toBeNull();
  });
});
