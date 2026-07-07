import { describe, expect, it } from "vitest";
import { buildOverpassQuery } from "@/services/overpassClient";

describe("overpassClient", () => {
  it("builds padded bbox queries for infrastructure POI searches", () => {
    const query = buildOverpassQuery([{ lat: 48.1, lon: 17.1 }], 1000);

    expect(query).toBeTruthy();
    expect(query!).toMatch(/^\[out:json\]\[timeout:30\]\[bbox:/);
    expect(query!).not.toContain("around:");
    expect(query!).toContain('node["amenity"="drinking_water"];');
    expect(query!).toContain('node["tourism"="camp_site"];');
    expect(query!).toContain('node["amenity"="bicycle_repair_station"];');
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
    expect(query!).not.toContain('"highway"="bus_stop"');
    expect(query!).not.toContain('"amenity"="hospital"');
    expect(query!).not.toContain('"railway"~"^(station|halt)$"');
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

  it("returns null when no query points are provided", () => {
    expect(buildOverpassQuery([], 1000)).toBeNull();
  });
});
