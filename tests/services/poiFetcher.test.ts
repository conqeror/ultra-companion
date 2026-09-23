import { describe, expect, it, vi } from "vitest";

vi.mock("@/db/database", () => ({
  replacePOIsBySource: vi.fn(),
}));

vi.mock("@/services/overpassClient", () => ({
  fetchAllPOIs: vi.fn().mockResolvedValue([]),
}));

import { replacePOIsBySource } from "@/db/database";
import { fetchAllPOIs } from "@/services/overpassClient";
import { associateAndFilter, fetchOsmPOIs } from "@/services/poiFetcher";
import type { RoutePoint } from "@/types";

const routePoints: RoutePoint[] = [
  { latitude: 0, longitude: 0, elevationMeters: null, distanceFromStartMeters: 0, idx: 0 },
  {
    latitude: 0,
    longitude: 0.1,
    elevationMeters: null,
    distanceFromStartMeters: 11_132,
    idx: 1,
  },
];

describe("poiFetcher", () => {
  it("commits even an empty provider result through atomic source replacement", async () => {
    await fetchOsmPOIs("route-1", routePoints, 1000);

    expect(replacePOIsBySource).toHaveBeenCalledWith("route-1", "osm", []);
  });

  it("keeps the saved source untouched when fetching fails", async () => {
    vi.mocked(fetchAllPOIs).mockRejectedValueOnce(new Error("Offline"));

    await expect(fetchOsmPOIs("route-1", routePoints, 1000)).rejects.toThrow("Offline");

    expect(replacePOIsBySource).not.toHaveBeenCalled();
  });

  it("filters associated POIs with category-specific corridor widths", () => {
    const pois = associateAndFilter(
      [
        {
          sourceId: "fuel",
          name: "Fuel",
          category: "gas_station",
          latitude: 0.013,
          longitude: 0.05,
          tags: {},
        },
        {
          sourceId: "tap",
          name: "Tap",
          category: "water",
          latitude: 0.013,
          longitude: 0.05,
          tags: {},
        },
      ],
      "route-1",
      routePoints,
      1000,
      "osm",
    );

    expect(pois.map((poi) => poi.sourceId)).toEqual(["fuel"]);
    expect(pois[0].distanceFromRouteMeters).toBeGreaterThan(1000);
  });
});
