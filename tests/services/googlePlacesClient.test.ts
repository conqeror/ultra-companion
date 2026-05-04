import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchGooglePlacesPOIs,
  inferPOICategoryFromGoogleTypes,
} from "@/services/googlePlacesClient";
import type { RoutePoint } from "@/types";

const routePoints: RoutePoint[] = [
  { latitude: 48.1, longitude: 17.1, elevationMeters: null, distanceFromStartMeters: 0, idx: 0 },
  {
    latitude: 48.2,
    longitude: 17.2,
    elevationMeters: null,
    distanceFromStartMeters: 15_000,
    idx: 1,
  },
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("googlePlacesClient", () => {
  it("infers expanded POI categories from Google place types", () => {
    expect(inferPOICategoryFromGoogleTypes(["cafe"])).toBe("coffee");
    expect(inferPOICategoryFromGoogleTypes(["restaurant"])).toBe("restaurant");
    expect(inferPOICategoryFromGoogleTypes(["bar"])).toBe("bar_pub");
    expect(inferPOICategoryFromGoogleTypes(["pharmacy"])).toBe("pharmacy");
    expect(inferPOICategoryFromGoogleTypes(["hospital"])).toBe("hospital_er");
    expect(inferPOICategoryFromGoogleTypes(["bicycle_store"])).toBe("bike_shop");
  });

  it("only runs Google searches for enabled discovery categories", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ places: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await fetchGooglePlacesPOIs(routePoints, "api-key", ["gas_station"]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      textQuery: "gas station",
    });
  });

  it("skips Google when no Google discovery categories are enabled", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const pois = await fetchGooglePlacesPOIs(routePoints, "api-key", ["water"]);

    expect(pois).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
