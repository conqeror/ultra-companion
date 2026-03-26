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
