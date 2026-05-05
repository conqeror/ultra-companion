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
      t.amenity === "drinking_water" || t.natural === "spring" || t.man_made === "water_tap",
  },
  {
    category: "toilet_shower",
    check: (t) => t.amenity === "toilets" || t.amenity === "shower",
  },
  {
    category: "coffee",
    check: (t) => t.amenity === "cafe",
  },
  {
    category: "restaurant",
    check: (t) => t.amenity === "restaurant",
  },
  {
    category: "bar_pub",
    check: (t) => t.amenity === "bar" || t.amenity === "pub",
  },
  {
    category: "groceries",
    check: (t) => ["supermarket", "convenience", "grocery"].includes(t.shop),
  },
  {
    category: "bakery",
    check: (t) => t.shop === "bakery",
  },
  {
    category: "gas_station",
    check: (t) => t.amenity === "fuel",
  },
  {
    category: "shelter",
    check: (t) =>
      (t.amenity === "shelter" && t.shelter_type !== "public_transport") ||
      t.tourism === "wilderness_hut" ||
      t.tourism === "alpine_hut",
  },
  {
    category: "bus_stop",
    check: (t) =>
      (t.highway === "bus_stop" && t.shelter === "yes") ||
      (t.amenity === "shelter" && t.shelter_type === "public_transport") ||
      ((t.public_transport === "platform" || t.public_transport === "stop_position") &&
        t.bus === "yes" &&
        t.shelter === "yes"),
  },
  {
    category: "camp_site",
    check: (t) => t.tourism === "camp_site",
  },
  {
    category: "pharmacy",
    check: (t) => t.amenity === "pharmacy" || t.healthcare === "pharmacy",
  },
  {
    category: "hospital_er",
    check: (t) => t.amenity === "hospital" || t.healthcare === "hospital" || t.emergency === "yes",
  },
  {
    category: "defibrillator",
    check: (t) => t.emergency === "defibrillator",
  },
  {
    category: "emergency_phone",
    check: (t) => t.emergency === "phone",
  },
  {
    category: "ambulance_station",
    check: (t) => t.emergency === "ambulance_station",
  },
  {
    category: "bike_shop",
    check: (t) => t.shop === "bicycle",
  },
  {
    category: "repair_station",
    check: (t) => t.amenity === "bicycle_repair_station",
  },
  {
    category: "pump_air",
    check: (t) => t.amenity === "compressed_air" || t["service:bicycle:pump"] === "yes",
  },
  {
    category: "train_station",
    check: (t) =>
      t.railway === "station" ||
      t.railway === "halt" ||
      (t.public_transport === "station" && t.train === "yes"),
  },
  {
    category: "sports",
    check: (t) => (t.leisure === "pitch" && t.sport === "soccer") || t.leisure === "sports_centre",
  },
  {
    category: "cemetery",
    check: (t) => t.amenity === "grave_yard" || t.landuse === "cemetery",
  },
  {
    category: "school",
    check: (t) => t.amenity === "school",
  },
];

/** Classify a single Overpass element into a POI category */
export function classifyElement(element: OverpassElement): POICategory | null {
  const tags = element.tags;
  if (!tags) return null;

  for (const rule of TAG_RULES) {
    if (rule.check(tags)) return rule.category;
  }
  return null;
}

/** Extract coordinates from an Overpass element (node has lat/lon, way has center) */
function getCoords(element: OverpassElement): { lat: number; lon: number } | null {
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
export function mapOverpassToPOIs(elements: OverpassElement[]): ClassifiedPOI[] {
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
