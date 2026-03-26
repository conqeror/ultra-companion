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

export const MAP_STYLE_URLS: Record<MapStyle, string> = {
  streets: "mapbox://styles/mapbox/streets-v12",
  outdoors: "mapbox://styles/mapbox/outdoors-v12",
  satellite: "mapbox://styles/mapbox/satellite-streets-v12",
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
  | "full";

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

export interface ParsedRoute {
  name: string;
  points: RoutePoint[];
  totalDistanceMeters: number;
  totalAscentMeters: number;
  totalDescentMeters: number;
}
