import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import Constants from "expo-constants";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { ACTIVE_ROUTE_COLOR, INACTIVE_ROUTE_COLOR } from "@/constants";
import { useMapStyle } from "@/hooks/useMapStyle";
import { useThemeColors } from "@/theme";
import {
  isRouteGeometryRequestRenderable,
  preparedRouteGeometryHasError,
  preparedRouteGeometryMatchesRequest,
  usePreparedRouteGeometries,
  type PreparedRouteGeometryRequest,
} from "@/hooks/usePreparedRouteGeometries";
import { allocateMapCoordinateBudget, MAX_ROUTE_MAP_GEOJSON_POINTS } from "@/utils/geo";
import {
  buildFerryMapFeatureCollections,
  type FerryMapFeatureCollections,
} from "@/utils/ferryMapFeatures";
import { Text } from "@/components/ui/text";
import type { DisplayFerryCrossing, RoutePoint } from "@/types";

mapboxgl.accessToken = Constants.expoConfig?.extra?.mapboxAccessToken ?? "";

export interface RoutePreviewMapLayer {
  id: string;
  points: RoutePoint[];
  isActive: boolean;
  cacheKey?: string;
  /** Already bounded display geometry, used for collection variant overlays. */
  geoJSON?: GeoJSON.Feature<GeoJSON.LineString>;
}

interface PreparedPreviewLayer {
  safeId: string;
  isActive: boolean;
  geoJSON: GeoJSON.Feature<GeoJSON.LineString>;
}

interface RoutePreviewMapProps {
  layers: RoutePreviewMapLayer[];
  ferries?: readonly DisplayFerryCrossing[];
  onMapPress?: (coordinate: { latitude: number; longitude: number }) => void;
  selectionPoints?: RoutePoint[];
  accessibilityLabel?: string;
}

type AnyLayer = Record<string, any> & { id: string };
type PreviewThemeColors = ReturnType<typeof useThemeColors>;

const PREVIEW_TOLERANCE_METERS = 20;
const FIT_PADDING = 40;
const MAX_FIT_ZOOM = 13;
const EMPTY_SELECTION_POINTS: RoutePoint[] = [];
const EMPTY_FERRIES: DisplayFerryCrossing[] = [];

function parseStyle(styleJSON: string): mapboxgl.Style {
  try {
    return JSON.parse(styleJSON) as mapboxgl.Style;
  } catch {
    return "mapbox://styles/mapbox/outdoors-v12" as unknown as mapboxgl.Style;
  }
}

function safeLayerId(id: string, index: number): string {
  return `${index}-${id}`.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function isFiniteCoordinate(coordinate: unknown): coordinate is [number, number] {
  return (
    Array.isArray(coordinate) &&
    coordinate.length >= 2 &&
    Number.isFinite(coordinate[0]) &&
    Number.isFinite(coordinate[1])
  );
}

function routeLayersBounds(
  layers: PreparedPreviewLayer[],
  ferryFeatures: FerryMapFeatureCollections,
): mapboxgl.LngLatBounds | null {
  const bounds = new mapboxgl.LngLatBounds();
  let hasPoint = false;
  for (const layer of layers) {
    for (const coordinate of layer.geoJSON.geometry.coordinates) {
      if (!isFiniteCoordinate(coordinate)) continue;
      bounds.extend(coordinate);
      hasPoint = true;
    }
  }
  for (const feature of ferryFeatures.lines.features) {
    for (const coordinate of feature.geometry.coordinates) {
      if (!isFiniteCoordinate(coordinate)) continue;
      bounds.extend(coordinate);
      hasPoint = true;
    }
  }
  return hasPoint ? bounds : null;
}

function getLayerIfAvailable(
  map: mapboxgl.Map,
  id: string,
): ReturnType<mapboxgl.Map["getLayer"]> | undefined {
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
  try {
    return map.getSource(id);
  } catch {
    return undefined;
  }
}

function addLayer(map: mapboxgl.Map, layer: AnyLayer): void {
  if (getLayerIfAvailable(map, layer.id)) return;
  try {
    map.addLayer(layer as mapboxgl.AnyLayer);
  } catch {}
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

function removePreviewRoute(map: mapboxgl.Map, safeId: string): void {
  removeLayer(map, `route-preview-line-${safeId}`);
  removeLayer(map, `route-preview-outline-${safeId}`);
  removeSource(map, `route-preview-source-${safeId}`);
}

function addPreviewRoute(
  map: mapboxgl.Map,
  layer: PreparedPreviewLayer,
  colors: PreviewThemeColors,
): void {
  const isDark = colors.background === "#0E0E0C";
  const sourceId = `route-preview-source-${layer.safeId}`;
  map.addSource(sourceId, { type: "geojson", data: layer.geoJSON });
  addLayer(map, {
    id: `route-preview-outline-${layer.safeId}`,
    type: "line",
    source: sourceId,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": layer.isActive && isDark ? colors.background : colors.surface,
      "line-width": layer.isActive ? (isDark ? 9 : 7) : 6,
      "line-opacity": layer.isActive ? (isDark ? 0.95 : 0.85) : 0.4,
    },
  });
  addLayer(map, {
    id: `route-preview-line-${layer.safeId}`,
    type: "line",
    source: sourceId,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": layer.isActive ? ACTIVE_ROUTE_COLOR : INACTIVE_ROUTE_COLOR,
      "line-width": layer.isActive ? (isDark ? 5.5 : 4.5) : 4,
      "line-opacity": layer.isActive ? 1 : 0.6,
    },
  });
}

