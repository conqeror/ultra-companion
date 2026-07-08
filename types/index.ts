export interface UserPosition {
  latitude: number;
  longitude: number;
  altitude: number | null;
  heading: number | null;
  speed: number | null;
  timestamp: number;
}

export type UnitSystem = "metric" | "imperial";

export type WeatherTemperatureDisplayMode = "actual" | "feels-like";

export type WeatherSampleKind = "hourly" | "distance" | "finish" | "post-finish";

export type WeatherTimelineMetricKey = "precipitation" | "humidity" | "gusts";

export type POIMapVisibility = "none" | "starred" | "all";

export type DistanceMarkerMode = "off" | "distance" | "eta";

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

export interface RouteImportFailure {
  fileName: string;
  reason: string;
}

export interface RouteImportProgress {
  current: number;
  total: number;
  fileName: string;
}

export interface RouteImportSummary {
  imported: Route[];
  failed: RouteImportFailure[];
  total: number;
}

export interface SnappedPosition {
  routeId: string;
  pointIndex: number;
  distanceAlongRouteMeters: number;
  distanceFromRouteMeters: number;
}

declare const ActiveRouteProgressBrand: unique symbol;
export type ActiveRouteProgress = SnappedPosition & {
  readonly [ActiveRouteProgressBrand]: true;
};

export type RouteSnapConfidence = "high" | "medium" | "low";

export interface RouteSnapCandidate {
  pointIndex: number;
  segmentIndex: number;
  projectedFraction: number;
  distanceAlongRouteMeters: number;
  distanceFromRouteMeters: number;
  segmentBearingDegrees: number;
}

export interface RouteSnapResult {
  routeId: string;
  selectedCandidate: RouteSnapCandidate;
  candidates: RouteSnapCandidate[];
  confidence: RouteSnapConfidence;
  isAmbiguous: boolean;
  snappedPosition: SnappedPosition;
}

export interface RouteSnapHistorySample {
  routeId: string;
  latitude: number;
  longitude: number;
  timestamp: number;
  heading: number | null;
  speed: number | null;
  selectedCandidate: RouteSnapCandidate;
}

declare const DisplayDistanceMetersBrand: unique symbol;
export type DisplayDistanceMeters = number & {
  readonly [DisplayDistanceMetersBrand]: true;
};

// --- Phase 2b: Panel types ---

export type PanelMode =
  | "upcoming-10"
  | "upcoming-25"
  | "upcoming-50"
  | "upcoming-100"
  | "upcoming-200"
  | "full-route";

export type PanelTab = "profile" | "upcoming" | "weather" | "climbs" | "pois";

// --- Phase 3: POI types ---

export type POICategory =
  | "water"
  | "groceries"
  | "gas_station"
  | "bakery"
  | "toilet_shower"
  | "shelter"
  | "camp_site"
  | "pharmacy"
  | "bike_shop"
  | "repair_station"
  | "pump_air"
  | "other";

export type POICategoryGroup = "water" | "food" | "wc" | "rest" | "help" | "repair" | "other";

export type POIFetchedSource = "osm" | "google";
export type POISource = POIFetchedSource | "custom";

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

export interface DisplayPOI extends POI {
  effectiveDistanceMeters: DisplayDistanceMeters;
}

export type StarredEntityType = "poi";

export interface StarredItem {
  entityType: StarredEntityType;
  entityId: string;
  createdAt: string;
}

export interface POICategoryMeta {
  key: POICategory;
  label: string;
  group: POICategoryGroup;
  color: string;
  iconName: string;
}

export type POIDiscoverySource = POIFetchedSource;

export interface POIDiscoveryGroupMeta {
  key: string;
  label: string;
  detail: string;
  categories: POICategory[];
  defaultEnabled: boolean;
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

export type RelativeETAScope = "route" | "collection";

export type RelativeETAStatus = "idle" | "loading" | "computing" | "ready" | "error";

export interface RelativeETAProgress {
  computedPoints: number;
  totalPoints: number;
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
  /** Display order in the weather timeline */
  hourOffset: number;
  /** Whether this row is on-route or forecast after route finish */
  phase: "route" | "post-finish";
  /** Sampling source for route timeline display/filtering */
  sampleKind: WeatherSampleKind;
  /** All sampling sources this row satisfies, for filter chips */
  sampleKinds: WeatherSampleKind[];
  /** ISO 8601 time string */
  time: string;
  /** ISO 8601 estimated arrival time at this route forecast point */
  etaTime: string;
  /** Temperature in °C */
  temperatureC: number;
  /** Apparent/feels-like temperature in °C */
  apparentTemperatureC: number;
  /** Dew point in °C */
  dewPointC: number;
  /** Relative humidity 0–100 */
  relativeHumidityPercent: number;
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
  /** Open-Meteo daylight flag */
  isDay: boolean;
  /** Latitude of the waypoint this forecast is for */
  latitude: number;
  /** Longitude of the waypoint this forecast is for */
  longitude: number;
  /** Distance along route from current position (meters) */
  distanceAlongRouteM: number;
  /** Absolute distance from route start (meters) */
  routeDistanceMeters: number;
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
  plannedStartMs: number | null;
}

export type CollectionSegmentVariantKind = "full" | "patch";

export interface CollectionSegment {
  collectionId: string;
  routeId: string;
  position: number;
  isSelected: boolean;
  variantKind: CollectionSegmentVariantKind;
  baseRouteId: string | null;
  replaceStartDistanceMeters: number | null;
  replaceEndDistanceMeters: number | null;
}

export interface CollectionSegmentWithRoute {
  segment: CollectionSegment;
  route: Route;
  baseRoute?: Route | null;
}

export type StitchedSourceSpanKind = "full" | "base-prefix" | "patch" | "base-suffix";

export interface StitchedSourceSpan {
  routeId: string;
  routeName: string;
  position: number;
  kind: StitchedSourceSpanKind;
  startPointIndex: number;
  endPointIndex: number;
  rawStartDistanceMeters: number;
  rawEndDistanceMeters: number;
  effectiveStartDistanceMeters: DisplayDistanceMeters;
  effectiveEndDistanceMeters: DisplayDistanceMeters;
  distanceOffsetMeters: number;
}

export interface StitchedSegmentInfo {
  routeId: string;
  routeName: string;
  position: number;
  variantKind: CollectionSegmentVariantKind;
  baseRouteId: string | null;
  replaceStartDistanceMeters: number | null;
  replaceEndDistanceMeters: number | null;
  startPointIndex: number;
  endPointIndex: number;
  distanceOffsetMeters: number;
  segmentDistanceMeters: number;
  segmentAscentMeters: number;
  segmentDescentMeters: number;
  sourceSpans: StitchedSourceSpan[];
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
  sourceSpans: StitchedSourceSpan[];
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
  pointsByRouteId: Record<string, RoutePoint[]>;
}

// --- Climb Detection ---

export interface Climb {
  id: string;
  routeId: string;
  name: string | null;
  startDistanceMeters: number;
  endDistanceMeters: number;
  lengthMeters: number;
  totalAscentMeters: number;
  startElevationMeters: number;
  endElevationMeters: number;
  averageGradientPercent: number;
  maxGradientPercent: number;
  difficultyScore: number;
}

export interface DisplayClimb extends Climb {
  effectiveDistanceMeters: DisplayDistanceMeters;
  effectiveStartDistanceMeters: DisplayDistanceMeters;
  effectiveEndDistanceMeters: DisplayDistanceMeters;
}

export type ClimbDifficulty = "low" | "medium" | "hard";

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
