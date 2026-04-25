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
] as const;

// --- Phase 3: POI constants ---

import type { POICategoryMeta } from "@/types";

export const POI_CATEGORIES: POICategoryMeta[] = [
  { key: "water", label: "Water", color: "#3B82F6", iconName: "Droplets" },
  { key: "groceries", label: "Groceries", color: "#22C55E", iconName: "ShoppingCart" },
  { key: "gas_station", label: "Gas Station", color: "#F97316", iconName: "Fuel" },
  { key: "bakery", label: "Bakery", color: "#EAB308", iconName: "Croissant" },
  { key: "toilet_shower", label: "WC", color: "#6366F1", iconName: "ShowerHead" },
  { key: "shelter", label: "Shelter", color: "#8B5CF6", iconName: "Tent" },
];

/** How far behind the rider a POI remains visible in the list */
export const POI_BEHIND_THRESHOLD_M = 1000;
/** Ordinary riding map view keeps POIs route-windowed to avoid rendering full collections. */
export const POI_MAP_LOOKAHEAD_M = 100_000;

export const DEFAULT_CORRIDOR_WIDTH_M = 1000;
export const MAX_CORRIDOR_WIDTH_M = 10000;
export const MIN_CORRIDOR_WIDTH_M = 500;
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
