import { describe, expect, it, vi } from "vitest";

vi.mock("@/db/database", () => ({
  deletePOIsBySource: vi.fn(),
  insertPOIs: vi.fn(),
}));

vi.mock("@/services/overpassClient", () => ({
  fetchAllPOIs: vi.fn().mockResolvedValue([]),
}));

import { deletePOIsBySource } from "@/db/database";
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
  it("refreshes fetched POIs without deleting persisted stars", async () => {
    await fetchOsmPOIs("route-1", routePoints, 1000);

    expect(vi.mocked(deletePOIsBySource).mock.calls[0]).toEqual(["route-1", "osm"]);
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
