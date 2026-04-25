import { describe, expect, it } from "vitest";
import { snapToRoute } from "@/services/routeSnapping";
import type { RoutePoint } from "@/types";

function point(idx: number, latitude: number): RoutePoint {
  return {
    latitude,
    longitude: 0,
    elevationMeters: 0,
    distanceFromStartMeters: idx * 100,
    idx,
  };
}

describe("routeSnapping", () => {
  it("uses previous snap locality but falls back when the position jumps beyond the window", () => {
    const points = Array.from({ length: 1_200 }, (_, idx) => point(idx, idx * 0.001));

    const local = snapToRoute(0.01, 0, "r1", points, { previousPointIndex: 9 });
    const jumped = snapToRoute(1.1, 0, "r1", points, { previousPointIndex: 9 });

    expect(local?.pointIndex).toBe(10);
    expect(jumped?.pointIndex).toBe(1_100);
  });

  it("falls back globally when a stale local window has a plausible but wrong candidate", () => {
    const points = Array.from({ length: 1_200 }, (_, idx) => point(idx, 5 + idx * 0.001));
    points[10] = point(10, 0.005); // ~556m away, inside the old local window.
    points[900] = point(900, 0); // True current position, outside the old local window.

    const snapped = snapToRoute(0, 0, "r1", points, { previousPointIndex: 10 });

    expect(snapped?.pointIndex).toBe(900);
    expect(snapped?.distanceAlongRouteMeters).toBe(90_000);
  });
});
