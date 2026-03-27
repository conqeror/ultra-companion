import type { POICategory } from "@/types";
import type { OverpassElement } from "./overpassClient";

// --- Tag-to-category classification rules ---
// Ordered by priority: first match wins

const TAG_RULES: {
  category: POICategory;
  check: (tags: Record<string, string>) => boolean;
}[] = [
  {
    category: "water",
    check: (t) =>
      t.amenity === "drinking_water" ||
      t.natural === "spring" ||
      t.man_made === "water_tap",
  },
  {
    category: "groceries",
    check: (t) =>
      ["supermarket", "convenience", "grocery", "bakery"].includes(t.shop ?? ""),
  },
  {
    category: "gas_station",
    check: (t) => t.amenity === "fuel",
  },
  {
    category: "bike_shop",
    check: (t) =>
      t.shop === "bicycle" || t.amenity === "bicycle_repair_station",
  },
  {
    category: "atm",
    check: (t) => t.amenity === "atm" || t.amenity === "bank",
  },
  {
    category: "pharmacy",
    check: (t) => t.amenity === "pharmacy",
  },
  {
    category: "toilet_shower",
    check: (t) => t.amenity === "toilets" || t.amenity === "shower",
  },
];

/** Classify a single Overpass element into a POI category */
export function classifyElement(
  element: OverpassElement,
): POICategory | null {
  const tags = element.tags;
  if (!tags) return null;

  for (const rule of TAG_RULES) {
    if (rule.check(tags)) return rule.category;
  }
  return null;
}

/** Extract coordinates from an Overpass element (node has lat/lon, way has center) */
function getCoords(
  element: OverpassElement,
): { lat: number; lon: number } | null {
  if (element.lat != null && element.lon != null) {
    return { lat: element.lat, lon: element.lon };
  }
  if (element.center) {
    return { lat: element.center.lat, lon: element.center.lon };
  }
  return null;
}

export interface ClassifiedPOI {
  osmId: string;
  name: string | null;
  category: POICategory;
  latitude: number;
  longitude: number;
  tags: Record<string, string>;
}

/** Classify and map a batch of Overpass elements, deduplicated by osmId */
export function mapOverpassToPOIs(
  elements: OverpassElement[],
): ClassifiedPOI[] {
  const seen = new Set<string>();
  const results: ClassifiedPOI[] = [];

  for (const el of elements) {
    const category = classifyElement(el);
    if (!category) continue;

    const coords = getCoords(el);
    if (!coords) continue;

    const osmId = `${el.type}/${el.id}`;
    if (seen.has(osmId)) continue;
    seen.add(osmId);

    results.push({
      osmId,
      name: el.tags?.name ?? null,
      category,
      latitude: coords.lat,
      longitude: coords.lon,
      tags: el.tags ?? {},
    });
  }

  return results;
}
