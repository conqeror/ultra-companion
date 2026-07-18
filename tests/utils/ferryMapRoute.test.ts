import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeOSMFerryGeometry, OSM_FERRY_GEOMETRY_PROVIDER_REF } from "@/services/ferryGeometry";
import * as geo from "@/utils/geo";
import {
  buildFerryAwarePreviewLayers,
  buildFerryMapDisplayPoints,
  buildFerryMapLandPieces,
  buildFerryMapRouteComposition,
  ferriesContainedInDistanceRange,
} from "@/utils/ferryMapRoute";
import type { DisplayFerryCrossing, RoutePoint } from "@/types";

afterEach(() => {
  vi.restoreAllMocks();
});

function point(
  idx: number,
  distance: number,
  latitude = 0,
  longitude = distance / 100_000,
): RoutePoint {
  return {
    idx,
    distanceFromStartMeters: distance,
    latitude,
    longitude,
    elevationMeters: 100,
  };
}

function crossing(overrides: Partial<DisplayFerryCrossing> = {}): DisplayFerryCrossing {
  return {
    id: "ferry-1",
    routeId: "route-1",
    name: "Curved ferry",
    startDistanceMeters: 1_000,
    endDistanceMeters: 2_000,
    effectiveStartDistanceMeters: 1_000 as DisplayFerryCrossing["effectiveStartDistanceMeters"],
    effectiveEndDistanceMeters: 2_000 as DisplayFerryCrossing["effectiveEndDistanceMeters"],
    startLatitude: 0,
    startLongitude: 0.01,
    endLatitude: 0,
    endLongitude: 0.02,
    durationMinutes: 10,
    assumedWaitMinutes: 5,
    boardingBufferMinutes: 2,
    source: "osm",
    sourceId: "way/1",
    sourceUrl: null,
    operator: null,
    timetableUrl: null,
    bicycleAccess: "unknown",
    providerRefs: {
      [OSM_FERRY_GEOMETRY_PROVIDER_REF]: encodeOSMFerryGeometry([
        { latitude: 0, longitude: 0.01 },
        { latitude: 0.02, longitude: 0.015 },
        { latitude: 0, longitude: 0.02 },
      ])!,
    },
    tags: {},
    createdAt: "2026-07-18T00:00:00.000Z",
    updatedAt: "2026-07-18T00:00:00.000Z",
    ...overrides,
  };
}

