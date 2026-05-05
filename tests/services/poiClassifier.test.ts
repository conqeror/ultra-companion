import { describe, expect, it } from "vitest";
import { classifyElement } from "@/services/poiClassifier";
import type { OverpassElement } from "@/services/overpassClient";

function element(tags: Record<string, string>): OverpassElement {
  return { type: "node", id: 1, lat: 0, lon: 0, tags };
}

describe("poiClassifier", () => {
  it("classifies expanded food and service POI categories", () => {
    expect(classifyElement(element({ amenity: "cafe" }))).toBe("coffee");
    expect(classifyElement(element({ amenity: "restaurant" }))).toBe("restaurant");
    expect(classifyElement(element({ amenity: "pub" }))).toBe("bar_pub");
    expect(classifyElement(element({ shop: "bicycle" }))).toBe("bike_shop");
    expect(classifyElement(element({ amenity: "bicycle_repair_station" }))).toBe("repair_station");
    expect(classifyElement(element({ amenity: "compressed_air" }))).toBe("pump_air");
  });

  it("keeps public transport shelters separate from general shelter", () => {
    expect(classifyElement(element({ amenity: "shelter", shelter_type: "public_transport" }))).toBe(
      "bus_stop",
    );
    expect(classifyElement(element({ amenity: "shelter", shelter_type: "basic_hut" }))).toBe(
      "shelter",
    );
  });

  it("classifies help, escape, and other logistics POIs", () => {
    expect(classifyElement(element({ amenity: "pharmacy" }))).toBe("pharmacy");
    expect(classifyElement(element({ emergency: "defibrillator" }))).toBe("defibrillator");
    expect(classifyElement(element({ railway: "station" }))).toBe("train_station");
    expect(classifyElement(element({ amenity: "grave_yard" }))).toBe("cemetery");
    expect(classifyElement(element({ amenity: "school" }))).toBe("school");
  });
});
