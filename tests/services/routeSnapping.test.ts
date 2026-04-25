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
});