function removePreviewFerries(map: mapboxgl.Map): void {
  for (const layerId of [
    "ferry-preview-endpoint-role-labels",
    "ferry-preview-endpoint-labels",
    "ferry-preview-endpoints",
    "ferry-preview-name-labels",
    "ferry-preview-line",
    "ferry-preview-outline",
  ]) {
    removeLayer(map, layerId);
  }
  removeSource(map, "ferry-preview-endpoint-source");
  removeSource(map, "ferry-preview-name-source");
  removeSource(map, "ferry-preview-line-source");
}

function addPreviewFerries(
  map: mapboxgl.Map,
  features: FerryMapFeatureCollections,
  colors: PreviewThemeColors,
): void {
  if (features.lines.features.length === 0) return;

  map.addSource("ferry-preview-line-source", { type: "geojson", data: features.lines });
  addLayer(map, {
    id: "ferry-preview-outline",
    type: "line",
    source: "ferry-preview-line-source",
    layout: { "line-cap": "round", "line-join": "round", "line-sort-key": ["get", "sortKey"] },
    paint: { "line-color": colors.surface, "line-width": 10, "line-opacity": 0.9 },
  });
  addLayer(map, {
    id: "ferry-preview-line",
    type: "line",
    source: "ferry-preview-line-source",
    layout: { "line-cap": "round", "line-join": "round", "line-sort-key": ["get", "sortKey"] },
    paint: {
      "line-color": colors.info,
      "line-width": 6,
      "line-opacity": 0.98,
      "line-dasharray": [1.25, 1],
    },
  });

  map.addSource("ferry-preview-name-source", { type: "geojson", data: features.labels });
  addLayer(map, {
    id: "ferry-preview-name-labels",
    type: "symbol",
    source: "ferry-preview-name-source",
    minzoom: 9,
    layout: {
      "text-field": ["get", "label"],
      "text-size": 12,
      "text-offset": [0, -1.15],
      "text-max-width": 14,
      "text-allow-overlap": false,
      "text-ignore-placement": false,
      "symbol-sort-key": ["get", "sortKey"],
    },
    paint: {
      "text-color": colors.textPrimary,
      "text-halo-color": colors.surface,
      "text-halo-width": 2.5,
    },
  });

  map.addSource("ferry-preview-endpoint-source", { type: "geojson", data: features.endpoints });
  addLayer(map, {
    id: "ferry-preview-endpoints",
    type: "circle",
    source: "ferry-preview-endpoint-source",
    minzoom: 7,
    layout: { "circle-sort-key": ["get", "sortKey"] },
    paint: {
      "circle-color": colors.info,
      "circle-radius": 9,
      "circle-opacity": 0.96,
      "circle-stroke-color": colors.surface,
      "circle-stroke-width": 3,
    },
  });
  addLayer(map, {
    id: "ferry-preview-endpoint-labels",
    type: "symbol",
    source: "ferry-preview-endpoint-source",
    minzoom: 7,
    layout: {
      "text-field": ["get", "label"],
      "text-size": 11,
      "text-allow-overlap": true,
      "text-ignore-placement": true,
      "symbol-sort-key": ["get", "sortKey"],
    },
    paint: { "text-color": colors.surface },
  });
  addLayer(map, {
    id: "ferry-preview-endpoint-role-labels",
    type: "symbol",
    source: "ferry-preview-endpoint-source",
    minzoom: 12,
    layout: {
      "text-field": ["get", "roleLabel"],
      "text-size": 11,
      "text-offset": [0, 1.45],
      "text-anchor": "top",
      "text-allow-overlap": false,
      "text-ignore-placement": false,
      "symbol-sort-key": ["get", "sortKey"],
    },
    paint: {
      "text-color": colors.textPrimary,
      "text-halo-color": colors.surface,
      "text-halo-width": 2.5,
    },
  });
}

