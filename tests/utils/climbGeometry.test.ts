import { describe, expect, it } from "vitest";
import {
  getClimbMapBounds,
  getClimbMapSamples,
  getZoomLevelToFitBounds,
} from "@/utils/climbGeometry";
import type { RoutePoint } from "@/types";

function point(
  idx: number,
  distanceFromStartMeters: number,
  longitude: number,
  latitude: number,
  elevationMeters = 100,
): RoutePoint {
  return {
    latitude,
    longitude,
    elevationMeters,
    distanceFromStartMeters,
    idx,
  };
}

describe("climbGeometry", () => {
  it("interpolates climb start and end samples around interior route points", () => {
    const points = [point(0, 0, 0, 0, 100), point(1, 100, 1, 1, 200), point(2, 200, 2, 0, 300)];

    const samples = getClimbMapSamples(points, 50, 150);

    expect(samples).toHaveLength(3);
    expect(samples[0]).toMatchObject({
      longitude: 0.5,
      latitude: 0.5,
      distanceFromStartMeters: 50,
      elevationMeters: 150,
    });
    expect(samples[1]).toMatchObject({ longitude: 1, latitude: 1, distanceFromStartMeters: 100 });
    expect(samples[2]).toMatchObject({
      longitude: 1.5,
      latitude: 0.5,
      distanceFromStartMeters: 150,
      elevationMeters: 250,
    });
  });

  it("builds bounds from interpolated endpoints and route-shape extremes", () => {
    const points = [
      point(0, 0, 0, 0),
      point(1, 100, 1, 3),
      point(2, 200, 2, 0),
      point(3, 300, 3, 2),
    ];

    const bounds = getClimbMapBounds(points, 50, 250);

    expect(bounds?.sw).toEqual([0.5, 0]);
    expect(bounds?.ne).toEqual([2.5, 3]);
    expect(bounds?.center).toEqual([1.5, 1.5]);
  });

  it("keeps current zoom when bounds fit and lowers zoom when they do not", () => {
    const bounds = {
      ne: [18.5, 49.5] as [number, number],
      sw: [18.4, 49.4] as [number, number],
      center: [18.45, 49.45] as [number, number],
      corners: [
        [18.4, 49.4],
        [18.4, 49.5],
        [18.5, 49.4],
        [18.5, 49.5],
      ] as [number, number][],
    };
    const padding = { top: 72, right: 32, bottom: 340, left: 32 };

    expect(getZoomLevelToFitBounds(9, bounds, 390, 844, padding)).toBe(9);
    expect(getZoomLevelToFitBounds(15, bounds, 390, 844, padding)).toBeLessThan(15);
  });
});
