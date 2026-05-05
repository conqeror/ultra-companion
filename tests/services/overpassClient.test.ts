import { describe, expect, it } from "vitest";
import { buildOverpassQuery } from "@/services/overpassClient";

describe("overpassClient", () => {
  it("builds category-specific corridor radii for infrastructure POI searches", () => {
    const query = buildOverpassQuery([{ lat: 48.1, lon: 17.1 }], 1000);

    expect(query).toBeTruthy();
    expect(query!).toContain('node["amenity"="drinking_water"](around:1000,48.1,17.1)');
    expect(query!).toContain('node["highway"="bus_stop"]["shelter"="yes"](around:30,48.1,17.1)');
    expect(query!).toContain('node["amenity"="hospital"](around:10000,48.1,17.1)');
    expect(query!).toContain('node["amenity"="bicycle_repair_station"](around:500,48.1,17.1)');
  });

  it("keeps commercial stops on Google Places or disabled discovery groups", () => {
    const query = buildOverpassQuery([{ lat: 48.1, lon: 17.1 }], 1000);

    expect(query).toBeTruthy();
    expect(query!).not.toContain('"amenity"="fuel"');
    expect(query!).not.toContain('"shop"~"^(supermarket|convenience|grocery)$"');
    expect(query!).not.toContain('"shop"="bakery"');
    expect(query!).not.toContain('"amenity"="cafe"');
    expect(query!).not.toContain('"amenity"="restaurant"');
    expect(query!).not.toContain('"amenity"~"^(bar|pub)$"');
    expect(query!).not.toContain('"shop"="bicycle"');
  });

  it("omits disabled OSM discovery categories", () => {
    const query = buildOverpassQuery([{ lat: 48.1, lon: 17.1 }], 1000, ["water"]);

    expect(query).toContain('node["amenity"="drinking_water"]');
    expect(query).not.toContain('"amenity"~"^(toilets|shower)$"');
    expect(query).not.toContain('"amenity"="bicycle_repair_station"');
  });

  it("returns null when no OSM categories are enabled", () => {
    expect(buildOverpassQuery([{ lat: 48.1, lon: 17.1 }], 1000, [])).toBeNull();
  });
});