export default function RoutePreviewMap({
  layers,
  ferries = EMPTY_FERRIES,
  onMapPress,
  selectionPoints = EMPTY_SELECTION_POINTS,
  accessibilityLabel = "Route preview map",
}: RoutePreviewMapProps) {
  const colors = useThemeColors();
  const mapStyle = useMapStyle();
  const containerRef = useRef<HTMLElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const renderedIdsRef = useRef<string[]>([]);
  const [mapReady, setMapReady] = useState(false);
  const visibleLayers = useMemo(
    () =>
      layers.filter(
        (layer) =>
          layer.points.length >= 2 || (layer.geoJSON?.geometry.coordinates.length ?? 0) >= 2,
      ),
    [layers],
  );
  const ferryMapFeatures = useMemo(() => buildFerryMapFeatureCollections(ferries), [ferries]);

  const routeGeometryRequests = useMemo<PreparedRouteGeometryRequest[]>(() => {
    const layersToPrepare = visibleLayers.filter((layer) => !layer.geoJSON);
    const budgets = allocateMapCoordinateBudget(
      layersToPrepare.map((layer) => layer.points.length),
      MAX_ROUTE_MAP_GEOJSON_POINTS,
    );
    return layersToPrepare.map((layer, index) => ({
      id: layer.id,
      cacheKey: layer.cacheKey ?? layer.id,
      points: layer.points,
      toleranceMeters: PREVIEW_TOLERANCE_METERS,
      maxPoints: budgets[index],
    }));
  }, [visibleLayers]);
  const preparedRouteGeometries = usePreparedRouteGeometries(routeGeometryRequests);
  const isPreparing = routeGeometryRequests.some(
    (request) =>
      isRouteGeometryRequestRenderable(request) &&
      !preparedRouteGeometryMatchesRequest(preparedRouteGeometries[request.id], request),
  );
  const hasPreparationError = routeGeometryRequests.some((request) =>
    preparedRouteGeometryHasError(preparedRouteGeometries[request.id], request),
  );

  const preparedLayers = useMemo<PreparedPreviewLayer[]>(
    () =>
      visibleLayers
        .map((layer, index) => {
          const geoJSON = layer.geoJSON ?? preparedRouteGeometries[layer.id]?.geoJSON;
          if (!geoJSON) return null;
          const safeId = safeLayerId(layer.id, index);
          return {
            safeId,
            isActive: layer.isActive,
            geoJSON,
          };
        })
        .filter((layer): layer is PreparedPreviewLayer => layer != null),
    [preparedRouteGeometries, visibleLayers],
  );

  useEffect(() => {
    if (!containerRef.current) return;
    setMapReady(false);
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: parseStyle(mapStyle.props.styleJSON),
      center: [16.3738, 48.2082],
      zoom: 6,
      attributionControl: false,
      logoPosition: "bottom-left",
    });
    map.dragRotate.disable();
    map.touchZoomRotate.disableRotation();
    mapRef.current = map;
    map.on("load", () => setMapReady(true));

    return () => {
      renderedIdsRef.current = [];
      map.remove();
      mapRef.current = null;
    };
  }, [mapStyle.props.styleJSON]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const idsToRemove = new Set([
      ...renderedIdsRef.current,
      ...preparedLayers.map((layer) => layer.safeId),
    ]);
    for (const safeId of idsToRemove) {
      removePreviewRoute(map, safeId);
    }
    removePreviewFerries(map);

    for (const layer of preparedLayers) {
      addPreviewRoute(map, layer, colors);
    }
    addPreviewFerries(map, ferryMapFeatures, colors);
    renderedIdsRef.current = preparedLayers.map((layer) => layer.safeId);

    const bounds = routeLayersBounds(preparedLayers, ferryMapFeatures);
    if (!bounds) return;
    map.resize();
    map.fitBounds(bounds, {
      padding: FIT_PADDING,
      duration: 0,
      maxZoom: MAX_FIT_ZOOM,
    });
  }, [colors, ferryMapFeatures, mapReady, preparedLayers]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const sourceId = "ferry-selection-source";
    removeLayer(map, "ferry-selection-endpoint-labels");
    removeLayer(map, "ferry-selection-endpoints");
    removeLayer(map, "ferry-selection-line");
    removeSource(map, sourceId);
    if (selectionPoints.length === 0) return;

    const coordinates = selectionPoints.map((point) => [point.longitude, point.latitude]);
    const endpoints =
      coordinates.length === 1
        ? coordinates
        : [coordinates[0], coordinates[coordinates.length - 1]];
    map.addSource(sourceId, {
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features: [
          ...(coordinates.length >= 2
            ? [
                {
                  type: "Feature" as const,
                  properties: { kind: "span" },
                  geometry: { type: "LineString" as const, coordinates },
                },
              ]
            : []),
          ...endpoints.map((coordinate, index) => ({
            type: "Feature" as const,
            properties: { kind: "endpoint", order: index + 1, label: index === 0 ? "B" : "L" },
            geometry: { type: "Point" as const, coordinates: coordinate },
          })),
        ],
      },
    });
    addLayer(map, {
      id: "ferry-selection-line",
      type: "line",
      source: sourceId,
      filter: ["==", ["get", "kind"], "span"],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": colors.info,
        "line-width": 7,
        "line-dasharray": [1.2, 1.2],
      },
    });
    addLayer(map, {
      id: "ferry-selection-endpoints",
      type: "circle",
      source: sourceId,
      filter: ["==", ["get", "kind"], "endpoint"],
      paint: {
        "circle-color": colors.info,
        "circle-radius": 7,
        "circle-stroke-color": colors.surface,
        "circle-stroke-width": 3,
      },
    });
    addLayer(map, {
      id: "ferry-selection-endpoint-labels",
      type: "symbol",
      source: sourceId,
      filter: ["==", ["get", "kind"], "endpoint"],
      layout: {
        "text-field": ["get", "label"],
        "text-size": 11,
        "text-allow-overlap": true,
        "text-ignore-placement": true,
      },
      paint: { "text-color": colors.surface },
    });
  }, [colors, mapReady, selectionPoints]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !onMapPress) return;
    const handleClick = (event: mapboxgl.MapMouseEvent) => {
      onMapPress({ latitude: event.lngLat.lat, longitude: event.lngLat.lng });
    };
    map.getCanvas().style.cursor = "crosshair";
    map.on("click", handleClick);
    return () => {
      map.off("click", handleClick);
      map.getCanvas().style.cursor = "";
    };
  }, [mapReady, onMapPress]);

  return (
    <View className="flex-1" style={{ backgroundColor: colors.background }}>
      <View
        ref={containerRef as unknown as React.RefObject<View>}
        accessible
        accessibilityLabel={accessibilityLabel}
        style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }}
      />
      {(isPreparing || hasPreparationError) && (
        <View
          pointerEvents="none"
          className={
            isPreparing
              ? "absolute inset-0 items-center justify-center bg-background/60"
              : "absolute left-4 right-4 top-4 items-center"
          }
          accessible
          accessibilityRole={isPreparing ? "progressbar" : "alert"}
          accessibilityLiveRegion="polite"
          accessibilityLabel={
            isPreparing ? "Preparing route preview" : "Couldn’t prepare the route preview"
          }
        >
          <View
            className={
              isPreparing
                ? "items-center"
                : "rounded-full border border-border bg-card px-3 py-2 shadow-sm"
            }
          >
            {isPreparing && <ActivityIndicator size="small" color={colors.accent} />}
            <Text
              className={`${isPreparing ? "mt-2 text-foreground" : "text-destructive"} text-[13px] font-barlow-medium`}
            >
              {isPreparing ? "Preparing preview…" : "Couldn’t prepare the route preview"}
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}
