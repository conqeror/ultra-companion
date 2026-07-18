import { describe, expect, it, vi } from "vitest";
import { DEFAULT_POWER_CONFIG } from "@/constants";
import {
  buildCollectionVariantPreviewOverlays,
  collectionVariantKey,
  loadCollectionVariantDisplayData,
} from "@/services/collectionVariantGeometry";
import { encodeOSMFerryGeometry, OSM_FERRY_GEOMETRY_PROVIDER_REF } from "@/services/ferryGeometry";
import { MAX_VARIANT_MAP_GEOJSON_POINTS } from "@/utils/geo";
import type { CollectionSegmentWithRoute, FerryCrossing, Route, RoutePoint } from "@/types";

const points = (id: number, length = 1_000): RoutePoint[] => [
  { latitude: id, longitude: 0, elevationMeters: 100, distanceFromStartMeters: 0, idx: 0 },
  {
    latitude: id + 0.01,
    longitude: 0.01,
    elevationMeters: 120,
    distanceFromStartMeters: length,
    idx: 1,
  },
];

const route = (id: string, length = 1_000): Route => ({
  id,
  name: id,
  fileName: `${id}.gpx`,
  color: "#fff",
  isActive: false,
  isVisible: true,
  totalDistanceMeters: length,
  totalAscentMeters: 20,
  totalDescentMeters: 0,
  pointCount: 2,
  createdAt: "2026-01-01T00:00:00.000Z",
});

const segment = (
  routeId: string,
  position: number,
  options: Partial<CollectionSegmentWithRoute["segment"]> = {},
): CollectionSegmentWithRoute => ({
  route: route(routeId),
  segment: {
    collectionId: "c1",
    routeId,
    position,
    isSelected: false,
    variantKind: "full",
    baseRouteId: null,
    replaceStartDistanceMeters: null,
    replaceEndDistanceMeters: null,
    ...options,
  },
});

