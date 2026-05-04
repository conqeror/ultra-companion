import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildSavedPOI,
  findNearestSavedPOITarget,
  getGoogleMapsUrlForPOI,
  resolveGoogleMapsLink,
  type SavedPOITarget,
} from "@/services/savedPOIService";
import type { RoutePoint } from "@/types";

function routePoint(
  latitude: number,
  longitude: number,
  distanceFromStartMeters: number,
  idx: number,
): RoutePoint {
  return { latitude, longitude, elevationMeters: null, distanceFromStartMeters, idx };
}

const northSouthTarget: SavedPOITarget = {
  routeId: "route-a",
  routeName: "Route A",
  points: [routePoint(48.1, 17.1, 0, 0), routePoint(48.2, 17.1, 11_100, 1)],
};

const eastTarget: SavedPOITarget = {
  routeId: "route-b",
  routeName: "Route B",
  points: [routePoint(49.0, 18.0, 0, 0), routePoint(49.1, 18.0, 11_100, 1)],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("savedPOIService", () => {
  it("resolves coordinates from a Google Maps URL without requiring Places details", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    const result = await resolveGoogleMapsLink(
      "https://www.google.com/maps/place/Test/@48.1234567,17.7654321,17z",
    );

    expect(result.latitude).toBeCloseTo(48.1234567);
    expect(result.longitude).toBeCloseTo(17.7654321);
    expect(result.category).toBe("other");
    expect(result.tags.google_maps_url).toContain("google.com/maps");
  });

  it("chooses the nearest selected route target for collection saves", () => {
    const nearest = findNearestSavedPOITarget(48.15, 17.101, [eastTarget, northSouthTarget]);

    expect(nearest?.target.routeId).toBe("route-a");
    expect(nearest?.distanceFromRouteMeters).toBeLessThan(100);
  });

  it("builds a durable custom POI associated with route distance", () => {
    const poi = buildSavedPOI(
      {
        sourceId: "google:place-123",
        name: "Known Station",
        category: "gas_station",
        latitude: 48.15,
        longitude: 17.101,
        notes: "24/7",
        tags: { google_place_id: "place-123" },
      },
      northSouthTarget,
    );

    expect(poi.id).toContain("route-a_custom_google_place-123");
    expect(poi.source).toBe("custom");
    expect(poi.routeId).toBe("route-a");
    expect(poi.tags.notes).toBe("24/7");
    expect(poi.distanceAlongRouteMeters).toBeGreaterThan(0);
    expect(poi.distanceFromRouteMeters).toBeLessThan(100);
  });

  it("builds a Google Maps URL for saved place identity", () => {
    const poi = buildSavedPOI(
      {
        sourceId: "google:place-123",
        name: "Known Station",
        category: "gas_station",
        latitude: 48.15,
        longitude: 17.1,
        tags: { google_place_id: "place-123" },
      },
      northSouthTarget,
    );

    expect(getGoogleMapsUrlForPOI(poi)).toContain("query_place_id=place-123");
  });
});
