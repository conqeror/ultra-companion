import { describe, expect, it } from "vitest";
import { POI_CATEGORIES } from "@/constants";
import { parsePersistedEnabledCategories } from "@/store/poiStore";
import type { POICategory } from "@/types";

const allCategoryKeys = POI_CATEGORIES.map((category) => category.key);

describe("parsePersistedEnabledCategories", () => {
  it("enables all categories when no preference is saved", () => {
    expect(parsePersistedEnabledCategories(undefined)).toEqual(allCategoryKeys);
  });

  it("preserves stored subsets without legacy expansion", () => {
    const stored: POICategory[] = [
      "water",
      "groceries",
      "gas_station",
      "bakery",
      "toilet_shower",
      "shelter",
      "other",
      "coffee",
    ];

    expect(parsePersistedEnabledCategories(JSON.stringify(stored))).toEqual(stored);
  });

  it("drops unknown and duplicate stored categories", () => {
    expect(parsePersistedEnabledCategories(JSON.stringify(["water", "unknown", "water"]))).toEqual([
      "water",
    ]);
  });
});
