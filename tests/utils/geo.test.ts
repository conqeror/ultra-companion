import { describe, expect, it } from "vitest";
import {
  allocateMapCoordinateBudget,
  buildRouteSegmentSpatialIndex,
  computeElevationProgressAtDistance,
  computeSliceAscentFromDistance,
  computeSliceElevationTotalsFromDistance,
  computePOIRouteAssociation,
  downsampleRoutePointsByDistance,
  findFirstPointAtOrAfterDistance,
  findLastPointAtOrBeforeDistance,
  findNearestPointIndexAtDistance,
  estimateMapVisibleSpanMeters,
  getMapSimplifyToleranceForVisibleSpan,
  getMapSimplifyToleranceForZoom,
  interpolateRoutePointAtDistance,
  MAX_KEYED_MAP_GEOJSON_CACHE_ENTRIES,
  peekRouteMapGeoJSONForKey,
  prepareRouteMapGeoJSONForKey,
  routePointArrayFingerprint,
  routeToMapGeoJSONForKey,
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
  it("keeps multiple renderable lines within a shared coordinate budget", () => {
    const allocations = allocateMapCoordinateBudget([300_000, 2, 2, 50_000], 60_000);

    expect(allocations).toHaveLength(4);
    expect(allocations.every((allocation) => allocation >= 2)).toBe(true);
    expect(allocations.reduce((total, allocation) => total + allocation, 0)).toBeLessThanOrEqual(
      60_000,
    );
    expect(allocations[0]).toBeGreaterThan(allocations[3]);
  });

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
    expect(computeSliceElevationTotalsFromDistance(points, 50, 150)).toEqual({
      ascent: 50,
      descent: 25,
    });
  });

  it("bounds elevation-total work to the requested route window", () => {
    let distanceReads = 0;
    const points = Array.from({ length: 10_000 }, (_, index) => {
      const routePoint = {
        ...point(index, index * 10),
        elevationMeters: index % 2 === 0 ? 100 : 110,
      };
      return new Proxy(routePoint, {
        get(target, property, receiver) {
          if (property === "distanceFromStartMeters") distanceReads++;
          return Reflect.get(target, property, receiver);
        },
      });
    });

    const totals = computeSliceElevationTotalsFromDistance(points, 50_000, 50_100);

    expect(totals).toEqual({ ascent: 50, descent: 50 });
    expect(distanceReads).toBeLessThan(200);
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

  it("chooses map simplification tolerance from visible map span", () => {
    expect(getMapSimplifyToleranceForVisibleSpan(null)).toBe(20);
    expect(getMapSimplifyToleranceForVisibleSpan(10_000)).toBe(0);
    expect(getMapSimplifyToleranceForVisibleSpan(30_000)).toBe(0);
    expect(getMapSimplifyToleranceForVisibleSpan(30_001)).toBe(12);
    expect(getMapSimplifyToleranceForVisibleSpan(250_000)).toBe(12);
    expect(getMapSimplifyToleranceForVisibleSpan(250_001)).toBe(120);

    expect(
      getMapSimplifyToleranceForZoom(11, {
        latitude: 0,
        viewportWidthPx: 512,
        viewportHeightPx: 512,
      }),
    ).toBe(0);
    expect(
      getMapSimplifyToleranceForZoom(10, {
        latitude: 0,
        viewportWidthPx: 512,
        viewportHeightPx: 512,
      }),
    ).toBe(12);
    expect(
      getMapSimplifyToleranceForZoom(7, {
        latitude: 0,
        viewportWidthPx: 512,
        viewportHeightPx: 512,
      }),
    ).toBe(120);
    expect(
      estimateMapVisibleSpanMeters(11, {
        latitude: 0,
        viewportWidthPx: 512,
        viewportHeightPx: 512,
      }),
    ).toBeLessThan(30_000);
  });

  it("returns full route geometry at detailed map scale", () => {
    const points = [
      point(0, 0, 0),
      point(1, 100, 0),
      point(2, 200, 0),
      point(3, 300, 0.0001),
      point(4, 400, 0),
      point(5, 500, 0),
    ];

    const overview = routeToMapGeoJSON(points, 8);
    const detailed = routeToMapGeoJSON(points, 16);

    expect(detailed.geometry.coordinates.length).toBe(points.length);
    expect(overview.geometry.coordinates.length).toBeLessThan(detailed.geometry.coordinates.length);
    expect(detailed.geometry.coordinates).toContainEqual([points[3].longitude, points[3].latitude]);
  });

  it("caches map GeoJSON per route point reference and zoom bucket", () => {
    const points = [point(0, 0), point(1, 100), point(2, 200)];

    expect(routeToMapGeoJSON(points, 11)).toBe(routeToMapGeoJSON(points, 12));
    expect(routeToMapGeoJSON(points, 8)).not.toBe(routeToMapGeoJSON(points, 11));
  });

  it("caches keyed map GeoJSON across equivalent route point arrays", () => {
    const points = [point(0, 0), point(1, 100), point(2, 200)];
    const equivalent = points.map((p) => ({ ...p }));
    const changed = [point(0, 0), point(1, 110), point(2, 200)];

    expect(routeToMapGeoJSONForKey("route-a", points, 20)).toBe(
      routeToMapGeoJSONForKey("route-a", equivalent, 20),
    );
    expect(routeToMapGeoJSONForKey("route-a", points, 20)).not.toBe(
      routeToMapGeoJSONForKey("route-a", changed, 20),
    );
    expect(routeToMapGeoJSONForKey("route-a", points, 20)).not.toBe(
      routeToMapGeoJSONForKey("route-a", points, 8),
    );
  });

  it("uses a compact deterministic fingerprint without per-point string growth", () => {
    const points = Array.from({ length: 10_000 }, (_, index) => point(index, index * 10));
    const equivalent = points.map((routePoint) => ({ ...routePoint }));
    const changed = equivalent.map((routePoint, index) =>
      index === 5_000 ? { ...routePoint, longitude: routePoint.longitude + 0.00001 } : routePoint,
    );

    const fingerprint = routePointArrayFingerprint(points);

    expect(fingerprint.length).toBeLessThan(40);
    expect(routePointArrayFingerprint(equivalent)).toBe(fingerprint);
    expect(routePointArrayFingerprint(changed)).not.toBe(fingerprint);
  });

  it("prepares a bounded point range for long collection segments", () => {
    const points = Array.from({ length: 20 }, (_, index) => point(index, index * 100));

    const prepared = prepareRouteMapGeoJSONForKey("bounded-segment", points, 0, undefined, {
      startPointIndex: 4,
      endPointIndex: 15,
      maxPoints: 5,
    });

    expect(prepared.geometry.coordinates).toHaveLength(5);
    expect(prepared.geometry.coordinates[0]).toEqual([points[4].longitude, points[4].latitude]);
    expect(prepared.geometry.coordinates.at(-1)).toEqual([
      points[15].longitude,
      points[15].latitude,
    ]);
  });

  it("bounds the keyed map geometry cache with least-recently-used eviction", () => {
    const points = [point(0, 0), point(1, 100), point(2, 200)];
    const firstKey = "bounded-cache-0";
    prepareRouteMapGeoJSONForKey(firstKey, points, 20);

    let newest: GeoJSON.Feature<GeoJSON.LineString> | null = null;
    for (let index = 1; index <= MAX_KEYED_MAP_GEOJSON_CACHE_ENTRIES; index++) {
      newest = prepareRouteMapGeoJSONForKey(`bounded-cache-${index}`, points, 20);
    }

    expect(peekRouteMapGeoJSONForKey(firstKey, points, 20)).toBeNull();
    expect(
      peekRouteMapGeoJSONForKey(`bounded-cache-${MAX_KEYED_MAP_GEOJSON_CACHE_ENTRIES}`, points, 20),
    ).toBe(newest);
  });

  it("prepares and peeks keyed map GeoJSON without render-time generation", () => {
    const points = [point(0, 0), point(1, 100), point(2, 200)];
    const equivalent = points.map((p) => ({ ...p }));
    const changed = [point(0, 0), point(1, 110), point(2, 200)];

    expect(peekRouteMapGeoJSONForKey("route-prep", points, 20)).toBeNull();

    const prepared = prepareRouteMapGeoJSONForKey("route-prep", points, 20);

    expect(peekRouteMapGeoJSONForKey("route-prep", points, 20)).toBe(prepared);
    expect(peekRouteMapGeoJSONForKey("route-prep", equivalent, 20)).toBe(prepared);
    expect(peekRouteMapGeoJSONForKey("route-prep", changed, 20)).toBeNull();
    expect(prepareRouteMapGeoJSONForKey("route-prep", points, 8)).not.toBe(prepared);
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
