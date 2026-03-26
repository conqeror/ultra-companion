export const DEFAULT_MAP_CENTER = {
  latitude: 48.2082, // Vienna — sensible default
  longitude: 16.3738,
};

export const DEFAULT_ZOOM = 12;
// Fatigue-friendly: minimum 48dp touch targets
export const MIN_TOUCH_TARGET = 48;

// Distinct route colors — high contrast, colorblind-friendly
export const ROUTE_COLORS = [
  "#E63946", // red
  "#457B9D", // steel blue
  "#2A9D8F", // teal
  "#E9C46A", // gold
  "#F4A261", // sandy orange
  "#6A4C93", // purple
  "#1D3557", // navy
  "#264653", // dark teal
] as const;

// Max points before downsampling elevation chart
export const ELEVATION_CHART_MAX_POINTS = 500;

// --- Phase 2b: Bottom panel ---

/** Panel height as fraction of screen height */
export const BOTTOM_PANEL_HEIGHT_RATIO = 0.25;

/** Fraction of chart width to show behind current position */
export const LOOK_BACK_RATIO = 0.25;

/** Panel modes in cycle order */
export const PANEL_MODES = [
  "none",
  "upcoming-5",
  "upcoming-10",
  "upcoming-20",
  "remaining",
  "full",
] as const;

// --- Phase 3: POI constants ---

import type { POICategoryMeta } from "@/types";

export const POI_CATEGORIES: POICategoryMeta[] = [
  { key: "water", label: "Water", color: "#3B82F6", iconName: "Droplets" },
  { key: "groceries", label: "Groceries", color: "#22C55E", iconName: "ShoppingCart" },
  { key: "gas_station", label: "Gas Station", color: "#F97316", iconName: "Fuel" },
  { key: "cafe_restaurant", label: "Café", color: "#A855F7", iconName: "Coffee" },
  { key: "accommodation", label: "Sleep", color: "#EC4899", iconName: "Bed" },
  { key: "bike_shop", label: "Bike Shop", color: "#14B8A6", iconName: "Wrench" },
  { key: "atm", label: "ATM", color: "#EAB308", iconName: "Banknote" },
  { key: "pharmacy", label: "Pharmacy", color: "#EF4444", iconName: "Cross" },
  { key: "toilet_shower", label: "WC", color: "#6366F1", iconName: "ShowerHead" },
];

/** How far behind the rider a POI remains visible in the list */
export const POI_BEHIND_THRESHOLD_M = 1000;

export const DEFAULT_CORRIDOR_WIDTH_M = 2000;
export const MAX_CORRIDOR_WIDTH_M = 10000;
export const MIN_CORRIDOR_WIDTH_M = 500;
export const OVERPASS_API_URL = "https://overpass-api.de/api/interpreter";
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
  maxDescentSpeedKmh: 60,
  drivetrainEfficiency: 0.97,
};
