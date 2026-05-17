import React, { useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import Constants from "expo-constants";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { renderToStaticMarkup } from "react-dom/server";
import * as LucideIcons from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import {
  ACTIVE_ROUTE_COLOR,
  INACTIVE_ROUTE_COLOR,
  POI_BEHIND_THRESHOLD_M,
  POI_CATEGORIES,
  POI_CLUSTER_MAX_ZOOM,
  POI_CLUSTER_MIN_ZOOM,
  POI_CLUSTER_RADIUS,
  POI_CLUSTER_SUMMARY_CATEGORIES,
  POI_CLUSTER_SUMMARY_ICON_SYMBOL_SIZE,
  POI_CLUSTER_SUMMARY_PRIORITY_PROPERTY,
  POI_MAP_ICON_IMAGE_SIZE,
  POI_MAP_ICON_INSET,
  POI_MAP_ICON_SYMBOL_SIZE,
  poiClusterSummaryProperty,
  poiMapIconImageId,
  poiMapIconImageIdForCategory,
} from "@/constants";
import { useThemeColors } from "@/theme";
import { gradientColor } from "@/theme/elevation";
import {
  buildRouteMarkerFeatureCollection,
  DISTANCE_MARKER_BUCKETS,
  type DistanceMarkerDistanceRange,
  type DistanceMarkerInterval,
} from "@/utils/routeMarkers";
import { routeDistanceMarkerLayerId } from "@/constants/mapLayers";
import { buildPOIClusterProperties, buildPOIMapFeatureCollections } from "@/utils/poiMapFeatures";
import { toDisplayPOIs } from "@/services/displayDistance";
import { stitchPOIs } from "@/services/stitchingService";
import {
  createRidingHorizonWindow,
  isDistanceInWindow,
  ridingHorizonMetersForMode,
} from "@/utils/ridingHorizon";
import { usePoiStore } from "@/store/poiStore";
import { usePanelStore } from "@/store/panelStore";
import { useClimbStore } from "@/store/climbStore";
import { useMapStore } from "@/store/mapStore";
import { pickRouteRecords } from "@/utils/routeScopedRecords";
import { bucketDistanceForDerivedWork } from "@/utils/distanceBuckets";
import {
  createRidingHorizonWindow as createClimbHorizonWindow,
  filterClimbsToRidingHorizon,
} from "@/utils/ridingHorizon";
import { resolveActiveClimb } from "@/utils/climbSelect";
import {
  getClimbMapBounds,
  getClimbMapSamples,
  getZoomLevelToFitBounds,
} from "@/utils/climbGeometry";
import { buildClimbDistanceMarkerFeatureCollection } from "@/utils/climbDistanceMarkers";
import { displayTemperatureC, temperatureGradientColor } from "@/utils/temperatureOverlay";
import type {
  DisplayClimb,
  DisplayPOI,
  DistanceMarkerMode,
  POI,
  POIMapVisibility,
  RoutePoint,
  StitchedSegmentInfo,
  WeatherPoint,
  WeatherTemperatureDisplayMode,
} from "@/types";
import type { VariantOverlay } from "./VariantOverlayLayer";

mapboxgl.accessToken = Constants.expoConfig?.extra?.mapboxAccessToken ?? "";

export type MapOverlayMode = "normal" | "climbs" | "weather";

export interface MapCanvasRouteLayer {
  id: string;
  key: string;
  isActive: boolean;
  geoJSON: GeoJSON.Feature<GeoJSON.LineString>;
}

interface HighlightedClimbMapState {
  id: string;
  startDistanceMeters: number;
  endDistanceMeters: number;
}

interface MapCanvasProps {
  mapRef: React.RefObject<unknown | null>;
  cameraRef: React.RefObject<unknown | null>;
  lastCamera: React.MutableRefObject<{ center: [number, number]; zoom: number }>;
  initialCamera: { center: [number, number]; zoom: number };
  mapStyle: {
    props: { styleJSON: string };
    styleKey: string;
  };
  cameraPadding: {
    paddingTop: number;
    paddingLeft: number;
    paddingRight: number;
    paddingBottom: number;
  };
  pulsingConfig: { isEnabled: boolean; color: string; radius: number };
  routeLayers: MapCanvasRouteLayer[];
  activeRoutePoints: RoutePoint[] | null;
  activeRouteIds: string[];
  activeSegments: StitchedSegmentInfo[] | null;
  activeDataId: string | null;
  activeContextKey: string | null;
  activeTotalDistanceMeters: number | null;
  activeProgressDistanceMeters: number | null;
  mapOverlayMode: MapOverlayMode;
  activeVariantOverlays: VariantOverlay[];
  weatherRouteId: string | null;
  weatherTimeline: WeatherPoint[];
  weatherTemperatureMode: WeatherTemperatureDisplayMode;
  distanceMarkerMode: DistanceMarkerMode;
  markerIntervalKm?: DistanceMarkerInterval;
  markerDistanceRange?: DistanceMarkerDistanceRange | null;
  etaLabelForDistanceMeters?: (distanceMeters: number) => string | null;
  etaLabelVersion?: string | number | null;
  poiVisibility: POIMapVisibility;
  onTouchStart: () => void;
  onCameraChanged: (state: { properties: { center: number[]; zoom: number } }) => void;
  onClusterPress: (center: [number, number], zoomLevel: number) => void;
  setFollowUser: (follow: boolean) => void;
}

type AnyLayer = Record<string, any> & { id: string };
type WebCameraOptions = {
  centerCoordinate?: [number, number];
  zoomLevel?: number;
  animationDuration?: number;
  bounds?: {
    ne: [number, number];
    sw: [number, number];
    paddingTop?: number;
    paddingRight?: number;
    paddingBottom?: number;
    paddingLeft?: number;
  };
  padding?: {
    paddingTop?: number;
    paddingRight?: number;
    paddingBottom?: number;
    paddingLeft?: number;
  };
};

const CLUSTER_FILTER = ["has", "point_count"] as const;
const UNCLUSTERED_FILTER = ["!", ["has", "point_count"]] as const;
const SORT_KEY_FIELD = ["get", "sortKey"] as const;
const POI_ICON_COLOR = "#FFFFFF";
const POI_CLUSTER_PROPERTIES = buildPOIClusterProperties();
const CLUSTER_OVERFLOW_TEXT_OFFSET = [0.45, 0] as const;
const FALLBACK_ICON_NAME = "MapPin";
const MAPBOX_ICON_PIXEL_RATIO = 2;
const WEB_POI_ICON_STROKE_WIDTH = 1.65;
const CLIMB_PAN_PADDING = {
  top: 72,
  right: 32,
  bottom: 40,
  left: 32,
};
const POI_INTERACTIVE_LAYERS = [
  "poi-icons",
  "poi-circles",
  "poi-starred-icons",
  "poi-starred-fill",
] as const;

const iconNames = Array.from(
  new Set([...POI_CATEGORIES.map((category) => category.iconName), FALLBACK_ICON_NAME]),
);

function mapboxPadding(
  padding?: WebCameraOptions["padding"] | WebCameraOptions["bounds"],
): mapboxgl.PaddingOptions {
  return {
    top: padding?.paddingTop ?? 0,
    right: padding?.paddingRight ?? 0,
    bottom: padding?.paddingBottom ?? 0,
    left: padding?.paddingLeft ?? 0,
  };
}

function isFiniteCoordinate(coordinate: unknown): coordinate is [number, number] {
  return (
    Array.isArray(coordinate) &&
    coordinate.length >= 2 &&
    Number.isFinite(coordinate[0]) &&
    Number.isFinite(coordinate[1])
  );
}

function cameraSet(map: mapboxgl.Map, options: WebCameraOptions): void {
  if (options.bounds?.ne && options.bounds.sw) {
    const { ne, sw } = options.bounds;
    if (!isFiniteCoordinate(ne) || !isFiniteCoordinate(sw)) return;
    map.fitBounds([sw, ne], {
      padding: mapboxPadding(options.bounds),
      duration: options.animationDuration ?? 500,
    });
    return;
  }

  const center = options.centerCoordinate;
  if (center && !isFiniteCoordinate(center)) return;

  map.easeTo({
    ...(center ? { center } : {}),
    ...(Number.isFinite(options.zoomLevel) ? { zoom: options.zoomLevel } : {}),
    ...(options.padding ? { padding: mapboxPadding(options.padding) } : {}),
    duration: options.animationDuration ?? 500,
  });
}

function parseStyle(styleJSON: string): mapboxgl.Style {
  try {
    return JSON.parse(styleJSON) as mapboxgl.Style;
  } catch {
    return "mapbox://styles/mapbox/outdoors-v12" as unknown as mapboxgl.Style;
  }
}

function emptyFeatureCollection<
  T extends GeoJSON.Geometry = GeoJSON.Geometry,
>(): GeoJSON.FeatureCollection<T> {
  return { type: "FeatureCollection", features: [] };
}

function routeLayersBounds(routeLayers: MapCanvasRouteLayer[]): mapboxgl.LngLatBounds | null {
  const bounds = new mapboxgl.LngLatBounds();
  let hasPoint = false;
  for (const route of routeLayers) {
    for (const coordinate of route.geoJSON.geometry.coordinates) {
      if (!isFiniteCoordinate(coordinate)) continue;
      bounds.extend(coordinate);
      hasPoint = true;
    }
  }
  return hasPoint ? bounds : null;
}

function upsertSource(
  map: mapboxgl.Map,
  id: string,
  data: GeoJSON.FeatureCollection | GeoJSON.Feature,
  options: Omit<mapboxgl.GeoJSONSourceRaw, "type" | "data"> = {},
): void {
  if (!isMapStyleAvailable(map)) return;
  const source = getSourceIfAvailable(map, id) as mapboxgl.GeoJSONSource | undefined;
  if (source) {
    try {
      source.setData(data);
    } catch {}
    return;
  }
  try {
    map.addSource(id, { type: "geojson", data, ...options });
  } catch {}
}

function isMapStyleAvailable(map: mapboxgl.Map): boolean {
  return Boolean((map as unknown as { style?: unknown }).style);
}

function getLayerIfAvailable(
  map: mapboxgl.Map,
  id: string,
): ReturnType<mapboxgl.Map["getLayer"]> | undefined {
  if (!isMapStyleAvailable(map)) return undefined;
  try {
    return map.getLayer(id);
  } catch {
    return undefined;
  }
}

function getSourceIfAvailable(
  map: mapboxgl.Map,
  id: string,
): ReturnType<mapboxgl.Map["getSource"]> | undefined {
  if (!isMapStyleAvailable(map)) return undefined;
  try {
    return map.getSource(id);
  } catch {
    return undefined;
  }
}

function addLayer(map: mapboxgl.Map, layer: AnyLayer): void {
  if (!isMapStyleAvailable(map) || getLayerIfAvailable(map, layer.id)) return;
  try {
    map.addLayer(omitUndefinedProperties(layer) as mapboxgl.AnyLayer);
  } catch {}
}

function omitUndefinedProperties<T extends Record<string, unknown>>(value: T): T {
  const entries = Object.entries(value).filter(([, entryValue]) => entryValue !== undefined);
  return Object.fromEntries(entries) as T;
}

function removeLayer(map: mapboxgl.Map, id: string): void {
  if (!getLayerIfAvailable(map, id)) return;
  try {
    map.removeLayer(id);
  } catch {}
}

function removeSource(map: mapboxgl.Map, id: string): void {
  if (!getSourceIfAvailable(map, id)) return;
  try {
    map.removeSource(id);
  } catch {}
}

function existingLayerIds(map: mapboxgl.Map, layerIds: readonly string[]): string[] {
  return layerIds.filter((layerId) => getLayerIfAvailable(map, layerId));
}

function clusterCategoryCountExpression(category: (typeof POI_CLUSTER_SUMMARY_CATEGORIES)[number]) {
  return ["coalesce", ["get", poiClusterSummaryProperty(category)], 0];
}

function clusterHasCategoryExpression(category: (typeof POI_CLUSTER_SUMMARY_CATEGORIES)[number]) {
  return [">", clusterCategoryCountExpression(category), 0];
}

function countExpressions(expressions: unknown[][]): number | unknown[] {
  if (expressions.length === 0) return 0;
  if (expressions.length === 1) return expressions[0];
  return ["+", ...expressions];
}

const CLUSTER_SUMMARY_TOTAL_EXPRESSION = countExpressions(
  POI_CLUSTER_SUMMARY_CATEGORIES.map((category) => [
    "case",
    clusterHasCategoryExpression(category),
    1,
    0,
  ]),
);
const CLUSTER_SUMMARY_PRIORITY_EXPRESSION = [
  "coalesce",
  ["get", POI_CLUSTER_SUMMARY_PRIORITY_PROPERTY],
  POI_CLUSTER_SUMMARY_CATEGORIES.length,
];
const CLUSTER_SUMMARY_ICON_OFFSET = [
  "case",
  [">", CLUSTER_SUMMARY_TOTAL_EXPRESSION, 1],
  ["literal", [-4, 0]],
  ["literal", [0, 0]],
];

function clusterSummaryIconExpression(): unknown[] {
  const expression: unknown[] = ["match", CLUSTER_SUMMARY_PRIORITY_EXPRESSION];
  POI_CLUSTER_SUMMARY_CATEGORIES.forEach((category, index) => {
    expression.push(index);
    expression.push(poiMapIconImageIdForCategory(category));
  });
  expression.push(poiMapIconImageId(FALLBACK_ICON_NAME));
  return expression;
}

function svgDataUrlForIcon(iconName: string): string {
  const Icon =
    (LucideIcons as unknown as Record<string, React.ComponentType<any>>)[iconName] ??
    (LucideIcons as unknown as Record<string, React.ComponentType<any>>)[FALLBACK_ICON_NAME];
  const size = POI_MAP_ICON_IMAGE_SIZE * MAPBOX_ICON_PIXEL_RATIO;
  const inset = POI_MAP_ICON_INSET * MAPBOX_ICON_PIXEL_RATIO;
  const markup = renderToStaticMarkup(
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
    >
      <g transform={`translate(${inset / 2} ${inset / 2})`}>
        <Icon
          color={POI_ICON_COLOR}
          size={size - inset}
          strokeWidth={WEB_POI_ICON_STROKE_WIDTH * MAPBOX_ICON_PIXEL_RATIO}
        />
      </g>
    </svg>,
  );
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image), { once: true });
    image.addEventListener("error", () => reject(new Error("Failed to load POI icon image")), {
      once: true,
    });
    image.src = src;
  });
}

