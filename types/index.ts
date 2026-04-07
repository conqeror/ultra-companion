export interface UserPosition {
  latitude: number;
  longitude: number;
  altitude: number | null;
  heading: number | null;
  speed: number | null;
  timestamp: number;
}

export type UnitSystem = "metric" | "imperial";

export const MAP_STYLE_URL = "mapbox://styles/mapbox/outdoors-v12";

// --- Phase 2: Route types ---

export interface RoutePoint {
  latitude: number;
  longitude: number;
  elevationMeters: number | null;
  distanceFromStartMeters: number;
  idx: number;
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
  | "upcoming-10"
  | "upcoming-25"
  | "upcoming-50"
  | "upcoming-100"
  | "upcoming-200";

// --- Phase 3: POI types ---

export type POICategory =
  | "water"
  | "groceries"
  | "gas_station"
  | "bakery"
  | "toilet_shower"
  | "shelter";

export type POISource = "osm" | "google";

export interface POI {
  id: string;
  sourceId: string;
  source: POISource;
  name: string | null;
  category: POICategory;
  latitude: number;
  longitude: number;
  tags: Record<string, string>;
  distanceFromRouteMeters: number;
  distanceAlongRouteMeters: number;
  routeId: string;
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

// --- Phase 6: Route Collections ---

export interface Collection {
  id: string;
  name: string;
  isActive: boolean;
  createdAt: string; // ISO 8601
}

export interface CollectionSegment {
  collectionId: string;
  routeId: string;
  position: number;
  isSelected: boolean;
}

export interface CollectionSegmentWithRoute {
  segment: CollectionSegment;
  route: Route;
}

export interface StitchedSegmentInfo {
  routeId: string;
  routeName: string;
  position: number;
  startPointIndex: number;
  endPointIndex: number;
  distanceOffsetMeters: number;
  segmentDistanceMeters: number;
  segmentAscentMeters: number;
  segmentDescentMeters: number;
}

export interface StitchedCollection {
  collectionId: string;
  points: RoutePoint[];
  segments: StitchedSegmentInfo[];
  totalDistanceMeters: number;
  totalAscentMeters: number;
  totalDescentMeters: number;
  /** Per-segment raw points, keyed by routeId */
  pointsByRouteId: Record<string, RoutePoint[]>;
}

export interface ActiveRouteData {
  type: "route" | "collection";
  id: string;
  name: string;
  points: RoutePoint[];
  totalDistanceMeters: number;
  totalAscentMeters: number;
  totalDescentMeters: number;
  segments: StitchedSegmentInfo[] | null;
  routeIds: string[];
}

// --- Phase 4b: Offline ---

export type OfflinePackStatus = "idle" | "downloading" | "complete" | "error";

export interface OfflineRouteInfo {
  status: OfflinePackStatus;
  percentage: number;
  downloadedBytes: number;
  estimatedBytes: number;
  downloadedAt: string | null;
  error: string | null;
}