describe("ferry map route composition", () => {
  it("removes the raw ferry interval from base route pieces and uses the OSM curve map-only", () => {
    const rawTerrainPoint = point(2, 1_500, 0.1, 0.015);
    const points = [
      point(0, 0),
      point(1, 1_000),
      rawTerrainPoint,
      point(3, 2_000),
      point(4, 3_000),
    ];
    const snapshot = points.map((routePoint) => ({ ...routePoint }));

    const composition = buildFerryMapRouteComposition(points, [crossing()]);

    expect(composition.landPieces).toHaveLength(2);
    expect(
      composition.landPieces[0].map((routePoint) => routePoint.distanceFromStartMeters),
    ).toEqual([0, 1_000]);
    expect(
      composition.landPieces[1].map((routePoint) => routePoint.distanceFromStartMeters),
    ).toEqual([2_000, 3_000]);
    expect(composition.landPieces.flat()).not.toContain(rawTerrainPoint);
    expect(composition.displayPoints.map((routePoint) => routePoint.latitude)).toEqual([
      0, 0, 0.02, 0, 0,
    ]);
    expect(composition.displayPoints).not.toContain(rawTerrainPoint);
    expect(composition.displayPoints[0]).toBe(points[0]);
    expect(composition.displayPoints.at(-1)).toBe(points.at(-1));
    expect(points).toEqual(snapshot);
    expect(points[2]).toBe(rawTerrainPoint);
  });

  it("builds land-only geometry without a full display composition", () => {
    const points = [
      point(0, 0),
      point(1, 1_000),
      point(2, 1_500, 0.1),
      point(3, 2_000),
      point(4, 3_000),
    ];

    const manual = crossing({ source: "manual", sourceId: null, providerRefs: {} });
    const haversineSpy = vi.spyOn(geo, "haversineDistance");

    const pieces = buildFerryMapLandPieces(points, [manual]);

    expect(pieces).toHaveLength(2);
    expect(pieces[0][0]).toBe(points[0]);
    expect(pieces[1].at(-1)).toBe(points.at(-1));
    expect(pieces.flat().map((routePoint) => routePoint.distanceFromStartMeters)).toEqual([
      0, 1_000, 2_000, 3_000,
    ]);
    // Continuous display construction measures the replacement ferry geometry.
    // The land-only path must never enter that work.
    expect(haversineSpy).not.toHaveBeenCalled();
    buildFerryMapDisplayPoints(points, [manual]);
    expect(haversineSpy).toHaveBeenCalled();
  });

  it("reuses every unchanged source point in continuous display geometry", () => {
    const points = [
      point(0, 0),
      point(1, 500),
      point(2, 1_000),
      point(3, 1_500, 0.1),
      point(4, 2_000),
      point(5, 2_500),
      point(6, 3_000),
    ];

    const displayed = buildFerryMapDisplayPoints(points, [crossing()]);

    expect(displayed[0]).toBe(points[0]);
    expect(displayed[1]).toBe(points[1]);
    expect(displayed.at(-2)).toBe(points[5]);
    expect(displayed.at(-1)).toBe(points[6]);
    expect(displayed).not.toContain(points[2]);
    expect(displayed).not.toContain(points[3]);
    expect(displayed).not.toContain(points[4]);
    expect(displayed.filter((routePoint) => points.includes(routePoint))).toHaveLength(4);
  });

  it("returns the original arrays when no ferry intersects the route", () => {
    const points = [point(0, 0), point(1, 1_000)];

    expect(buildFerryMapLandPieces(points, [])).toEqual([points]);
    expect(buildFerryMapLandPieces(points, [crossing()])[0]).toBe(points);
    expect(buildFerryMapDisplayPoints(points, [])).toBe(points);
    expect(buildFerryMapDisplayPoints(points, [crossing()])).toBe(points);
  });

  it("uses an interpolated manual endpoint chord while still removing raw interior points", () => {
    const points = [point(0, 0), point(1, 1_000), point(2, 2_000), point(3, 3_000)];
    const manual = crossing({
      source: "manual",
      sourceId: null,
      providerRefs: {},
      startDistanceMeters: 750,
      endDistanceMeters: 2_250,
      effectiveStartDistanceMeters: 750 as DisplayFerryCrossing["effectiveStartDistanceMeters"],
      effectiveEndDistanceMeters: 2_250 as DisplayFerryCrossing["effectiveEndDistanceMeters"],
      startLongitude: 0.0075,
      endLongitude: 0.0225,
    });

    const composition = buildFerryMapRouteComposition(points, [manual]);

    expect(
      composition.landPieces.map((piece) => piece.map((item) => item.distanceFromStartMeters)),
    ).toEqual([
      [0, 750],
      [2_250, 3_000],
    ]);
    expect(composition.displayPoints.map((item) => item.distanceFromStartMeters)).toEqual([
      0, 750, 2_250, 3_000,
    ]);
  });

  it("uses effective stitched distances instead of raw source-route distances", () => {
    const points = [
      point(0, 10_000),
      point(1, 11_000),
      point(2, 11_500, 0.1),
      point(3, 12_000),
      point(4, 13_000),
    ];
    const stitched = crossing({
      startDistanceMeters: 100,
      endDistanceMeters: 200,
      effectiveStartDistanceMeters: 11_000 as DisplayFerryCrossing["effectiveStartDistanceMeters"],
      effectiveEndDistanceMeters: 12_000 as DisplayFerryCrossing["effectiveEndDistanceMeters"],
    });

    const composition = buildFerryMapRouteComposition(points, [stitched]);

    expect(
      composition.landPieces.map((piece) => piece.map((item) => item.distanceFromStartMeters)),
    ).toEqual([
      [10_000, 11_000],
      [12_000, 13_000],
    ]);
    expect(composition.displayPoints.map((item) => item.distanceFromStartMeters)).toEqual([
      10_000, 11_000, 11_500, 12_000, 13_000,
    ]);
    expect(composition.displayPoints[2].latitude).toBe(0.02);
  });

  it("splits the active route while keeping one precomposed inactive ferry line", () => {
    const rawTerrainPoint = point(2, 1_500, 0.1, 0.015);
    const activePoints = [
      point(0, 0),
      point(1, 1_000),
      rawTerrainPoint,
      point(3, 2_000),
      point(4, 3_000),
    ];
    const inactiveRawTerrainPoint = point(2, 1_500, 0.2, 0.015);
    const inactivePoints = [
      point(0, 0),
      point(1, 1_000),
      inactiveRawTerrainPoint,
      point(3, 2_000),
      point(4, 3_000),
    ];
    const inactiveLayer = {
      id: "variant-route",
      cacheKey: "variant-route:ferries:prepared",
      points: buildFerryMapRouteComposition(inactivePoints, [crossing()]).displayPoints,
      isActive: false,
    };

    const layers = buildFerryAwarePreviewLayers(
      [
        { id: "active-route", cacheKey: "active-route", points: activePoints, isActive: true },
        inactiveLayer,
      ],
      [crossing()],
    );

    expect(layers.map((layer) => layer.id)).toEqual([
      "active-route",
      "active-route-land-1",
      "variant-route",
    ]);
    expect(layers[0].points.map((routePoint) => routePoint.distanceFromStartMeters)).toEqual([
      0, 1_000,
    ]);
    expect(layers[1].points.map((routePoint) => routePoint.distanceFromStartMeters)).toEqual([
      2_000, 3_000,
    ]);
    expect(layers[0].cacheKey).toContain("active-route:ferries:");
    expect(layers.flatMap((layer) => layer.points)).not.toContain(rawTerrainPoint);
    expect(layers.filter((layer) => layer.id === "variant-route")).toHaveLength(1);
    expect(layers[2].points).not.toContain(inactiveRawTerrainPoint);
    expect(layers[2].points.map((routePoint) => routePoint.latitude)).toEqual([0, 0, 0.02, 0, 0]);
  });

  it("selects only ferries fully contained in a collection segment range", () => {
    const inside = crossing();
    const straddling = crossing({
      id: "straddling",
      effectiveStartDistanceMeters: 1_900 as DisplayFerryCrossing["effectiveStartDistanceMeters"],
      effectiveEndDistanceMeters: 2_500 as DisplayFerryCrossing["effectiveEndDistanceMeters"],
    });

    expect(ferriesContainedInDistanceRange([inside, straddling], 0, 2_000)).toEqual([inside]);
  });
});