async function imageDataForIcon(iconName: string): Promise<ImageData | null> {
  if (typeof document === "undefined") return null;

  const size = POI_MAP_ICON_IMAGE_SIZE * MAPBOX_ICON_PIXEL_RATIO;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;

  const context = canvas.getContext("2d");
  if (!context) return null;

  const image = await loadImageElement(svgDataUrlForIcon(iconName));
  context.clearRect(0, 0, size, size);
  context.drawImage(image, 0, 0, size, size);
  return context.getImageData(0, 0, size, size);
}

async function ensurePOIImages(map: mapboxgl.Map): Promise<void> {
  await Promise.all(
    iconNames.map(async (iconName) => {
      try {
        const id = poiMapIconImageId(iconName);
        if (map.hasImage(id)) return;
        const imageData = await imageDataForIcon(iconName);
        if (!imageData || map.hasImage(id)) return;
        map.addImage(id, imageData as never, { pixelRatio: MAPBOX_ICON_PIXEL_RATIO });
      } catch (error) {
        if (__DEV__) {
          console.warn(`Failed to register POI icon ${iconName}:`, error);
        }
      }
    }),
  );
}

function findPressedPOI(features: mapboxgl.MapboxGeoJSONFeature[], pois: DisplayPOI[]) {
  const id = features[0]?.properties?.poiId;
  return typeof id === "string" ? pois.find((poi) => poi.id === id) : undefined;
}

