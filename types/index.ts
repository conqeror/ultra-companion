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
