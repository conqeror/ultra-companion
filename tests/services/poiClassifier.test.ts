import { describe, expect, it } from "vitest";
import { classifyElement } from "@/services/poiClassifier";
import type { OverpassElement } from "@/services/overpassClient";

function element(tags: Record<string, string>): OverpassElement {
  return { type: "node", id: 1, lat: 0, lon: 0, tags };
}

describe("poiClassifier", () => {
  it("classifies race-critical food and service POI categories", () => {
    expect(classifyElement(element({ shop: "supermarket" }))).toBe("groceries");
    expect(classifyElement(element({ amenity: "fuel" }))).toBe("gas_station");
    expect(classifyElement(element({ shop: "bakery" }))).toBe("bakery");
    expect(classifyElement(element({ shop: "bicycle" }))).toBe("bike_shop");
    expect(classifyElement(element({ amenity: "bicycle_repair_station" }))).toBe("repair_station");
    expect(classifyElement(element({ amenity: "compressed_air" }))).toBe("pump_air");
  });

  it("drops public transport shelters from the pruned taxonomy", () => {
    expect(
      classifyElement(element({ amenity: "shelter", shelter_type: "public_transport" })),
    ).toBeNull();
    expect(classifyElement(element({ amenity: "shelter", shelter_type: "basic_hut" }))).toBe(
      "shelter",
    );
  });

  it("keeps pharmacy but drops low-signal or emergency categories", () => {
    expect(classifyElement(element({ amenity: "pharmacy" }))).toBe("pharmacy");
    expect(classifyElement(element({ emergency: "defibrillator" }))).toBeNull();
    expect(classifyElement(element({ railway: "station" }))).toBeNull();
    expect(classifyElement(element({ amenity: "grave_yard" }))).toBeNull();
    expect(classifyElement(element({ amenity: "school" }))).toBeNull();
  });
});