function buildClimbHighlight(
  climb: DisplayClimb | null,
  points: RoutePoint[] | null,
): {
  line: GeoJSON.Feature<GeoJSON.LineString> | null;
  gradient: unknown[] | null;
  markers: GeoJSON.FeatureCollection<GeoJSON.Point>;
  hiddenRange: HighlightedClimbMapState | null;
} {
  if (!climb || !points?.length) {
    return { line: null, gradient: null, markers: emptyFeatureCollection(), hiddenRange: null };
  }

  const samples = getClimbMapSamples(
    points,
    climb.effectiveStartDistanceMeters,
    climb.effectiveEndDistanceMeters,
  );
  if (samples.length < 2) {
    return { line: null, gradient: null, markers: emptyFeatureCollection(), hiddenRange: null };
  }

  const startDist = samples[0].distanceFromStartMeters;
  const totalDist = samples[samples.length - 1].distanceFromStartMeters - startDist;
  if (totalDist <= 0) {
    return { line: null, gradient: null, markers: emptyFeatureCollection(), hiddenRange: null };
  }

  const stops: (number | string)[] = [];
  for (let i = 0; i < samples.length - 1; i++) {
    const a = samples[i];
    const b = samples[i + 1];
    const segDist = b.distanceFromStartMeters - a.distanceFromStartMeters;
    if (segDist <= 0) continue;
    const grade = (((b.elevationMeters ?? 0) - (a.elevationMeters ?? 0)) / segDist) * 100;
    stops.push(Math.max(0, Math.min(1, (a.distanceFromStartMeters - startDist) / totalDist)));
    stops.push(gradientColor(grade));
  }
  stops.push(1, stops[stops.length - 1] ?? gradientColor(0));

  return {
    line: {
      type: "Feature",
      properties: {},
      geometry: {
        type: "LineString",
        coordinates: samples.map((point) => [point.longitude, point.latitude]),
      },
    },
    gradient: ["interpolate", ["linear"], ["line-progress"], ...stops],
    markers: buildClimbDistanceMarkerFeatureCollection({
      points,
      startDistanceMeters: climb.effectiveStartDistanceMeters,
      endDistanceMeters: climb.effectiveEndDistanceMeters,
    }),
    hiddenRange: {
      id: climb.id,
      startDistanceMeters: climb.effectiveStartDistanceMeters,
      endDistanceMeters: climb.effectiveEndDistanceMeters,
    },
  };
}

