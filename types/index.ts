export interface UserPosition {
  latitude: number;
  longitude: number;
  altitude: number | null;
  heading: number | null;
  speed: number | null;
  timestamp: number;
}

export type UnitSystem = "metric" | "imperial";

export type MapStyle = "streets" | "outdoors" | "satellite";

export const MAP_STYLE_URLS: Record<MapStyle, { light: string; dark: string }> = {
  streets: {
    light: "mapbox://styles/mapbox/streets-v12",
    dark: "mapbox://styles/mapbox/dark-v11",
  },
  outdoors: {
    light: "mapbox://styles/mapbox/outdoors-v12",
    dark: "mapbox://styles/mapbox/dark-v11",
  },
  satellite: {
    light: "mapbox://styles/mapbox/satellite-streets-v12",
    dark: "mapbox://styles/mapbox/satellite-streets-v12",
  },
};

// --- Phase 2: Route types ---

export interface RoutePoint {
  latitude: number;
  longitude: number;
  elevationMeters: number | null;
  distanceFromStartMeters: number;
  index: number;
}

export interface Route {
  id: string;
  name: string;
  fileName: string;
  color: string;
  isActive: boolean;
  isVisible: boolean;
  totalDistanceMeters: number;
  totalAscentMeters: number;
  totalDescentMeters: number;
  pointCount: number;
  createdAt: string; // ISO 8601
}

export interface RouteWithPoints extends Route {
  points: RoutePoint[];
}

export interface SnappedPosition {
  routeId: string;
  pointIndex: number;
  distanceAlongRouteMeters: number;
  distanceFromRouteMeters: number;
}

// --- Phase 2b: Panel types ---

export type PanelMode =
  | "none"
  | "upcoming-5"
  | "upcoming-10"
  | "upcoming-20"
  | "remaining"
  | "full"
  | "weather";

// --- Phase 3: POI types ---

export type POICategory =
  | "water"
  | "groceries"
  | "gas_station"
  | "cafe_restaurant"
  | "accommodation"
  | "bike_shop"
  | "atm"
  | "pharmacy"
  | "toilet_shower";

export interface POI {
  id: string;
  osmId: string;
  name: string | null;
  category: POICategory;
  latitude: number;
  longitude: number;
  tags: Record<string, string>;
  distanceFromRouteMeters: number;
  distanceAlongRouteMeters: number;
  nearestRouteId: string;
}

export interface POICategoryMeta {
  key: POICategory;
  label: string;
  color: string;
  iconName: string;
}

export type POIFetchStatus = "idle" | "fetching" | "done" | "error";

// --- Phase 4: Opening Hours ---

export interface OpeningHoursStatus {
  isOpen: boolean;
  label: string; // "Open", "Closed"
  detail: string | null; // "closes 20:00", "opens 07:00"
  closingSoon: boolean; // closing within 60 min
}

// --- Phase 4: ETA ---

export interface PowerModelConfig {
  powerWatts: number;
  totalMassKg: number;
  cda: number;
  crr: number;
  airDensity: number;
  maxDescentSpeedKmh: number;
  drivetrainEfficiency: number;
}

export interface ETAResult {
  distanceMeters: number;
  ridingTimeSeconds: number;
  eta: Date;
}

export interface ParsedRoute {
  name: string;
  points: RoutePoint[];
  totalDistanceMeters: number;
  totalAscentMeters: number;
  totalDescentMeters: number;
}

// --- Phase 5: Weather ---

export interface WeatherPoint {
  /** Hours from now (0 = current hour) */
  hourOffset: number;
  /** ISO 8601 time string */
  time: string;
  /** Temperature in °C */
  temperatureC: number;
  /** Precipitation in mm/h */
  precipitationMm: number;
  /** Probability of precipitation 0–100 */
  precipitationProbability: number;
  /** Wind speed in km/h */
  windSpeedKmh: number;
  /** Wind direction in degrees (0 = N, 90 = E, 180 = S, 270 = W) */
  windDirectionDeg: number;
  /** Wind gust speed in km/h */
  windGustKmh: number;
  /** WMO weather code (0–99) */
  weatherCode: number;
  /** Latitude of the waypoint this forecast is for */
  latitude: number;
  /** Longitude of the waypoint this forecast is for */
  longitude: number;
  /** Distance along route from current position (meters) */
  distanceAlongRouteM: number;
  /** Bearing of route at this point (degrees, for wind relative direction) */
  routeBearingDeg: number | null;
}

export type WindRelative = "headwind" | "tailwind" | "crosswind-left" | "crosswind-right";

export type WeatherFetchStatus = "idle" | "fetching" | "done" | "error";

// --- Phase 4b: Offline ---

export type OfflinePackStatus = "idle" | "downloading" | "complete" | "error";

export interface OfflineRouteInfo {
  status: OfflinePackStatus;
  percentage: number;
  downloadedBytes: number;
  estimatedBytes: number;
  mapStyle: MapStyle | null;
  downloadedAt: string | null;
  error: string | null;
}
