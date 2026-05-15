import { describe, expect, it } from "vitest";
import {
  buildClimbDistanceMarkerFeatureCollection,
  buildClimbMarkerDistances,
  climbMarkerIntervalMeters,
} from "@/utils/climbDistanceMarkers";
import type { RoutePoint } from "@/types";

function point(idx: number, distanceFromStartMeters: number): RoutePoint {
  return {
    latitude: distanceFromStartMeters / 1000,
    longitude: distanceFromStartMeters / 500,
    elevationMeters: null,
    distanceFromStartMeters,
    idx,
  };
}

describe("climbDistanceMarkers", () => {
  it("uses 1 km, 2 km, then 5 km marker spacing as climbs get longer", () => {
    expect(climbMarkerIntervalMeters(14_999)).toBe(1000);
    expect(climbMarkerIntervalMeters(15_000)).toBe(2000);
    expect(climbMarkerIntervalMeters(40_000)).toBe(5000);
  });

  it("builds start, interior, and top local marker distances", () => {
    expect(buildClimbMarkerDistances(2500)).toEqual([0, 1000, 2000, 2500]);
    expect(buildClimbMarkerDistances(16_500)).toEqual([
      0, 2000, 4000, 6000, 8000, 10_000, 12_000, 14_000, 16_000, 16_500,
    ]);
  });

  it("interpolates selected-climb marker coordinates on absolute route points", () => {
    const shape = buildClimbDistanceMarkerFeatureCollection({
      points: [point(0, 0), point(1, 5000)],
      startDistanceMeters: 1250,
      endDistanceMeters: 3750,
    });

    expect(shape.features.map((f) => f.properties.markerLabel)).toEqual(["0", "1", "2", "TOP"]);
    expect(shape.features.map((f) => f.properties.localDistanceMeters)).toEqual([
      0, 1000, 2000, 2500,
    ]);
    expect(shape.features[0].geometry.coordinates).toEqual([2.5, 1.25]);
    expect(shape.features[3].geometry.coordinates).toEqual([7.5, 3.75]);
  });
});
