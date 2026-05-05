export const DEFAULT_MAP_CENTER = {
  latitude: 48.2082, // Vienna — sensible default
  longitude: 16.3738,
};

export const DEFAULT_ZOOM = 12;
// Fatigue-friendly: minimum 48dp touch targets
export const MIN_TOUCH_TARGET = 48;

// Route colors: active stands out, inactive fades back
export const ACTIVE_ROUTE_COLOR = "#E63946";
export const INACTIVE_ROUTE_COLOR = "#94A3B8";

// Max points before downsampling elevation chart
export const ELEVATION_CHART_MAX_POINTS = 500;

// --- Phase 2b: Bottom panel ---

/** Draggable sheet snap points as fraction of screen height */
export const SHEET_COMPACT_RATIO = 0.3;
export const SHEET_EXPANDED_RATIO = 0.75;

/** Fraction of chart width to show behind current position */
export const LOOK_BACK_RATIO = 0.25;

/** Panel modes in cycle order */
export const PANEL_MODES = [
  "upcoming-10",
  "upcoming-25",
  "upcoming-50",
  "upcoming-100",
  "upcoming-200",
  "full-route",
] as const;

// --- Phase 3: POI constants ---

import type {
  POICategory,
  POICategoryMeta,
  POIDiscoveryGroupMeta,
  POIDiscoverySource,
} from "@/types";

export const POI_CATEGORIES: POICategoryMeta[] = [
  { key: "water", label: "Water", group: "water", color: "#3B82F6", iconName: "Droplets" },
  {
    key: "groceries",
    label: "Groceries",
    group: "food",
    color: "#22C55E",
    iconName: "ShoppingCart",
  },
  { key: "gas_station", label: "Gas Station", group: "food", color: "#F97316", iconName: "Fuel" },
  { key: "bakery", label: "Bakery", group: "food", color: "#EAB308", iconName: "Croissant" },
  { key: "coffee", label: "Coffee", group: "eat_drink", color: "#A16207", iconName: "Coffee" },
  {
    key: "restaurant",
    label: "Restaurant",
    group: "eat_drink",
    color: "#F59E0B",
    iconName: "Utensils",
  },
  { key: "bar_pub", label: "Bar / Pub", group: "eat_drink", color: "#D97706", iconName: "Beer" },
  { key: "toilet_shower", label: "WC", group: "wc", color: "#6366F1", iconName: "Toilet" },
  { key: "shelter", label: "Shelter", group: "rest", color: "#8B5CF6", iconName: "Tent" },
  { key: "bus_stop", label: "Bus Shelter", group: "rest", color: "#0EA5E9", iconName: "Bus" },
  { key: "camp_site", label: "Camp Site", group: "rest", color: "#7C3AED", iconName: "Tent" },
  { key: "pharmacy", label: "Pharmacy", group: "help", color: "#10B981", iconName: "Pill" },
  {
    key: "hospital_er",
    label: "Hospital / ER",
    group: "help",
    color: "#DC2626",
    iconName: "Hospital",
  },
  {
    key: "defibrillator",
    label: "Defibrillator",
    group: "help",
    color: "#EF4444",
    iconName: "HeartPulse",
  },
  {
    key: "emergency_phone",
    label: "Emergency Phone",
    group: "help",
    color: "#7C2D12",
    iconName: "Phone",
  },
  {
    key: "ambulance_station",
    label: "Ambulance",
    group: "help",
    color: "#B91C1C",
    iconName: "Ambulance",
  },
  { key: "bike_shop", label: "Bike Shop", group: "repair", color: "#2563EB", iconName: "Bike" },
  {
    key: "repair_station",
    label: "Repair Station",
    group: "repair",
    color: "#0F766E",
    iconName: "Wrench",
  },
  {
    key: "pump_air",
    label: "Pump / Air",
    group: "repair",
    color: "#0891B2",
    iconName: "CircleDot",
  },
  {
    key: "train_station",
    label: "Train Station",
    group: "escape",
    color: "#475569",
    iconName: "TrainFront",
  },
  { key: "sports", label: "Sports", group: "other", color: "#84CC16", iconName: "Dumbbell" },
  { key: "cemetery", label: "Cemetery", group: "other", color: "#64748B", iconName: "Landmark" },
  { key: "school", label: "School", group: "other", color: "#14B8A6", iconName: "School" },
  { key: "other", label: "Other", group: "other", color: "#64748B", iconName: "MapPin" },
];

export const POI_MAP_ICON_IMAGE_SIZE = 24;
export const POI_MAP_ICON_SYMBOL_SIZE = 0.9;
export const POI_MAP_ICON_INSET = 8;
export const POI_MAP_ICON_STROKE_WIDTH = 2.4;
export const POI_MAP_ICON_PREFIX = "poi-lucide-";

