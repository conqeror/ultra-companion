import { describe, expect, it } from "vitest";
import {
  buildRouteSegmentSpatialIndex,
  computePOIRouteAssociation,
  findFirstPointAtOrAfterDistance,
  findLastPointAtOrBeforeDistance,
  routeToMapGeoJSON,
  simplifyRoutePointsForMap,
} from "@/utils/geo";
import type { RoutePoint } from "@/types";

function point(idx: number, distanceFromStartMeters: number, latitude = 0): RoutePoint {
  return {
    latitude,
    longitude: distanceFromStartMeters / 100_000,
    elevationMeters: 100,
    distanceFromStartMeters,
    idx,
  };
}

describe("geo route performance helpers", () => {
  it("finds distance boundaries with binary search semantics", () => {
    const points = [point(0, 0), point(1, 100), point(2, 200), point(3, 400)];

    expect(findFirstPointAtOrAfterDistance(points, 150)).toBe(2);
    expect(findFirstPointAtOrAfterDistance(points, 400)).toBe(3);
    expect(findFirstPointAtOrAfterDistance(points, 401)).toBe(4);
    expect(findLastPointAtOrBeforeDistance(points, 150)).toBe(1);
    expect(findLastPointAtOrBeforeDistance(points, 50, 1)).toBe(0);
  });

  it("simplifies map geometry while preserving useful route shape", () => {
    const points = [
      point(0, 0, 0),
      point(1, 100, 0),
      point(2, 200, 0),
      point(3, 300, 0.01),
      point(4, 400, 0),
      point(5, 500, 0),
    ];

    const simplified = simplifyRoutePointsForMap(points, 20);

    expect(simplified[0]).toBe(points[0]);
    expect(simplified[simplified.length - 1]).toBe(points[points.length - 1]);
    expect(simplified).toContain(points[3]);
    expect(simplified.length).toBeLessThan(points.length);
  });

  it("caches map GeoJSON by route point array reference", () => {
    const points = [point(0, 0), point(1, 100), point(2, 200)];

    expect(routeToMapGeoJSON(points)).toBe(routeToMapGeoJSON(points));
  });

  it("matches full POI route association when using a segment spatial index", () => {
    const points = Array.from({ length: 200 }, (_, idx) => point(idx, idx * 100));
    const indexed = buildRouteSegmentSpatialIndex(points, 1_000);

    const full = computePOIRouteAssociation(0.001, 0.05, points);
    const withIndex = computePOIRouteAssociation(0.001, 0.05, points, indexed);

    expect(withIndex.distanceAlongRouteMeters).toBeCloseTo(full.distanceAlongRouteMeters, 4);
    expect(withIndex.distanceFromRouteMeters).toBeCloseTo(full.distanceFromRouteMeters, 4);
    expect(withIndex.nearestIndex).toBe(full.nearestIndex);
  });
});
