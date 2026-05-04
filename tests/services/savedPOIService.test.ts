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
  vi.useRealTimers();
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

  it("falls back to parsed coordinates when Google Place Details fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: vi.fn().mockResolvedValue("Service unavailable"),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await resolveGoogleMapsLink(
      "https://www.google.com/maps/search/?api=1&query=48.1234567,17.7654321&query_place_id=place-123",
      "api-key",
    );

    expect(result.latitude).toBeCloseTo(48.1234567);
    expect(result.longitude).toBeCloseTo(17.7654321);
    expect(result.tags.google_place_id).toBe("place-123");
    expect(result.sourceId).toBe("google:place-123");
    expect(fetchMock).toHaveBeenCalledTimes(1);
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

  it("times out when a Google Maps short link never responds", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise(() => {})));

    const result = resolveGoogleMapsLink("https://maps.app.goo.gl/stuck");
    const assertion = expect(result).rejects.toThrow("Could not resolve this link");
    await vi.advanceTimersByTimeAsync(8_001);

    await assertion;
  });

  it("falls back to Google Places text search from pasted place names", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        status: 200,
        url: "https://maps.app.goo.gl/no-coordinates",
        headers: new Headers(),
        text: vi.fn().mockResolvedValue("<html>No coordinates here</html>"),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          places: [
            {
              id: "place-123",
              displayName: { text: "Known Station" },
              location: { latitude: 48.2222, longitude: 17.3333 },
              types: ["gas_station"],
              googleMapsUri: "https://www.google.com/maps/place/Known+Station",
            },
          ],
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const result = await resolveGoogleMapsLink(
      "https://maps.app.goo.gl/no-coordinates\nKnown Station",
      "api-key",
    );

    expect(result.name).toBe("Known Station");
    expect(result.category).toBe("gas_station");
    expect(result.latitude).toBeCloseTo(48.2222);
    expect(result.longitude).toBeCloseTo(17.3333);
    expect(result.sourceId).toBe("google:place-123");
    expect(fetchMock).toHaveBeenLastCalledWith(
      "https://places.googleapis.com/v1/places:searchText",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ textQuery: "Known Station", pageSize: 1 }),
      }),
    );
  });

  it("uses the place query from Google consent URLs after short-link expansion", async () => {
    const mapsUrl =
      "https://maps.google.com/maps?q=Papaya+Vietnamese+and+Thai+Street+Food,+Twin+City+Tower+(vn%C3%BAtroblok+Twin+City+A/B,+Mlynsk%C3%A9+nivy+10,+821+09+Bratislava&ftid=0x476c891957ae8c5d:0xeb494592c9f5cf30&entry=gps";
    const consentUrl = `https://consent.google.com/ml?continue=${encodeURIComponent(mapsUrl)}&gl=SK`;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        status: 200,
        url: consentUrl,
        headers: new Headers({ "content-type": "text/html; charset=utf-8" }),
        text: vi.fn().mockResolvedValue("<html>Google consent page</html>"),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          places: [
            {
              id: "papaya-place",
              displayName: { text: "Papaya Vietnamese and Thai Street Food" },
              location: { latitude: 48.1459, longitude: 17.1262 },
              types: ["restaurant"],
              googleMapsUri: "https://www.google.com/maps/place/Papaya",
            },
          ],
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const result = await resolveGoogleMapsLink(
      "https://maps.app.goo.gl/DUWBuDsT8vRNUYHGA",
      "api-key",
    );

    expect(result.name).toBe("Papaya Vietnamese and Thai Street Food");
    expect(result.latitude).toBeCloseTo(48.1459);
    expect(result.longitude).toBeCloseTo(17.1262);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith(
      "https://places.googleapis.com/v1/places:searchText",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          textQuery:
            "Papaya Vietnamese and Thai Street Food, Twin City Tower (vnútroblok Twin City A/B, Mlynské nivy 10, 821 09 Bratislava",
          pageSize: 1,
        }),
      }),
    );
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
