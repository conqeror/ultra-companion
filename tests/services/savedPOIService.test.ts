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

  it("resolves coordinates from nested Google Maps link params without fetching", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const nestedUrl = encodeURIComponent(
      "https://www.google.com/maps/place/Test/@48.1234567,17.7654321,17z",
    );
    const result = await resolveGoogleMapsLink(`https://maps.app.goo.gl/?link=${nestedUrl}`);

    expect(result.latitude).toBeCloseTo(48.1234567);
    expect(result.longitude).toBeCloseTo(17.7654321);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("resolves coordinates from expanded short link HTML when the final URL omits them", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 200,
        url: "https://www.google.com/maps/place//data=!4m2!3m1!1s0x476c895170197e7d:0x5049eb7d4047ad4f",
        headers: new Headers(),
        text: vi
          .fn()
          .mockResolvedValue(
            '<meta content="https://maps.google.com/maps/api/staticmap?center=48.152576%2C17.1245568&amp;zoom=10">',
          ),
      }),
    );

    const result = await resolveGoogleMapsLink("https://maps.app.goo.gl/eEhh3");

    expect(result.latitude).toBeCloseTo(48.152576);
    expect(result.longitude).toBeCloseTo(17.1245568);
    expect(result.tags.google_maps_url).toContain("google.com/maps/place");
  });

  it("manually follows short-link redirects before reading Google Maps HTML", async () => {
    const shortUrl = "https://maps.app.goo.gl/eEhh3";
    const finalUrl =
      "https://www.google.com/maps/place//data=!4m2!3m1!1s0x391904e4af9b1e35:0xee6f3c848c9e5341";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        status: 302,
        url: shortUrl,
        headers: new Headers({ location: finalUrl }),
        text: vi.fn().mockResolvedValue(""),
      })
      .mockResolvedValueOnce({
        status: 200,
        url: finalUrl,
        headers: new Headers(),
        text: vi
          .fn()
          .mockResolvedValue(
            '<link href="/maps/preview/place?pb=%211m3%211d340710.9536922071%212d17.1245568%213d48.152576">',
          ),
      });
    vi.stubGlobal("fetch", fetchMock);

    const result = await resolveGoogleMapsLink(shortUrl);

    expect(result.latitude).toBeCloseTo(48.152576);
    expect(result.longitude).toBeCloseTo(17.1245568);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("extracts escaped Google Maps targets from HTML redirect pages", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 200,
        url: "https://maps.app.goo.gl/example",
        headers: new Headers(),
        text: vi
          .fn()
          .mockResolvedValue(
            '<script>location.replace("https:\\/\\/www.google.com\\/maps\\/place\\/Test\\/@48.5,17.5,17z")</script>',
          ),
      }),
    );

    const result = await resolveGoogleMapsLink("https://maps.app.goo.gl/example");

    expect(result.latitude).toBeCloseTo(48.5);
    expect(result.longitude).toBeCloseTo(17.5);
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

    expect(poi.id).toContain("route-a_custom_custom_google_place-123");
    expect(poi.sourceId).toBe("custom:google:place-123");
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
