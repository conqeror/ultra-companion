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
    category: "toilet_shower",
    check: (t) => t.amenity === "toilets" || t.amenity === "shower",
  },
  {
    category: "shelter",
    check: (t) =>
      (t.amenity === "shelter" && t.shelter_type !== "public_transport") ||
      t.tourism === "wilderness_hut" ||
      t.tourism === "alpine_hut",
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
  sourceId: string;
  name: string | null;
  category: POICategory;
  latitude: number;
  longitude: number;
  tags: Record<string, string>;
}

/** Classify and map a batch of Overpass elements, deduplicated by sourceId */
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

    const sourceId = `${el.type}/${el.id}`;
    if (seen.has(sourceId)) continue;
    seen.add(sourceId);

    results.push({
      sourceId,
      name: el.tags?.name ?? null,
      category,
      latitude: coords.lat,
      longitude: coords.lon,
      tags: el.tags ?? {},
    });
  }

  return results;
}
