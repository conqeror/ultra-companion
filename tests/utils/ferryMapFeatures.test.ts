import { describe, expect, it } from "vitest";
import {
  buildFerryMapFeatureCollections,
  emptyFerryMapFeatureCollections,
} from "@/utils/ferryMapFeatures";
import { encodeOSMFerryGeometry, OSM_FERRY_GEOMETRY_PROVIDER_REF } from "@/services/ferryGeometry";
import type { DisplayFerryCrossing } from "@/types";

function crossing(overrides: Partial<DisplayFerryCrossing> = {}): DisplayFerryCrossing {
  return {
    id: "ferry-1",
    routeId: "route-1",
    name: "Harbour ferry",
    startDistanceMeters: 2_000,
    endDistanceMeters: 5_000,
    effectiveStartDistanceMeters: 12_000 as DisplayFerryCrossing["effectiveStartDistanceMeters"],
    effectiveEndDistanceMeters: 15_000 as DisplayFerryCrossing["effectiveEndDistanceMeters"],
    startLatitude: 60,
    startLongitude: 5,
    endLatitude: 60.2,
    endLongitude: 5.4,
    durationMinutes: 20,
    assumedWaitMinutes: 15,
    boardingBufferMinutes: 5,
    source: "manual",
    sourceId: null,
    sourceUrl: null,
    operator: null,
    timetableUrl: null,
    bicycleAccess: "unknown",
    providerRefs: {},
    tags: {},
    createdAt: "2026-07-18T00:00:00.000Z",
    updatedAt: "2026-07-18T00:00:00.000Z",
    ...overrides,
  };
}

describe("ferryMapFeatures", () => {
  it("returns reusable empty collections when no crossings are available", () => {
    expect(buildFerryMapFeatureCollections(null)).toEqual(emptyFerryMapFeatureCollections());
    expect(buildFerryMapFeatureCollections([])).toEqual(emptyFerryMapFeatureCollections());
  });

  it("builds an aligned crossing line, two role markers, and a midpoint name label", () => {
    const features = buildFerryMapFeatureCollections([crossing()]);

    expect(features.lines.features).toEqual([
      {
        type: "Feature",
        properties: {
          crossingId: "ferry-1",
          occurrenceKey: "ferry-1:12000.0:0",
          name: "Harbour ferry",
          sortKey: 0,
        },
        geometry: {
          type: "LineString",
          coordinates: [
            [5, 60],
            [5.4, 60.2],
          ],
        },
      },
    ]);
    expect(features.endpoints.features.map((feature) => feature.properties)).toEqual([
      expect.objectContaining({ role: "boarding", label: "B", roleLabel: "Board", sortKey: 0 }),
      expect.objectContaining({ role: "landing", label: "L", roleLabel: "Land", sortKey: 1 }),
    ]);
    expect(features.endpoints.features.map((feature) => feature.geometry.coordinates)).toEqual([
      [5, 60],
      [5.4, 60.2],
    ]);
    expect(features.labels.features[0]).toMatchObject({
      properties: { label: "Harbour ferry" },
      geometry: { type: "Point", coordinates: [5.2, 60.1] },
    });
  });

  it("gives repeated collection occurrences unique keys and deterministic sort order", () => {
    const repeated = crossing({
      effectiveStartDistanceMeters: 42_000 as DisplayFerryCrossing["effectiveStartDistanceMeters"],
      effectiveEndDistanceMeters: 45_000 as DisplayFerryCrossing["effectiveEndDistanceMeters"],
    });

    const features = buildFerryMapFeatureCollections([crossing(), repeated]);

    expect(features.lines.features.map((feature) => feature.properties.occurrenceKey)).toEqual([
      "ferry-1:12000.0:0",
      "ferry-1:42000.0:1",
    ]);
    expect(features.endpoints.features.map((feature) => feature.properties.sortKey)).toEqual([
      0, 1, 2, 3,
    ]);
  });

  it("renders the saved OSM curve and places its name at half arclength", () => {
    const features = buildFerryMapFeatureCollections([
      crossing({
        endLatitude: 60,
        providerRefs: {
          [OSM_FERRY_GEOMETRY_PROVIDER_REF]: encodeOSMFerryGeometry([
            { latitude: 60, longitude: 5 },
            { latitude: 60.2, longitude: 5.2 },
            { latitude: 60, longitude: 5.4 },
          ])!,
        },
      }),
    ]);

    expect(features.lines.features[0].geometry.coordinates).toEqual([
      [5, 60],
      [5.2, 60.2],
      [5.4, 60],
    ]);
    expect(features.labels.features[0].geometry.coordinates[0]).toBeCloseTo(5.2, 3);
    expect(features.labels.features[0].geometry.coordinates[1]).toBeCloseTo(60.2, 3);
  });

  it("falls back to endpoint geometry when stored provider JSON is invalid", () => {
    const features = buildFerryMapFeatureCollections([
      crossing({ providerRefs: { [OSM_FERRY_GEOMETRY_PROVIDER_REF]: "invalid" } }),
    ]);

    expect(features.lines.features[0].geometry.coordinates).toEqual([
      [5, 60],
      [5.4, 60.2],
    ]);
  });

  it("skips invalid coordinates and provides a fallback for a blank legacy name", () => {
    const features = buildFerryMapFeatureCollections([
      crossing({ id: "invalid", startLatitude: Number.NaN }),
      crossing({ id: "blank", name: "  " }),
    ]);

    expect(features.lines.features).toHaveLength(1);
    expect(features.lines.features[0].properties).toMatchObject({
      crossingId: "blank",
      name: "Ferry crossing",
    });
    expect(features.labels.features[0].properties.label).toBe("Ferry crossing");
  });

  it("places a dateline-crossing label near the crossing instead of Greenwich", () => {
    const features = buildFerryMapFeatureCollections([
      crossing({ startLongitude: 179, endLongitude: -179 }),
    ]);

    expect(Math.abs(features.labels.features[0].geometry.coordinates[0])).toBe(180);
  });
});
