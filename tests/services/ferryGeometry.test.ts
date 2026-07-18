import { describe, expect, it } from "vitest";
import {
  decodeOSMFerryGeometry,
  encodeOSMFerryGeometry,
  ferryMapGeometrySignature,
  MAX_OSM_FERRY_GEOMETRY_JSON_LENGTH,
  MAX_OSM_FERRY_GEOMETRY_POINTS,
  OSM_FERRY_GEOMETRY_PROVIDER_REF,
  orientFerryGeometry,
  resolveFerryMapGeometry,
} from "@/services/ferryGeometry";
import type { DisplayFerryCrossing } from "@/types";

function crossing(overrides: Partial<DisplayFerryCrossing> = {}): DisplayFerryCrossing {
  return {
    id: "ferry-1",
    routeId: "route-1",
    name: "Harbour ferry",
    startDistanceMeters: 1_000,
    endDistanceMeters: 2_000,
    effectiveStartDistanceMeters: 1_000 as DisplayFerryCrossing["effectiveStartDistanceMeters"],
    effectiveEndDistanceMeters: 2_000 as DisplayFerryCrossing["effectiveEndDistanceMeters"],
    startLatitude: 60,
    startLongitude: 5,
    endLatitude: 60,
    endLongitude: 5.1,
    durationMinutes: 20,
    assumedWaitMinutes: 15,
    boardingBufferMinutes: 5,
    source: "osm",
    sourceId: "way/1",
    sourceUrl: "https://www.openstreetmap.org/way/1",
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

describe("stored OSM ferry geometry", () => {
  it("encodes GeoJSON-order coordinates and decodes them safely", () => {
    const encoded = encodeOSMFerryGeometry([
      { latitude: 60, longitude: 5 },
      { latitude: 60.1, longitude: 5.2 },
    ]);

    expect(encoded).toBe("[[5,60],[5.2,60.1]]");
    expect(decodeOSMFerryGeometry({ [OSM_FERRY_GEOMETRY_PROVIDER_REF]: encoded! })).toEqual([
      { latitude: 60, longitude: 5 },
      { latitude: 60.1, longitude: 5.2 },
    ]);
  });

  it("rejects malformed, out-of-bounds, and oversized JSON before use", () => {
    expect(decodeOSMFerryGeometry({ [OSM_FERRY_GEOMETRY_PROVIDER_REF]: "not-json" })).toBeNull();
    expect(
      decodeOSMFerryGeometry({
        [OSM_FERRY_GEOMETRY_PROVIDER_REF]: JSON.stringify([
          [5, 60],
          [5.1, 91],
        ]),
      }),
    ).toBeNull();
    expect(
      decodeOSMFerryGeometry({
        [OSM_FERRY_GEOMETRY_PROVIDER_REF]: " ".repeat(MAX_OSM_FERRY_GEOMETRY_JSON_LENGTH + 1),
      }),
    ).toBeNull();
  });

  it("caps dense candidate geometry while preserving both endpoints", () => {
    const dense = Array.from({ length: MAX_OSM_FERRY_GEOMETRY_POINTS + 100 }, (_, index) => ({
      latitude: 60,
      longitude: 5 + index / 1_000_000,
    }));
    const encoded = encodeOSMFerryGeometry(dense);
    const decoded = decodeOSMFerryGeometry({
      [OSM_FERRY_GEOMETRY_PROVIDER_REF]: encoded!,
    });

    expect(decoded).toHaveLength(MAX_OSM_FERRY_GEOMETRY_POINTS);
    expect(decoded?.[0]).toEqual(dense[0]);
    expect(decoded?.at(-1)).toEqual(dense.at(-1));
  });

  it("orients reversed OSM geometry and forces exact snapped anchors without duplicates", () => {
    const reversed = [
      { latitude: 60.00001, longitude: 5.10001 },
      { latitude: 60.03, longitude: 5.06 },
      { latitude: 60.00001, longitude: 5.00001 },
    ];
    const oriented = orientFerryGeometry(
      reversed,
      { latitude: 60, longitude: 5 },
      { latitude: 60, longitude: 5.1 },
    );
    const ferry = crossing({
      providerRefs: {
        [OSM_FERRY_GEOMETRY_PROVIDER_REF]: encodeOSMFerryGeometry(reversed)!,
      },
    });

    expect(oriented.map((point) => point.longitude)).toEqual([5.00001, 5.06, 5.10001]);
    expect(resolveFerryMapGeometry(ferry)).toEqual([
      { latitude: 60, longitude: 5 },
      { latitude: 60.03, longitude: 5.06 },
      { latitude: 60, longitude: 5.1 },
    ]);
  });

  it("falls back to the snapped chord when stored endpoints are implausibly far away", () => {
    const ferry = crossing({
      providerRefs: {
        [OSM_FERRY_GEOMETRY_PROVIDER_REF]: JSON.stringify([
          [10, 65],
          [11, 66],
        ]),
      },
    });

    expect(resolveFerryMapGeometry(ferry)).toEqual([
      { latitude: 60, longitude: 5 },
      { latitude: 60, longitude: 5.1 },
    ]);
  });

  it("falls back when corrupt interior coordinates create a globe-spanning jump", () => {
    const ferry = crossing({
      providerRefs: {
        [OSM_FERRY_GEOMETRY_PROVIDER_REF]: JSON.stringify([
          [5, 60],
          [0, 0],
          [5.1, 60],
        ]),
      },
    });

    expect(resolveFerryMapGeometry(ferry)).toEqual([
      { latitude: 60, longitude: 5 },
      { latitude: 60, longitude: 5.1 },
    ]);
  });

  it("changes the map signature for geometry edits but not timing-only edits", () => {
    const geometry = encodeOSMFerryGeometry([
      { latitude: 60, longitude: 5 },
      { latitude: 60.02, longitude: 5.05 },
      { latitude: 60, longitude: 5.1 },
    ])!;
    const ferry = crossing({
      providerRefs: { [OSM_FERRY_GEOMETRY_PROVIDER_REF]: geometry },
    });

    expect(ferryMapGeometrySignature([{ ...ferry, durationMinutes: 99 }])).toBe(
      ferryMapGeometrySignature([ferry]),
    );
    expect(
      ferryMapGeometrySignature([
        {
          ...ferry,
          providerRefs: {
            [OSM_FERRY_GEOMETRY_PROVIDER_REF]: geometry.replace("5.05", "5.06"),
          },
        },
      ]),
    ).not.toBe(ferryMapGeometrySignature([ferry]));
  });
});