export function poiMapIconImageId(iconName: string): string {
  return `${POI_MAP_ICON_PREFIX}${iconName}`;
}

export function poiMapIconImageIdForCategory(category: POICategory): string {
  const meta = POI_CATEGORIES.find((c) => c.key === category);
  return poiMapIconImageId(meta?.iconName ?? "MapPin");
}

export const POI_CLUSTER_SUMMARY_CATEGORIES = [
  "groceries",
  "gas_station",
  "bakery",
  "toilet_shower",
  "water",
  "shelter",
  "bus_stop",
  "camp_site",
  "bike_shop",
  "repair_station",
  "pump_air",
  "pharmacy",
  "hospital_er",
  "defibrillator",
  "emergency_phone",
  "ambulance_station",
  "train_station",
  "coffee",
  "restaurant",
  "bar_pub",
  "sports",
  "cemetery",
  "school",
  "other",
] as const satisfies readonly POICategory[];

export const POI_CLUSTER_SUMMARY_ICON_SYMBOL_SIZE = 0.82;
export const POI_CLUSTER_SUMMARY_PROPERTY_PREFIX = "poi_cluster_summary_";
export const POI_CLUSTER_SUMMARY_PRIORITY_PROPERTY = "poi_cluster_summary_priority";

export function poiClusterSummaryProperty(category: POICategory): string {
  return `${POI_CLUSTER_SUMMARY_PROPERTY_PREFIX}${category}`;
}

export const POI_DISCOVERY_GROUPS: POIDiscoveryGroupMeta[] = [
  {
    key: "water_wc",
    label: "Water + WC",
    detail: "Drinking water, springs, taps, toilets, and showers from OSM.",
    categories: ["water", "toilet_shower"],
    defaultEnabled: true,
  },
  {
    key: "food_supplies",
    label: "Food Supplies",
    detail: "Groceries, gas stations, and bakeries from Google Places.",
    categories: ["groceries", "gas_station", "bakery"],
    defaultEnabled: true,
  },
  {
    key: "bike_shops",
    label: "Bike Shops",
    detail: "Commercial bike shops from Google Places.",
    categories: ["bike_shop"],
    defaultEnabled: true,
  },
  {
    key: "repair_infrastructure",
    label: "Repair Infrastructure",
    detail: "Public repair stands and air pumps from OSM.",
    categories: ["repair_station", "pump_air"],
    defaultEnabled: true,
  },
  {
    key: "basic_rest",
    label: "Shelter",
    detail: "Shelters and huts from OSM.",
    categories: ["shelter"],
    defaultEnabled: true,
  },
  {
    key: "eat_drink",
    label: "Eat + Drink",
    detail: "Cafes, restaurants, bars, and pubs from Google Places.",
    categories: ["coffee", "restaurant", "bar_pub"],
    defaultEnabled: false,
  },
  {
    key: "pharmacy",
    label: "Pharmacy",
    detail: "Pharmacies from Google Places.",
    categories: ["pharmacy"],
    defaultEnabled: false,
  },
  {
    key: "rough_sleep",
    label: "Rough Sleep",
    detail: "Bus shelters and camp sites from OSM.",
    categories: ["bus_stop", "camp_site"],
    defaultEnabled: false,
  },
  {
    key: "emergency",
    label: "Emergency",
    detail: "Hospitals, defibrillators, emergency phones, and ambulance stations from OSM.",
    categories: ["hospital_er", "defibrillator", "emergency_phone", "ambulance_station"],
    defaultEnabled: false,
  },
  {
    key: "escape",
    label: "Escape / Transport",
    detail: "Train stations from OSM.",
    categories: ["train_station"],
    defaultEnabled: false,
  },
  {
    key: "opportunistic_rest",
    label: "Opportunistic Rest",
    detail: "Sports grounds, cemeteries, and schools from OSM.",
    categories: ["sports", "cemetery", "school"],
    defaultEnabled: false,
  },
];

export const DEFAULT_POI_DISCOVERY_CATEGORIES: POICategory[] = POI_DISCOVERY_GROUPS.flatMap(
  (group) => (group.defaultEnabled ? group.categories : []),
);

export const GOOGLE_POI_DISCOVERY_CATEGORIES: POICategory[] = [
  "groceries",
  "gas_station",
  "bakery",
  "coffee",
  "restaurant",
  "bar_pub",
  "pharmacy",
  "bike_shop",
];

export const OSM_POI_DISCOVERY_CATEGORIES: POICategory[] = [
  "water",
  "toilet_shower",
  "shelter",
  "bus_stop",
  "camp_site",
  "hospital_er",
  "defibrillator",
  "emergency_phone",
  "ambulance_station",
  "repair_station",
  "pump_air",
  "train_station",
  "sports",
  "cemetery",
  "school",
];