const ferry = (
  routeId: string,
  startDistanceMeters: number,
  endDistanceMeters: number,
  geometry: Array<{ latitude: number; longitude: number }>,
): FerryCrossing => ({
  id: `ferry-${routeId}`,
  routeId,
  name: `${routeId} ferry`,
  startDistanceMeters,
  endDistanceMeters,
  startLatitude: geometry[0].latitude,
  startLongitude: geometry[0].longitude,
  endLatitude: geometry[geometry.length - 1].latitude,
  endLongitude: geometry[geometry.length - 1].longitude,
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
    [OSM_FERRY_GEOMETRY_PROVIDER_REF]: encodeOSMFerryGeometry(geometry)!,
  },
  tags: {},
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

describe("loadCollectionVariantDisplayData", () => {
  it("builds a bounded inactive preview without mutating selected or variant route points", () => {
    const selected = segment("selected", 0, { isSelected: true });
    const alternative = segment("alternative", 0);
    const selectedPoints = points(1, 3_000);
    const rawTerrainPoint: RoutePoint = {
      latitude: 0.2,
      longitude: 0.015,
      elevationMeters: 900,
      distanceFromStartMeters: 1_500,
      idx: 2,
    };
    const alternativePoints: RoutePoint[] = [
      { latitude: 0, longitude: 0, elevationMeters: 100, distanceFromStartMeters: 0, idx: 0 },
      {
        latitude: 0,
        longitude: 0.01,
        elevationMeters: 100,
        distanceFromStartMeters: 1_000,
        idx: 1,
      },
      rawTerrainPoint,
      {
        latitude: 0,
        longitude: 0.02,
        elevationMeters: 100,
        distanceFromStartMeters: 2_000,
        idx: 3,
      },
      {
        latitude: 0,
        longitude: 0.03,
        elevationMeters: 100,
        distanceFromStartMeters: 3_000,
        idx: 4,
      },
    ];
    const selectedSnapshot = selectedPoints.map((routePoint) => ({ ...routePoint }));
    const alternativeSnapshot = alternativePoints.map((routePoint) => ({ ...routePoint }));

    const overlays = buildCollectionVariantPreviewOverlays(
      [selected, alternative],
      { selected: selectedPoints, alternative: alternativePoints },
      {
        alternative: [
          ferry("alternative", 1_000, 2_000, [
            { latitude: 0, longitude: 0.01 },
            { latitude: 0.02, longitude: 0.015 },
            { latitude: 0, longitude: 0.02 },
          ]),
        ],
      },
    );
    const coordinates = overlays[collectionVariantKey(alternative)].geoJSON.geometry.coordinates;

    expect(Object.keys(overlays)).toEqual([collectionVariantKey(alternative)]);
    expect(coordinates).toContainEqual([0.015, 0.02]);
    expect(coordinates).not.toContainEqual([0.015, 0.2]);
    expect(coordinates.length).toBeLessThanOrEqual(MAX_VARIANT_MAP_GEOJSON_POINTS);
    expect(selectedPoints).toEqual(selectedSnapshot);
    expect(alternativePoints).toEqual(alternativeSnapshot);
    expect(alternativePoints[2]).toBe(rawTerrainPoint);
  });

  it("does not query any geometry for collection positions without variants", async () => {
    const loadRoutePoints = vi.fn<(routeId: string) => Promise<RoutePoint[]>>();

    const result = await loadCollectionVariantDisplayData(
      [segment("r1", 0, { isSelected: true }), segment("r2", 1, { isSelected: true })],
      DEFAULT_POWER_CONFIG,
      loadRoutePoints,
    );

    expect(loadRoutePoints).not.toHaveBeenCalled();
    expect(result).toEqual({ metricsByKey: {}, overlaysByKey: {} });
  });

  it("loads only a variant position and retains only its alternative overlay", async () => {
    const selected = segment("r1", 0, { isSelected: true });
    const alternative = segment("r1-alt", 0);
    const unrelated = segment("r2", 1, { isSelected: true });
    const geometry = { r1: points(1), "r1-alt": points(2), r2: points(3) };
    const loadRoutePoints = vi.fn(
      async (routeId: string) => geometry[routeId as keyof typeof geometry],
    );

    const result = await loadCollectionVariantDisplayData(
      [selected, alternative, unrelated],
      DEFAULT_POWER_CONFIG,
      loadRoutePoints,
    );

    expect(loadRoutePoints.mock.calls.map(([routeId]) => routeId)).toEqual(["r1", "r1-alt"]);
    expect(result.metricsByKey).toEqual(
      expect.objectContaining({
        [collectionVariantKey(selected)]: expect.any(Object),
        [collectionVariantKey(alternative)]: expect.any(Object),
      }),
    );
    expect(
      result.overlaysByKey[collectionVariantKey(alternative)]?.geoJSON.geometry.coordinates,
    ).toEqual([
      [0, 2],
      [0.01, 2.01],
    ]);
    expect(result.overlaysByKey[collectionVariantKey(alternative)]?.labelCoordinate).toEqual([
      0.005, 2.005,
    ]);
  });

  it("loads a patch base only when that variant needs it and slices the full-route overlay", async () => {
    const base = segment("base", 0);
    const patch = segment("patch", 0, {
      isSelected: true,
      variantKind: "patch",
      baseRouteId: "base",
      replaceStartDistanceMeters: 250,
      replaceEndDistanceMeters: 750,
    });
    const basePoints = [
      { latitude: 0, longitude: 0, elevationMeters: 100, distanceFromStartMeters: 0, idx: 0 },
      { latitude: 0, longitude: 0.01, elevationMeters: 120, distanceFromStartMeters: 500, idx: 1 },
      {
        latitude: 0,
        longitude: 0.02,
        elevationMeters: 140,
        distanceFromStartMeters: 1_000,
        idx: 2,
      },
    ];
    const loadRoutePoints = vi.fn(async (routeId: string) =>
      routeId === "base" ? basePoints : points(1, 500),
    );

    const result = await loadCollectionVariantDisplayData(
      [base, patch],
      DEFAULT_POWER_CONFIG,
      loadRoutePoints,
    );

    expect(loadRoutePoints.mock.calls.map(([routeId]) => routeId)).toEqual(["base", "patch"]);
    expect(result.overlaysByKey[collectionVariantKey(base)]?.geoJSON.geometry.coordinates).toEqual([
      [0.005, 0],
      [0.015, 0],
    ]);
    expect(result.overlaysByKey[collectionVariantKey(base)]?.labelCoordinate).toEqual([0.01, 0]);
  });

  it("replaces a raw variant ferry span with its OSM curve and keys geometry changes", async () => {
    const selected = segment("selected", 0, { isSelected: true });
    const alternative = segment("alternative", 0);
    const alternativePoints: RoutePoint[] = [
      { latitude: 0, longitude: 0, elevationMeters: 100, distanceFromStartMeters: 0, idx: 0 },
      {
        latitude: 0,
        longitude: 0.01,
        elevationMeters: 100,
        distanceFromStartMeters: 1_000,
        idx: 1,
      },
      {
        latitude: 0.2,
        longitude: 0.015,
        elevationMeters: 900,
        distanceFromStartMeters: 1_500,
        idx: 2,
      },
      {
        latitude: 0,
        longitude: 0.02,
        elevationMeters: 100,
        distanceFromStartMeters: 2_000,
        idx: 3,
      },
      {
        latitude: 0,
        longitude: 0.03,
        elevationMeters: 100,
        distanceFromStartMeters: 3_000,
        idx: 4,
      },
    ];
    const routeGeometry = {
      selected: points(1, 3_000),
      alternative: alternativePoints,
    };
    const loadRoutePoints = vi.fn(
      async (routeId: string) => routeGeometry[routeId as keyof typeof routeGeometry],
    );
    let curveLatitude = 0.02;
    const loadRouteFerries = vi.fn(async (routeId: string) =>
      routeId === "alternative"
        ? [
            ferry("alternative", 1_000, 2_000, [
              { latitude: 0, longitude: 0.01 },
              { latitude: curveLatitude, longitude: 0.015 },
              { latitude: 0, longitude: 0.02 },
            ]),
          ]
        : [],
    );

    const first = await loadCollectionVariantDisplayData(
      [selected, alternative],
      DEFAULT_POWER_CONFIG,
      loadRoutePoints,
      { loadRouteFerries },
    );
    curveLatitude = 0.03;
    const second = await loadCollectionVariantDisplayData(
      [selected, alternative],
      DEFAULT_POWER_CONFIG,
      loadRoutePoints,
      { loadRouteFerries },
    );
    const key = collectionVariantKey(alternative);
    const firstOverlay = first.overlaysByKey[key];
    const secondOverlay = second.overlaysByKey[key];

    expect(firstOverlay.geoJSON.geometry.coordinates).toContainEqual([0.015, 0.02]);
    expect(firstOverlay.geoJSON.geometry.coordinates).not.toContainEqual([0.015, 0.2]);
    expect(firstOverlay.labelCoordinate).toEqual([0.015, 0.02]);
    expect(secondOverlay.geoJSON.geometry.coordinates).toContainEqual([0.015, 0.03]);
    expect(secondOverlay.cacheKey).not.toBe(firstOverlay.cacheKey);
    expect(firstOverlay.cacheKey).toContain(":ferries:");
  });

  it("projects effective patch ferries back into patch-overlay distance space", async () => {
    const base = segment("base", 0, { isSelected: true });
    const patch = segment("patch", 0, {
      variantKind: "patch",
      baseRouteId: "base",
      replaceStartDistanceMeters: 250,
      replaceEndDistanceMeters: 750,
    });
    const patchPoints: RoutePoint[] = [
      { latitude: 0, longitude: 1, elevationMeters: 100, distanceFromStartMeters: 0, idx: 0 },
      {
        latitude: 0.2,
        longitude: 1.0025,
        elevationMeters: 700,
        distanceFromStartMeters: 250,
        idx: 1,
      },
      {
        latitude: 0,
        longitude: 1.005,
        elevationMeters: 100,
        distanceFromStartMeters: 500,
        idx: 2,
      },
    ];
    const patchFerry = ferry("patch", 100, 400, [
      { latitude: 0, longitude: 1.001 },
      { latitude: 0.03, longitude: 1.0025 },
      { latitude: 0, longitude: 1.004 },
    ]);

    const result = await loadCollectionVariantDisplayData(
      [base, patch],
      DEFAULT_POWER_CONFIG,
      async (routeId) => (routeId === "patch" ? patchPoints : points(0, 1_000)),
      { loadRouteFerries: async (routeId) => (routeId === "patch" ? [patchFerry] : []) },
    );
    const overlay = result.overlaysByKey[collectionVariantKey(patch)];

    expect(overlay.geoJSON.geometry.coordinates).toContainEqual([1.0025, 0.03]);
    expect(overlay.geoJSON.geometry.coordinates).not.toContainEqual([1.0025, 0.2]);
  });

  it("keeps ferry bends while bounding a long variant overlay", async () => {
    const selected = segment("selected", 0, { isSelected: true });
    const alternative = segment("long", 0);
    const longPoints = Array.from(
      { length: 40_001 },
      (_, index): RoutePoint => ({
        latitude: 0,
        longitude: index / 1_000_000,
        elevationMeters: 100,
        distanceFromStartMeters: index * 10,
        idx: index,
      }),
    );
    const longFerry = ferry("long", 200_000, 200_020, [
      { latitude: 0, longitude: 0.02 },
      { latitude: 0.05, longitude: 0.020001 },
      { latitude: 0, longitude: 0.020002 },
    ]);

    const result = await loadCollectionVariantDisplayData(
      [selected, alternative],
      DEFAULT_POWER_CONFIG,
      async (routeId) => (routeId === "long" ? longPoints : points(1, 400_000)),
      { loadRouteFerries: async (routeId) => (routeId === "long" ? [longFerry] : []) },
    );
    const coordinates =
      result.overlaysByKey[collectionVariantKey(alternative)].geoJSON.geometry.coordinates;

    expect(coordinates.length).toBeLessThanOrEqual(MAX_VARIANT_MAP_GEOJSON_POINTS);
    expect(coordinates).toContainEqual([0.020001, 0.05]);
  });
});