function buildWeatherOverlay(
  points: RoutePoint[] | null,
  timeline: WeatherPoint[],
  temperatureMode: WeatherTemperatureDisplayMode,
) {
  if (!points || points.length < 2 || timeline.length < 2) return null;
  const sorted = timeline
    .filter((point) => point.phase === "route" && Number.isFinite(point.routeDistanceMeters))
    .slice()
    .sort((a, b) => a.routeDistanceMeters - b.routeDistanceMeters);
  if (sorted.length < 2) return null;

  const startDist = sorted[0].routeDistanceMeters;
  const endDist = sorted[sorted.length - 1].routeDistanceMeters;
  const overlayPoints = points.filter(
    (point) =>
      point.distanceFromStartMeters >= startDist && point.distanceFromStartMeters <= endDist,
  );
  if (overlayPoints.length < 2 || endDist <= startDist) return null;

  const stops = sorted.flatMap((sample) => [
    Math.max(0, Math.min(1, (sample.routeDistanceMeters - startDist) / (endDist - startDist))),
    temperatureGradientColor(displayTemperatureC(sample, temperatureMode)),
  ]);
  if (stops.length < 4) return null;

  return {
    line: {
      type: "Feature",
      properties: {},
      geometry: {
        type: "LineString",
        coordinates: overlayPoints.map((point) => [point.longitude, point.latitude]),
      },
    } as GeoJSON.Feature<GeoJSON.LineString>,
    gradient: ["interpolate", ["linear"], ["line-progress"], ...stops],
    labels: {
      type: "FeatureCollection",
      features: sorted.slice(0, 6).map((sample) => ({
        type: "Feature",
        properties: { label: `${Math.round(displayTemperatureC(sample, temperatureMode))}°` },
        geometry: { type: "Point", coordinates: [sample.longitude, sample.latitude] },
      })),
    } as GeoJSON.FeatureCollection<GeoJSON.Point>,
  };
}

function addRouteMarkerLayers(
  map: mapboxgl.Map,
  points: RoutePoint[],
  distanceMarkerMode: DistanceMarkerMode,
  markerIntervalKm: DistanceMarkerInterval | undefined,
  markerDistanceRange: DistanceMarkerDistanceRange | null | undefined,
  etaLabelForDistanceMeters: ((distanceMeters: number) => string | null) | undefined,
  hiddenDistanceRange: HighlightedClimbMapState | null,
  colors: ReturnType<typeof useThemeColors>,
): void {
  const showDistanceMarkers = distanceMarkerMode !== "off";
  const shape = buildRouteMarkerFeatureCollection({
    points,
    distanceMarkerMode,
    markerIntervalKm,
    markerDistanceRange,
    etaLabelForDistanceMeters,
  });
  upsertSource(map, "route-marker-source", shape);

  for (const bucket of DISTANCE_MARKER_BUCKETS) {
    const layerId = routeDistanceMarkerLayerId(bucket.intervalKm);
    const intervalFilter = ["==", ["%", ["get", "distanceKm"], bucket.intervalKm], 0];
    const rangeFilter =
      hiddenDistanceRange == null
        ? null
        : [
            "any",
            ["<", ["get", "distanceMeters"], hiddenDistanceRange.startDistanceMeters],
            [">", ["get", "distanceMeters"], hiddenDistanceRange.endDistanceMeters],
          ];
    const filter =
      bucket.intervalKm === 100
        ? [
            "all",
            ["==", ["get", "kind"], "distance"],
            ["any", intervalFilter, ["==", ["get", "isOverviewMarker"], true]],
          ]
        : ["all", ["==", ["get", "kind"], "distance"], intervalFilter];
    addLayer(map, {
      id: layerId,
      type: "symbol",
      source: "route-marker-source",
      filter: rangeFilter ? ["all", filter, rangeFilter] : filter,
      minzoom: bucket.minZoom,
      maxzoom: bucket.maxZoom,
      layout: {
        "text-field": ["get", "markerLabel"],
        "text-size": 12,
        "text-allow-overlap": true,
        "text-ignore-placement": true,
        "symbol-sort-key": SORT_KEY_FIELD,
        visibility: showDistanceMarkers ? "visible" : "none",
      },
      paint: {
        "text-color": "#FFFFFF",
        "text-halo-color": "#1C1A18",
        "text-halo-width": 4,
        "text-halo-blur": 0.5,
      },
    });
  }

  const endpointFilter = [
    "any",
    ["==", ["get", "kind"], "start"],
    ["==", ["get", "kind"], "finish"],
  ];
  addLayer(map, {
    id: "route-endpoint-outline",
    type: "circle",
    source: "route-marker-source",
    filter: endpointFilter,
    paint: { "circle-radius": 15, "circle-color": colors.surface, "circle-opacity": 0.95 },
  });
  addLayer(map, {
    id: "route-start-marker",
    type: "circle",
    source: "route-marker-source",
    filter: ["==", ["get", "kind"], "start"],
    paint: { "circle-radius": 11, "circle-color": colors.positive },
  });
  addLayer(map, {
    id: "route-finish-marker",
    type: "circle",
    source: "route-marker-source",
    filter: ["==", ["get", "kind"], "finish"],
    paint: { "circle-radius": 11, "circle-color": colors.textPrimary },
  });
  addLayer(map, {
    id: "route-endpoint-label",
    type: "symbol",
    source: "route-marker-source",
    filter: endpointFilter,
    layout: {
      "text-field": ["get", "markerLabel"],
      "text-size": 11,
      "text-allow-overlap": true,
      "text-ignore-placement": true,
      "symbol-sort-key": SORT_KEY_FIELD,
    },
    paint: { "text-color": colors.surface },
  });
}

