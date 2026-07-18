import { describe, expect, it } from "vitest";
import {
  preparedRouteGeometryMatchesRequest,
  preparedRouteGeometryMatchesSource,
  preparedRouteGeometryRequestListsMatchSource,
  type PreparedRouteGeometry,
  type PreparedRouteGeometryRequest,
} from "@/hooks/usePreparedRouteGeometries";
import type { RoutePoint } from "@/types";

function point(idx: number, distanceFromStartMeters: number): RoutePoint {
  return {
    latitude: idx,
    longitude: idx * 2,
    elevationMeters: null,
    distanceFromStartMeters,
    idx,
  };
}

const points = [point(0, 0), point(1, 100), point(2, 200)];

function request(
  overrides: Partial<PreparedRouteGeometryRequest> = {},
): PreparedRouteGeometryRequest {
  return {
    id: "route-1",
    cacheKey: "route-1:preview",
    points,
    toleranceMeters: 20,
    startPointIndex: 0,
    endPointIndex: 2,
    maxPoints: 1_000,
    ...overrides,
  };
}

function prepared(overrides: Partial<PreparedRouteGeometry> = {}): PreparedRouteGeometry {
  return {
    id: "route-1",
    cacheKey: "route-1:preview",
    points,
    toleranceMeters: 20,
    startPointIndex: 0,
    endPointIndex: 2,
    maxPoints: 1_000,
    geoJSON: {
      type: "Feature",
      properties: {},
      geometry: {
        type: "LineString",
        coordinates: points.map((routePoint) => [routePoint.longitude, routePoint.latitude]),
      },
    },
    ...overrides,
  };
}

describe("prepared route geometry source matching", () => {
  it("keeps matching the same source across simplification tolerance changes", () => {
    const geometry = prepared();

    expect(preparedRouteGeometryMatchesSource(geometry, request())).toBe(true);
    expect(preparedRouteGeometryMatchesRequest(geometry, request())).toBe(true);

    const refinedRequest = request({ toleranceMeters: 2 });
    expect(preparedRouteGeometryMatchesSource(geometry, refinedRequest)).toBe(true);
    expect(preparedRouteGeometryMatchesRequest(geometry, refinedRequest)).toBe(false);
  });

  it.each([
    ["cache key", { cacheKey: "route-1:changed" }],
    ["points reference", { points: [...points] }],
    ["start range", { startPointIndex: 1 }],
    ["end range", { endPointIndex: 1 }],
    ["point budget", { maxPoints: 500 }],
  ] satisfies [string, Partial<PreparedRouteGeometryRequest>][])(
    "rejects a changed %s",
    (_label, overrides) => {
      expect(preparedRouteGeometryMatchesSource(prepared(), request(overrides))).toBe(false);
    },
  );

  it("rejects missing prepared geometry", () => {
    expect(preparedRouteGeometryMatchesSource(undefined, request())).toBe(false);
  });
});

describe("prepared route geometry request-list source matching", () => {
  it("matches ordered requests when only their tolerances change", () => {
    const secondPoints = [point(3, 300), point(4, 400)];
    const previous = [
      request(),
      request({ id: "route-2", cacheKey: "route-2:preview", points: secondPoints }),
    ];
    const refined = previous.map((entry) => Object.assign({}, entry, { toleranceMeters: 2 }));

    expect(preparedRouteGeometryRequestListsMatchSource(previous, refined)).toBe(true);
  });

  it("rejects reordered, renamed, resized, or source-changed request lists", () => {
    const second = request({ id: "route-2", cacheKey: "route-2:preview" });
    const original = [request(), second];

    expect(preparedRouteGeometryRequestListsMatchSource(original, [second, request()])).toBe(false);
    expect(
      preparedRouteGeometryRequestListsMatchSource(original, [request({ id: "renamed" }), second]),
    ).toBe(false);
    expect(preparedRouteGeometryRequestListsMatchSource(original, [request()])).toBe(false);
    expect(
      preparedRouteGeometryRequestListsMatchSource(original, [request({ maxPoints: 500 }), second]),
    ).toBe(false);
  });
});
