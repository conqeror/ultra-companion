import { describe, expect, it } from "vitest";
import {
  buildClimbProfileSegments,
  buildClimbProfileSlice,
  buildClimbTickDistances,
  chooseClimbTickIntervalMeters,
} from "@/utils/climbProfile";
import type { RoutePoint } from "@/types";

function point(
  idx: number,
  distanceFromStartMeters: number,
  elevationMeters: number,
  longitude = idx,
): RoutePoint {
  return {
    latitude: idx,
    longitude,
    elevationMeters,
    distanceFromStartMeters,
    idx,
  };
}

describe("climbProfile", () => {
  it("builds an exact climb-local slice with interpolated boundaries", () => {
    const points = [
      point(0, 0, 100),
      point(1, 1000, 200),
      point(2, 2000, 180),
      point(3, 3000, 260),
    ];

    const slice = buildClimbProfileSlice(points, 500, 2500);

    expect(slice.map((p) => p.distanceFromStartMeters)).toEqual([0, 500, 1500, 2000]);
    expect(slice.map((p) => p.elevationMeters)).toEqual([150, 200, 180, 220]);
    expect(slice[0]).toMatchObject({ latitude: 0.5, longitude: 0.5, idx: 0 });
    expect(slice[slice.length - 1]).toMatchObject({ latitude: 2.5, longitude: 2.5, idx: 3 });
  });

  it("splits climb-local points into 1 km net-gradient segments", () => {
    const points = [
      point(0, 0, 100),
      point(1, 1000, 160),
      point(2, 2000, 130),
      point(3, 2500, 155),
    ];

    expect(buildClimbProfileSegments(points)).toEqual([
      { startDistanceMeters: 0, endDistanceMeters: 1000, averageGradientPercent: 6 },
      { startDistanceMeters: 1000, endDistanceMeters: 2000, averageGradientPercent: -3 },
      { startDistanceMeters: 2000, endDistanceMeters: 2500, averageGradientPercent: 5 },
    ]);
  });

  it("chooses readable climb tick intervals and allows fixed 1 km ticks", () => {
    expect(chooseClimbTickIntervalMeters(800)).toBe(100);
    expect(chooseClimbTickIntervalMeters(2400)).toBe(200);
    expect(chooseClimbTickIntervalMeters(8000)).toBe(1000);
    expect(chooseClimbTickIntervalMeters(20000)).toBe(2000);
    expect(buildClimbTickDistances(4500, 1000)).toEqual([1000, 2000, 3000, 4000]);
  });
});