function MapCanvas({
  mapRef,
  cameraRef,
  lastCamera,
  initialCamera,
  mapStyle,
  cameraPadding,
  pulsingConfig,
  routeLayers,
  activeRoutePoints,
  activeRouteIds,
  activeSegments,
  activeDataId,
  activeContextKey,
  activeTotalDistanceMeters,
  activeProgressDistanceMeters,
  mapOverlayMode,
  activeVariantOverlays,
  weatherRouteId,
  weatherTimeline,
  weatherTemperatureMode,
  distanceMarkerMode,
  markerIntervalKm,
  markerDistanceRange,
  etaLabelForDistanceMeters,
  etaLabelVersion,
  poiVisibility,
  onTouchStart,
  onCameraChanged,
  onClusterPress,
  setFollowUser,
}: MapCanvasProps) {
  const colors = useThemeColors();
  const containerRef = useRef<HTMLElement | null>(null);
  const mapboxRef = useRef<mapboxgl.Map | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const lastFitKey = useRef<string | null>(null);
  const selectedPOI = usePoiStore((s) => s.selectedPOI);
  const setSelectedPOI = usePoiStore((s) => s.setSelectedPOI);
  const userPosition = useMapStore((s) => s.userPosition);
  const getVisiblePOIs = usePoiStore((s) => s.getVisiblePOIs);
  const getStarredPOIs = usePoiStore((s) => s.getStarredPOIs);
  const enabledCategories = usePoiStore((s) => s.enabledCategories);
  const starredPOIIds = usePoiStore((s) => s.starredPOIIds);
  const allPois = usePoiStore((s) => s.pois);
  const panelMode = usePanelStore((s) => s.panelMode);
  const panelModeForClimbs = usePanelStore((s) => s.panelMode);
  const getClimbsForDisplay = useClimbStore((s) => s.getClimbsForDisplay);
  const selectedClimb = useClimbStore((s) => s.selectedClimb);
  const routeClimbs = useClimbStore(useShallow((s) => pickRouteRecords(s.climbs, activeRouteIds)));
  const derivedProgressDistanceMeters = bucketDistanceForDerivedWork(activeProgressDistanceMeters);

  const climbHorizonWindow = useMemo(
    () =>
      createClimbHorizonWindow(
        derivedProgressDistanceMeters,
        ridingHorizonMetersForMode(panelModeForClimbs),
        { totalDistanceMeters: activeTotalDistanceMeters ?? undefined },
      ),
    [derivedProgressDistanceMeters, panelModeForClimbs, activeTotalDistanceMeters],
  );

  const highlightedClimb = useMemo(() => {
    if (mapOverlayMode !== "climbs") return null;
    const displayed = filterClimbsToRidingHorizon(
      getClimbsForDisplay(activeRouteIds, activeSegments),
      climbHorizonWindow,
    );
    const selected =
      selectedClimb && displayed.some((climb) => climb.id === selectedClimb.id)
        ? selectedClimb
        : null;
    return resolveActiveClimb(displayed, derivedProgressDistanceMeters, selected);
    // routeClimbs is a reactivity trigger: getClimbsForDisplay reads store via get()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    mapOverlayMode,
    selectedClimb,
    activeRouteIds,
    activeSegments,
    derivedProgressDistanceMeters,
    climbHorizonWindow,
    routeClimbs,
    getClimbsForDisplay,
  ]);

  const visiblePOIs = useMemo(() => {
    const canShowSelected =
      selectedPOI != null &&
      (activeRouteIds.length === 0 || activeRouteIds.includes(selectedPOI.routeId));

    if (poiVisibility === "none") return canShowSelected ? [selectedPOI] : [];

    const distanceWindow = createRidingHorizonWindow(
      activeProgressDistanceMeters,
      ridingHorizonMetersForMode(panelMode),
      { behindMeters: POI_BEHIND_THRESHOLD_M },
    );

    if (activeSegments) {
      const poisByRoute: Record<string, POI[]> = {};
      for (const routeId of activeRouteIds) {
        poisByRoute[routeId] =
          poiVisibility === "starred" ? getStarredPOIs(routeId) : getVisiblePOIs(routeId);
      }
      const stitched = stitchPOIs(activeSegments, poisByRoute, distanceWindow);
      if (canShowSelected && !stitched.some((poi) => poi.id === selectedPOI.id)) {
        return [...stitched, selectedPOI];
      }
      return stitched;
    }

    const combined: DisplayPOI[] = [];
    for (const routeId of activeRouteIds) {
      const sourcePOIs =
        poiVisibility === "starred" ? getStarredPOIs(routeId) : getVisiblePOIs(routeId);
      combined.push(
        ...toDisplayPOIs(
          sourcePOIs.filter((poi) =>
            isDistanceInWindow(poi.distanceAlongRouteMeters, distanceWindow),
          ),
        ),
      );
    }
    if (canShowSelected && !combined.some((poi) => poi.id === selectedPOI.id)) {
      combined.push(selectedPOI);
    }
    return combined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeRouteIds,
    activeSegments,
    activeProgressDistanceMeters,
    panelMode,
    allPois,
    enabledCategories,
    starredPOIIds,
    selectedPOI,
    poiVisibility,
    getStarredPOIs,
    getVisiblePOIs,
  ]);

  const highlightedPOIIds = useMemo(() => {
    if (!selectedPOI) return starredPOIIds;
    return new Set([...starredPOIIds, selectedPOI.id]);
  }, [selectedPOI, starredPOIIds]);

  const poiFeatureCollections = useMemo(
    () => buildPOIMapFeatureCollections(visiblePOIs, highlightedPOIIds),
    [visiblePOIs, highlightedPOIIds],
  );

  const climbHighlight = useMemo(
    () => buildClimbHighlight(highlightedClimb, activeRoutePoints),
    [highlightedClimb, activeRoutePoints],
  );

  const weatherOverlay = useMemo(
    () =>
      mapOverlayMode === "weather" && activeDataId === weatherRouteId
        ? buildWeatherOverlay(activeRoutePoints, weatherTimeline, weatherTemperatureMode)
        : null,
    [
      mapOverlayMode,
      activeDataId,
      weatherRouteId,
      activeRoutePoints,
      weatherTimeline,
      weatherTemperatureMode,
    ],
  );

  useEffect(() => {
    if (!containerRef.current) return;
    setMapReady(false);
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: parseStyle(mapStyle.props.styleJSON),
      center: initialCamera.center,
      zoom: initialCamera.zoom,
      attributionControl: false,
      logoPosition: "bottom-left",
    });
    const mapRefObject = mapRef as React.MutableRefObject<unknown>;
    const cameraRefObject = cameraRef as React.MutableRefObject<unknown>;
    mapboxRef.current = map;
    mapRefObject.current = map;
    cameraRefObject.current = {
      setCamera: (options: WebCameraOptions) => cameraSet(map, options),
    };

    const handleMove = () => {
      const center = map.getCenter();
      const zoom = map.getZoom();
      lastCamera.current = { center: [center.lng, center.lat], zoom };
      onCameraChanged({ properties: { center: [center.lng, center.lat], zoom } });
    };
    map.on("load", () => {
      ensurePOIImages(map).finally(() => setMapReady(true));
    });
    map.on("moveend", handleMove);
    map.on("zoomend", handleMove);
    map.on("dragstart", onTouchStart);
    map.on("mousedown", onTouchStart);
    map.on("touchstart", onTouchStart);

    return () => {
      map.remove();
      mapboxRef.current = null;
      mapRefObject.current = null;
      cameraRefObject.current = null;
    };
  }, [
    cameraRef,
    initialCamera.center,
    initialCamera.zoom,
    lastCamera,
    mapRef,
    mapStyle.props.styleJSON,
    mapStyle.styleKey,
    onCameraChanged,
    onTouchStart,
  ]);

  useEffect(() => {
    const map = mapboxRef.current;
    if (!map || !mapReady || !selectedPOI) return;
    setFollowUser(false);
    cameraSet(map, {
      centerCoordinate: [selectedPOI.longitude, selectedPOI.latitude],
      zoomLevel: 14,
      padding: cameraPadding,
      animationDuration: 500,
    });
  }, [cameraPadding, mapReady, selectedPOI, setFollowUser]);

  useEffect(() => {
    const map = mapboxRef.current;
    if (!map || !mapReady || !highlightedClimb || !activeRoutePoints?.length) return;
    const climbBounds = getClimbMapBounds(
      activeRoutePoints,
      highlightedClimb.effectiveStartDistanceMeters,
      highlightedClimb.effectiveEndDistanceMeters,
    );
    if (!climbBounds) return;
    const currentZoom = map.getZoom();
    const container = map.getContainer();
    setFollowUser(false);
    cameraSet(map, {
      centerCoordinate: climbBounds.center,
      padding: {
        paddingTop: 0,
        paddingRight: cameraPadding.paddingRight,
        paddingBottom: cameraPadding.paddingBottom,
        paddingLeft: cameraPadding.paddingLeft,
      },
      zoomLevel: getZoomLevelToFitBounds(
        currentZoom,
        climbBounds,
        container.clientWidth,
        container.clientHeight,
        {
          top: CLIMB_PAN_PADDING.top,
          right: cameraPadding.paddingRight + CLIMB_PAN_PADDING.right,
          bottom: cameraPadding.paddingBottom + CLIMB_PAN_PADDING.bottom,
          left: cameraPadding.paddingLeft + CLIMB_PAN_PADDING.left,
        },
      ),
      animationDuration: 500,
    });
  }, [mapReady, highlightedClimb, activeRoutePoints, cameraPadding, setFollowUser]);

  useEffect(() => {
    const map = mapboxRef.current;
    if (!map || !mapReady) return;
    const key = `${activeContextKey ?? "none"}:${routeLayers.map((route) => route.key).join("|")}`;
    if (lastFitKey.current === key) return;
    const bounds = routeLayersBounds(routeLayers);
    if (!bounds) return;
    lastFitKey.current = key;
    map.fitBounds(bounds, {
      padding: {
        top: Math.max(24, cameraPadding.paddingTop),
        right: Math.max(24, cameraPadding.paddingRight),
        bottom: Math.max(48, cameraPadding.paddingBottom),
        left: Math.max(24, cameraPadding.paddingLeft),
      },
      duration: 500,
      maxZoom: 13,
    });
  }, [activeContextKey, cameraPadding, mapReady, routeLayers]);

  useEffect(() => {
    const map = mapboxRef.current;
    if (!map || !mapReady) return;
    void etaLabelVersion;

    const removableLayers = [
      ...routeLayers.flatMap((route) => [`route-outline-${route.id}`, `route-line-${route.id}`]),
      "collection-variant-overlay-outline",
      "collection-variant-overlay-line",
      "collection-variant-overlay-labels",
      "weather-temperature-route-outline",
      "weather-temperature-route-line",
      "weather-temperature-labels",
      "climb-highlight-outline",
      "climb-highlight-line",
      "climb-distance-marker-label",
      ...DISTANCE_MARKER_BUCKETS.map((bucket) => routeDistanceMarkerLayerId(bucket.intervalKm)),
      "route-endpoint-label",
      "route-finish-marker",
      "route-start-marker",
      "route-endpoint-outline",
      "poi-starred-icons",
      "poi-starred-fill",
      "poi-starred-outline",
      "poi-icons",
      "poi-circles",
      "poi-circles-outline",
      "poi-cluster-summary-overflow",
      "poi-cluster-summary-icon",
      "poi-clusters-fill",
      "poi-clusters-outline",
      "user-location-pulse",
      "user-location-dot",
    ];
    for (const layerId of removableLayers) removeLayer(map, layerId);
    for (const route of routeLayers) removeSource(map, `route-source-${route.id}`);
    for (const sourceId of [
      "collection-variant-overlay-source",
      "collection-variant-overlay-label-source",
      "weather-temperature-route-source",
      "weather-temperature-label-source",
      "climb-highlight-source",
      "climb-distance-marker-source",
      "route-marker-source",
      "poi-clustered-source",
      "poi-starred-source",
      "user-location-source",
    ]) {
      removeSource(map, sourceId);
    }

    const isDark = colors.background === "#0E0E0C";
    const hasClimbHighlight = climbHighlight.hiddenRange != null;

    for (const route of routeLayers) {
      if (route.geoJSON.geometry.coordinates.length < 2) continue;
      const sourceId = `route-source-${route.id}`;
      upsertSource(map, sourceId, route.geoJSON);
      addLayer(map, {
        id: `route-outline-${route.id}`,
        type: "line",
        source: sourceId,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": route.isActive && isDark ? colors.background : colors.surface,
          "line-width": route.isActive ? (isDark ? 9 : 7) : 6,
          "line-opacity": route.isActive ? (isDark ? 0.95 : 0.85) : 0.4,
        },
      });
      addLayer(map, {
        id: `route-line-${route.id}`,
        type: "line",
        source: sourceId,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color":
            route.isActive && !hasClimbHighlight ? ACTIVE_ROUTE_COLOR : INACTIVE_ROUTE_COLOR,
          "line-width": route.isActive ? (isDark ? 5.5 : 4.5) : 4,
          "line-opacity": route.isActive && !hasClimbHighlight ? 1 : 0.6,
        },
      });
    }

    const variantLines: GeoJSON.Feature<GeoJSON.LineString>[] = [];
    const variantLabels: GeoJSON.Feature<GeoJSON.Point>[] = [];
    for (const overlay of activeVariantOverlays) {
      if (overlay.points.length < 2) continue;
      variantLines.push({
        type: "Feature",
        properties: { id: overlay.id },
        geometry: {
          type: "LineString",
          coordinates: overlay.points.map((point) => [point.longitude, point.latitude]),
        },
      });
      const middle = overlay.points[Math.floor(overlay.points.length / 2)];
      if (middle) {
        variantLabels.push({
          type: "Feature",
          properties: { id: overlay.id, label: overlay.label },
          geometry: { type: "Point", coordinates: [middle.longitude, middle.latitude] },
        });
      }
    }
    if (variantLines.length > 0) {
      upsertSource(map, "collection-variant-overlay-source", {
        type: "FeatureCollection",
        features: variantLines,
      });
      addLayer(map, {
        id: "collection-variant-overlay-outline",
        type: "line",
        source: "collection-variant-overlay-source",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": colors.surface,
          "line-width": ["interpolate", ["linear"], ["zoom"], 8, 4.5, 13, 7],
          "line-opacity": 0.45,
        },
      });
      addLayer(map, {
        id: "collection-variant-overlay-line",
        type: "line",
        source: "collection-variant-overlay-source",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": INACTIVE_ROUTE_COLOR,
          "line-width": ["interpolate", ["linear"], ["zoom"], 8, 3, 13, 5],
          "line-opacity": 0.65,
        },
      });
      if (variantLabels.length > 0) {
        upsertSource(map, "collection-variant-overlay-label-source", {
          type: "FeatureCollection",
          features: variantLabels,
        });
        addLayer(map, {
          id: "collection-variant-overlay-labels",
          type: "symbol",
          source: "collection-variant-overlay-label-source",
          layout: {
            "text-field": ["get", "label"],
            "text-size": ["interpolate", ["linear"], ["zoom"], 8, 0, 9, 10, 13, 11],
            "text-allow-overlap": false,
            "text-ignore-placement": false,
            "text-offset": [0, -1],
          },
          paint: {
            "text-opacity": ["interpolate", ["linear"], ["zoom"], 8, 0, 9, 0.82],
            "text-color": colors.textSecondary,
            "text-halo-color": colors.surface,
            "text-halo-width": 2,
          },
        });
      }
    }

    if (weatherOverlay) {
      upsertSource(map, "weather-temperature-route-source", weatherOverlay.line, {
        lineMetrics: true,
      });
      addLayer(map, {
        id: "weather-temperature-route-outline",
        type: "line",
        source: "weather-temperature-route-source",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": colors.surface,
          "line-width": ["interpolate", ["linear"], ["zoom"], 8, 6, 13, 10],
          "line-opacity": 0.9,
        },
      });
      addLayer(map, {
        id: "weather-temperature-route-line",
        type: "line",
        source: "weather-temperature-route-source",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-gradient": weatherOverlay.gradient,
          "line-width": ["interpolate", ["linear"], ["zoom"], 8, 4, 13, 7],
          "line-opacity": 1,
        },
      });
      upsertSource(map, "weather-temperature-label-source", weatherOverlay.labels);
      addLayer(map, {
        id: "weather-temperature-labels",
        type: "symbol",
        source: "weather-temperature-label-source",
        layout: {
          "text-field": ["get", "label"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 9, 0, 10, 11, 14, 13],
          "text-allow-overlap": false,
          "text-ignore-placement": false,
          "text-offset": [0, -1.15],
        },
        paint: {
          "text-opacity": ["interpolate", ["linear"], ["zoom"], 9, 0, 10, 1],
          "text-color": colors.textPrimary,
          "text-halo-color": colors.surface,
          "text-halo-width": 2,
        },
      });
    }

    if (climbHighlight.line && climbHighlight.gradient) {
      upsertSource(map, "climb-highlight-source", climbHighlight.line, { lineMetrics: true });
      addLayer(map, {
        id: "climb-highlight-outline",
        type: "line",
        source: "climb-highlight-source",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": colors.surface, "line-width": 8, "line-opacity": 0.9 },
      });
      addLayer(map, {
        id: "climb-highlight-line",
        type: "line",
        source: "climb-highlight-source",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-gradient": climbHighlight.gradient, "line-width": 6, "line-opacity": 1 },
      });
      if (climbHighlight.markers.features.length > 0) {
        upsertSource(map, "climb-distance-marker-source", climbHighlight.markers);
        addLayer(map, {
          id: "climb-distance-marker-label",
          type: "symbol",
          source: "climb-distance-marker-source",
          layout: {
            "text-field": ["get", "markerLabel"],
            "text-size": 12,
            "text-allow-overlap": true,
            "text-ignore-placement": true,
            "symbol-sort-key": SORT_KEY_FIELD,
          },
          paint: {
            "text-color": "#FFFFFF",
            "text-halo-color": "#1C1A18",
            "text-halo-width": 4,
            "text-halo-blur": 0.5,
          },
        });
      }
    }

    if (activeRoutePoints?.length) {
      addRouteMarkerLayers(
        map,
        activeRoutePoints,
        distanceMarkerMode,
        markerIntervalKm,
        markerDistanceRange,
        etaLabelForDistanceMeters,
        climbHighlight.hiddenRange,
        colors,
      );
    }

    if (poiFeatureCollections.clustered.features.length > 0) {
      upsertSource(map, "poi-clustered-source", poiFeatureCollections.clustered, {
        cluster: true,
        clusterRadius: POI_CLUSTER_RADIUS,
        clusterMaxZoom: POI_CLUSTER_MAX_ZOOM,
        clusterProperties: POI_CLUSTER_PROPERTIES as any,
      });
      addLayer(map, {
        id: "poi-clusters-outline",
        type: "circle",
        source: "poi-clustered-source",
        filter: CLUSTER_FILTER,
        minzoom: POI_CLUSTER_MIN_ZOOM,
        paint: {
          "circle-radius": ["step", ["get", "point_count"], 17, 10, 20, 50, 23],
          "circle-color": colors.surface,
        },
      });
      addLayer(map, {
        id: "poi-clusters-fill",
        type: "circle",
        source: "poi-clustered-source",
        filter: CLUSTER_FILTER,
        minzoom: POI_CLUSTER_MIN_ZOOM,
        paint: {
          "circle-radius": ["step", ["get", "point_count"], 14, 10, 17, 50, 20],
          "circle-color": colors.accent,
        },
      });
      addLayer(map, {
        id: "poi-cluster-summary-icon",
        type: "symbol",
        source: "poi-clustered-source",
        filter: CLUSTER_FILTER,
        minzoom: POI_CLUSTER_MIN_ZOOM,
        layout: {
          "icon-image": clusterSummaryIconExpression(),
          "icon-size": POI_CLUSTER_SUMMARY_ICON_SYMBOL_SIZE,
          "icon-offset": CLUSTER_SUMMARY_ICON_OFFSET,
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
        paint: { "icon-color": POI_ICON_COLOR },
      });
      addLayer(map, {
        id: "poi-cluster-summary-overflow",
        type: "symbol",
        source: "poi-clustered-source",
        filter: ["all", CLUSTER_FILTER, [">", CLUSTER_SUMMARY_TOTAL_EXPRESSION, 1]],
        minzoom: POI_CLUSTER_MIN_ZOOM,
        layout: {
          "text-field": "+",
          "text-size": 13,
          "text-offset": CLUSTER_OVERFLOW_TEXT_OFFSET,
          "text-allow-overlap": true,
          "text-ignore-placement": true,
        },
        paint: { "text-color": colors.accentForeground },
      });
      addLayer(map, {
        id: "poi-circles-outline",
        type: "circle",
        source: "poi-clustered-source",
        filter: UNCLUSTERED_FILTER,
        minzoom: 10,
        paint: { "circle-radius": 13, "circle-color": colors.surface, "circle-opacity": 0.84 },
      });
      addLayer(map, {
        id: "poi-circles",
        type: "circle",
        source: "poi-clustered-source",
        filter: UNCLUSTERED_FILTER,
        minzoom: 10,
        paint: { "circle-radius": 10, "circle-color": ["get", "color"], "circle-opacity": 0.78 },
      });
      addLayer(map, {
        id: "poi-icons",
        type: "symbol",
        source: "poi-clustered-source",
        filter: UNCLUSTERED_FILTER,
        minzoom: 10,
        layout: {
          "icon-image": ["get", "iconImage"],
          "icon-size": POI_MAP_ICON_SYMBOL_SIZE,
          "icon-allow-overlap": false,
          "icon-ignore-placement": false,
        },
        paint: {
          "icon-color": POI_ICON_COLOR,
          "icon-halo-color": colors.surface,
          "icon-halo-width": 1,
          "icon-opacity": 0.92,
        },
      });
    }

    if (poiFeatureCollections.starred.features.length > 0) {
      upsertSource(map, "poi-starred-source", poiFeatureCollections.starred);
      addLayer(map, {
        id: "poi-starred-outline",
        type: "circle",
        source: "poi-starred-source",
        minzoom: 8,
        paint: { "circle-radius": 17, "circle-color": colors.warning },
      });
      addLayer(map, {
        id: "poi-starred-fill",
        type: "circle",
        source: "poi-starred-source",
        minzoom: 8,
        paint: { "circle-radius": 11, "circle-color": ["get", "color"] },
      });
      addLayer(map, {
        id: "poi-starred-icons",
        type: "symbol",
        source: "poi-starred-source",
        minzoom: 8,
        layout: {
          "icon-image": ["get", "iconImage"],
          "icon-size": POI_MAP_ICON_SYMBOL_SIZE,
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
        paint: {
          "icon-color": POI_ICON_COLOR,
          "icon-halo-color": colors.surface,
          "icon-halo-width": 1,
        },
      });
    }

    if (userPosition) {
      upsertSource(map, "user-location-source", {
        type: "Feature",
        properties: {},
        geometry: { type: "Point", coordinates: [userPosition.longitude, userPosition.latitude] },
      });
      if (pulsingConfig.isEnabled) {
        addLayer(map, {
          id: "user-location-pulse",
          type: "circle",
          source: "user-location-source",
          paint: {
            "circle-radius": pulsingConfig.radius / 2,
            "circle-color": pulsingConfig.color,
            "circle-opacity": 0.18,
          },
        });
      }
      addLayer(map, {
        id: "user-location-dot",
        type: "circle",
        source: "user-location-source",
        paint: {
          "circle-radius": 7,
          "circle-color": pulsingConfig.color,
          "circle-stroke-color": colors.surface,
          "circle-stroke-width": 3,
        },
      });
    }
  }, [
    activeRoutePoints,
    activeVariantOverlays,
    climbHighlight,
    colors,
    mapReady,
    poiFeatureCollections,
    pulsingConfig,
    routeLayers,
    distanceMarkerMode,
    markerIntervalKm,
    markerDistanceRange,
    etaLabelForDistanceMeters,
    etaLabelVersion,
    userPosition,
    weatherOverlay,
  ]);

  useEffect(() => {
    const map = mapboxRef.current;
    if (!map || !mapReady) return;

    const handleClusterClick = (event: mapboxgl.MapLayerMouseEvent) => {
      const feature = event.features?.[0];
      const coordinates = feature?.geometry.type === "Point" ? feature.geometry.coordinates : null;
      const clusterId = feature?.properties?.cluster_id;
      if (!isFiniteCoordinate(coordinates) || clusterId == null) return;
      const source = getSourceIfAvailable(map, "poi-clustered-source") as
        | mapboxgl.GeoJSONSource
        | undefined;
      source?.getClusterExpansionZoom(Number(clusterId), (error: Error | null, zoom?: number) => {
        onClusterPress(coordinates, error || zoom == null ? POI_CLUSTER_MAX_ZOOM + 1 : zoom);
      });
    };
    const handlePOIClick = (event: mapboxgl.MapLayerMouseEvent) => {
      const layers = existingLayerIds(map, POI_INTERACTIVE_LAYERS);
      if (!layers?.length) return;
      const features = map.queryRenderedFeatures(event.point, {
        layers,
      });
      const poi = findPressedPOI(features, visiblePOIs);
      if (poi) setSelectedPOI(poi);
    };

    for (const layer of ["poi-clusters-fill", "poi-cluster-summary-icon"]) {
      if (getLayerIfAvailable(map, layer)) map.on("click", layer, handleClusterClick);
    }
    for (const layer of POI_INTERACTIVE_LAYERS) {
      if (getLayerIfAvailable(map, layer)) map.on("click", layer, handlePOIClick);
    }

    return () => {
      for (const layer of ["poi-clusters-fill", "poi-cluster-summary-icon"]) {
        if (getLayerIfAvailable(map, layer)) map.off("click", layer, handleClusterClick);
      }
      for (const layer of POI_INTERACTIVE_LAYERS) {
        if (getLayerIfAvailable(map, layer)) map.off("click", layer, handlePOIClick);
      }
    };
  }, [mapReady, onClusterPress, setSelectedPOI, visiblePOIs]);

  return (
    <View className="flex-1" style={{ backgroundColor: colors.background }}>
      <View
        ref={containerRef as unknown as React.RefObject<View>}
        style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }}
      />
    </View>
  );
}

export default React.memo(MapCanvas);
