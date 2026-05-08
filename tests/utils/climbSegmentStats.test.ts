import { describe, expect, it } from "vitest";
import { computeClimbSegmentStats } from "@/utils/climbSegmentStats";
import type { RoutePoint } from "@/types";

function point(distanceFromStartMeters: number, elevationMeters: number, idx: number): RoutePoint {
  return {
    latitude: 0,
    longitude: idx,
    elevationMeters,
    distanceFromStartMeters,
    idx,
  };
}

describe("climbSegmentStats", () => {
  it("computes remaining climb stats from distance-bounded route points", () => {
    const points = [
      point(0, 100, 0),
      point(100, 110, 1),
      point(200, 130, 2),
      point(300, 125, 3),
      point(400, 160, 4),
      point(500, 170, 5),
    ];

    expect(computeClimbSegmentStats(points, 150, 450)).toEqual({
      gainMeters: 50,
      lengthMeters: 300,
      averageGradientPercent: 16.7,
      maxGradientPercent: 26.7,
    });
  });

  it("falls back to segment gradients for short remaining chunks", () => {
    const points = [point(0, 100, 0), point(40, 112, 1)];

    expect(computeClimbSegmentStats(points, 0, 40)).toEqual({
      gainMeters: 12,
      lengthMeters: 40,
      averageGradientPercent: 30,
      maxGradientPercent: 30,
    });
  });
});