export function normalizePoiCategories(categories: POICategory[]): POICategory[] {
  const valid = new Set<string>(POI_CATEGORIES.map((category) => category.key));
  return Array.from(new Set(categories)).filter((category) => valid.has(category)) as POICategory[];
}

export function poiDiscoveryCategoriesForSource(
  categories: POICategory[],
  source: POIDiscoverySource,
): POICategory[] {
  const sourceCategories =
    source === "google" ? GOOGLE_POI_DISCOVERY_CATEGORIES : OSM_POI_DISCOVERY_CATEGORIES;
  const requested = new Set(categories);
  return sourceCategories.filter((category) => requested.has(category));
}

/** How far behind the rider a POI remains visible in the list */
export const POI_BEHIND_THRESHOLD_M = 1000;

export const POI_CLUSTER_MIN_ZOOM = 8;
export const POI_CLUSTER_MAX_ZOOM = 12;
export const POI_CLUSTER_RADIUS = 48;
export const POI_CLUSTER_HITBOX = 44;

export const DEFAULT_CORRIDOR_WIDTH_M = 1000;
export const MAX_CORRIDOR_WIDTH_M = 10000;
export const MIN_CORRIDOR_WIDTH_M = 500;

export const DEFAULT_POI_CATEGORY_CORRIDOR_WIDTH_M: Record<POICategory, number> = {
  water: 1000,
  groceries: 1000,
  gas_station: 1500,
  bakery: 1000,
  coffee: 1000,
  restaurant: 1500,
  bar_pub: 1500,
  toilet_shower: 1000,
  shelter: 300,
  bus_stop: 30,
  camp_site: 5000,
  pharmacy: 3000,
  hospital_er: 10000,
  defibrillator: 1000,
  emergency_phone: 1000,
  ambulance_station: 5000,
  bike_shop: 5000,
  repair_station: 500,
  pump_air: 500,
  train_station: 10000,
  sports: 1000,
  cemetery: 1000,
  school: 1000,
  other: DEFAULT_CORRIDOR_WIDTH_M,
};

export function getPoiCategoryCorridorWidthM(
  category: POICategory,
  fallbackWidthM = DEFAULT_CORRIDOR_WIDTH_M,
): number {
  return DEFAULT_POI_CATEGORY_CORRIDOR_WIDTH_M[category] ?? fallbackWidthM;
}

export function getMaxPoiCorridorWidthM(fallbackWidthM = DEFAULT_CORRIDOR_WIDTH_M): number {
  return Math.max(fallbackWidthM, ...Object.values(DEFAULT_POI_CATEGORY_CORRIDOR_WIDTH_M));
}

export const OVERPASS_API_URLS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
export const OVERPASS_SEGMENT_LENGTH_M = 50_000;
export const OVERPASS_RETRY_DELAYS = [2000, 5000, 15000];

/** Max elevation difference between POI and route at nearest point (meters) */
export const POI_MAX_ELEVATION_DIFF_M = 25;

// --- Phase 4: GPS & ETA ---

/** Position older than this triggers auto-refresh on app focus */
export const GPS_STALE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

/** Position age label becomes visible after this threshold */
export const POSITION_AGE_VISIBLE_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes

/** Gravitational acceleration m/s² */
export const G = 9.80665;

import type { PowerModelConfig } from "@/types";

export const DEFAULT_POWER_CONFIG: PowerModelConfig = {
  powerWatts: 200,
  totalMassKg: 120,
  cda: 0.4,
  crr: 0.005,
  airDensity: 1.225,
  maxDescentSpeedKmh: 50,
  drivetrainEfficiency: 0.97,
};

// --- Phase 5: Weather ---

/** Sample weather waypoints every N meters along route */
export const WEATHER_WAYPOINT_INTERVAL_M = 20_000;

/** Only fetch weather for the next N meters ahead */
export const WEATHER_LOOKAHEAD_M = 200_000;

/** Weather cache becomes stale after this (1 hour) */
export const WEATHER_STALE_MS = 60 * 60 * 1000;

/** Open-Meteo API base URL */
export const OPEN_METEO_API_URL = "https://api.open-meteo.com/v1/forecast";

/** Max number of hourly points to show in weather timeline */
export const WEATHER_TIMELINE_HOURS = 24;

// --- Phase 4b: Offline ---

/** Offline tile download: zoom range */
export const OFFLINE_MIN_ZOOM = 10;
export const OFFLINE_MAX_ZOOM = 14;

/** Pack name prefix for Mapbox offline tile regions */
export const OFFLINE_PACK_PREFIX = "ultra-route-";

/** Cancel tile download if no progress for this long */
export const TILE_DOWNLOAD_STALL_MS = 2 * 60 * 1000;
