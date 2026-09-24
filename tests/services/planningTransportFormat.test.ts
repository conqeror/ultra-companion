import { describe, expect, it } from "vitest";
import {
  normalizeCollectionSegment,
  normalizePOI,
  normalizeSQLiteTransportBytes,
  parsePlannerFetchedSources,
  parsePlanningTransportVersion,
} from "@/services/planningTransportFormat";
import { buildPoi } from "@/tests/fixtures/poi";

describe("shared planning transport format", () => {
  it.each([1, 2])("accepts supported transport version %s", (version) => {
    expect(parsePlanningTransportVersion(String(version))).toBe(version);
  });

  it.each([null, "invalid", "3"])("rejects unsupported transport version %s", (version) => {
    expect(() => parsePlanningTransportVersion(version)).toThrow(
      "Unsupported planning database version",
    );
  });

  it("normalizes WAL header bytes without mutating the input database", () => {
    const bytes = new Uint8Array(100);
    bytes.set(new TextEncoder().encode("SQLite format 3\0"));
    bytes[18] = 2;
    bytes[19] = 2;
    bytes[50] = 42;

    const normalized = normalizeSQLiteTransportBytes(bytes);

    expect(normalized).not.toBe(bytes);
    expect(normalized[18]).toBe(1);
    expect(normalized[19]).toBe(1);
    expect(normalized[50]).toBe(42);
    expect(bytes[18]).toBe(2);
    expect(bytes[19]).toBe(2);
    expect(normalizeSQLiteTransportBytes(normalized)).toBe(normalized);
  });

  it("leaves unrelated bytes untouched", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    expect(normalizeSQLiteTransportBytes(bytes)).toBe(bytes);
  });

  it("preserves fetched-source metadata filtering and its empty fallback", () => {
    expect(parsePlannerFetchedSources(null)).toEqual([]);
    expect(parsePlannerFetchedSources("invalid JSON")).toEqual([]);
    expect(
      parsePlannerFetchedSources(
        JSON.stringify([
          { routeId: "route-1", source: "osm" },
          { routeId: "route-1", source: "google" },
          { routeId: "route-1", source: "custom" },
          { routeId: "", source: "osm" },
        ]),
      ),
    ).toEqual([
      { routeId: "route-1", source: "osm" },
      { routeId: "route-1", source: "google" },
    ]);
  });

  it("decodes serialized POI tags and tolerates malformed stored JSON", () => {
    const poi = buildPoi("poi-1", "route-1", 100);
    expect(normalizePOI({ ...poi, tags: '{"notes":"Refill"}' }).tags).toEqual({ notes: "Refill" });
    expect(normalizePOI({ ...poi, tags: "broken" }).tags).toEqual({});
  });

  it("normalizes legacy collection variant flags consistently", () => {
    const segment = {
      collectionId: "collection",
      routeId: "route",
      position: 0,
      isSelected: 1,
      variantKind: "legacy",
      baseRouteId: null,
      replaceStartDistanceMeters: null,
      replaceEndDistanceMeters: null,
    };
    expect(normalizeCollectionSegment(segment)).toEqual({
      ...segment,
      isSelected: true,
      variantKind: "full",
    });
  });
});
