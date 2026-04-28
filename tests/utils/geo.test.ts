import { describe, expect, it } from "vitest";
import {
  buildRouteSegmentSpatialIndex,
  computeElevationProgressAtDistance,
  computeSliceAscentFromDistance,
  computePOIRouteAssociation,
  downsampleRoutePointsByDistance,
  findFirstPointAtOrAfterDistance,
  findLastPointAtOrBeforeDistance,
  findNearestPointIndexAtDistance,
  interpolateRoutePointAtDistance,
  routeToMapGeoJSON,
  simplifyRoutePointsForMap,
  splitRoutePointsByDistance,
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
  it("downsamples route points by distance with caller-defined output shape", () => {
    const points = [point(0, 0), point(1, 400), point(2, 1_000), point(3, 1_600), point(4, 2_100)];

    const sampled = downsampleRoutePointsByDistance(points, {
      intervalMeters: 1_000,
      mapPoint: (routePoint) => ({
        lat: routePoint.latitude,
        lon: routePoint.longitude,
      }),
    });

    expect(sampled).toEqual([
      { lat: 0, lon: 0 },
      { lat: 0, lon: 0.01 },
      { lat: 0, lon: 0.021 },
    ]);
  });

  it("allows callers to decide whether duplicate endpoint coordinates are retained", () => {
    const points = [
      point(0, 0, 0),
      { ...point(1, 1_000, 1), longitude: 1 },
      { ...point(2, 1_500, 1), longitude: 1 },
    ];

    const withoutEndpointComparator = downsampleRoutePointsByDistance(points, {
      intervalMeters: 1_000,
      mapPoint: (routePoint) => [routePoint.longitude, routePoint.latitude],
    });
    const withEndpointComparator = downsampleRoutePointsByDistance(points, {
      intervalMeters: 1_000,
      mapPoint: (routePoint) => ({
        lat: routePoint.latitude,
        lon: routePoint.longitude,
      }),
      isSameOutput: (a, b) => a.lat === b.lat && a.lon === b.lon,
    });

    expect(withoutEndpointComparator).toEqual([
      [0, 0],
      [1, 1],
      [1, 1],
    ]);
    expect(withEndpointComparator).toEqual([
      { lat: 0, lon: 0 },
      { lat: 1, lon: 1 },
    ]);
  });

  it("splits route points by distance with one-point overlap", () => {
    const points = [0, 30, 60, 90, 120].map((distance, idx) => point(idx, distance));

    const segments = splitRoutePointsByDistance(points, { maxSegmentLengthMeters: 50 });

    expect(segments.map((segment) => segment.map((routePoint) => routePoint.idx))).toEqual([
      [0, 1, 2],
      [2, 3, 4],
    ]);
  });

  it("can balance route point segments and preserve short routes when requested", () => {
    const points = [0, 40, 80, 120].map((distance, idx) => point(idx, distance));
    const singlePointRoute = [point(0, 0)];

    const balanced = splitRoutePointsByDistance(points, {
      maxSegmentLengthMeters: 50,
      balanceSegments: true,
    });

    expect(balanced.map((segment) => segment.map((routePoint) => routePoint.idx))).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
    ]);
    expect(splitRoutePointsByDistance(singlePointRoute, { maxSegmentLengthMeters: 50 })).toEqual(
      [],
    );
    expect(
      splitRoutePointsByDistance(singlePointRoute, {
        maxSegmentLengthMeters: 50,
        includeShortRoute: true,
      }),
    ).toEqual([singlePointRoute]);
  });

  it("finds distance boundaries with binary search semantics", () => {
    const points = [point(0, 0), point(1, 100), point(2, 100), point(3, 200), point(4, 400)];

    expect(findFirstPointAtOrAfterDistance(points, 150)).toBe(3);
    expect(findFirstPointAtOrAfterDistance(points, 400)).toBe(4);
    expect(findFirstPointAtOrAfterDistance(points, 401)).toBe(5);
    expect(findLastPointAtOrBeforeDistance(points, 100)).toBe(2);
    expect(findLastPointAtOrBeforeDistance(points, 150)).toBe(2);
    expect(findLastPointAtOrBeforeDistance(points, 50, 1)).toBe(0);
    expect(findNearestPointIndexAtDistance(points, 100)).toBe(2);
    expect(findNearestPointIndexAtDistance(points, 160)).toBe(3);
  });

  it("interpolates progress-derived route positions and elevation totals", () => {
    const points = [
      { ...point(0, 0), elevationMeters: 100 },
      { ...point(1, 100), elevationMeters: 200 },
      { ...point(2, 200), elevationMeters: 150 },
    ];

    const interpolated = interpolateRoutePointAtDistance(points, 50);
    const progress = computeElevationProgressAtDistance(points, 50);

    expect(interpolated?.distanceFromStartMeters).toBe(50);
    expect(interpolated?.elevationMeters).toBe(150);
    expect(progress.ascentDone).toBe(50);
    expect(progress.ascentRemaining).toBe(50);
    expect(progress.descentRemaining).toBe(50);
    expect(computeSliceAscentFromDistance(points, 50, 150)).toBe(50);
  });

  it("interpolates exact duplicate-distance joins from the forward segment", () => {
    const points = [point(0, 0, 0), point(1, 100, 0), point(2, 100, 1), point(3, 200, 2)];

    const atJoin = interpolateRoutePointAtDistance(points, 100);
    const afterJoin = interpolateRoutePointAtDistance(points, 150);

    expect(atJoin?.nearestIndex).toBe(2);
    expect(atJoin?.segmentIndex).toBe(2);
    expect(atJoin?.latitude).toBe(1);
    expect(afterJoin?.segmentIndex).toBe(2);
    expect(afterJoin?.latitude).toBe(1.5);
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
