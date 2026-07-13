import { describe, expect, it, vi } from "vitest";
import { DEFAULT_POWER_CONFIG } from "@/constants";
import {
  collectionVariantKey,
  loadCollectionVariantDisplayData,
} from "@/services/collectionVariantGeometry";
import type { CollectionSegmentWithRoute, Route, RoutePoint } from "@/types";

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

describe("loadCollectionVariantDisplayData", () => {
  it("does not query any geometry for collection positions without variants", async () => {
    const loadRoutePoints = vi.fn<(routeId: string) => Promise<RoutePoint[]>>();

    const result = await loadCollectionVariantDisplayData(
      [segment("r1", 0, { isSelected: true }), segment("r2", 1, { isSelected: true })],
      DEFAULT_POWER_CONFIG,
      loadRoutePoints,
    );

    expect(loadRoutePoints).not.toHaveBeenCalled();
    expect(result).toEqual({ metricsByKey: {}, overlayPointsByKey: {} });
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
    expect(result.overlayPointsByKey).toEqual({
      [collectionVariantKey(alternative)]: geometry["r1-alt"],
    });
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
    expect(
      result.overlayPointsByKey[collectionVariantKey(base)]?.map(
        (point) => point.distanceFromStartMeters,
      ),
    ).toEqual([250, 500, 750]);
  });
});
