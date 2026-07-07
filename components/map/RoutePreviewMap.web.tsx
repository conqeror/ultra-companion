import React, { useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import Constants from "expo-constants";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { ACTIVE_ROUTE_COLOR, INACTIVE_ROUTE_COLOR } from "@/constants";
import { useMapStyle } from "@/hooks/useMapStyle";
import { useThemeColors } from "@/theme";
import { prepareRouteMapGeoJSONForKey } from "@/utils/geo";
import type { RoutePoint } from "@/types";

mapboxgl.accessToken = Constants.expoConfig?.extra?.mapboxAccessToken ?? "";

export interface RoutePreviewMapLayer {
  id: string;
  points: RoutePoint[];
  isActive: boolean;
  cacheKey?: string;
}

interface PreparedPreviewLayer {
  safeId: string;
  isActive: boolean;
  geoJSON: GeoJSON.Feature<GeoJSON.LineString>;
}

interface RoutePreviewMapProps {
  layers: RoutePreviewMapLayer[];
}

type AnyLayer = Record<string, any> & { id: string };
type PreviewThemeColors = ReturnType<typeof useThemeColors>;

const PREVIEW_TOLERANCE_METERS = 20;
const FIT_PADDING = 40;
const MAX_FIT_ZOOM = 13;

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

function routeLayersBounds(layers: PreparedPreviewLayer[]): mapboxgl.LngLatBounds | null {
  const bounds = new mapboxgl.LngLatBounds();
  let hasPoint = false;
  for (const layer of layers) {
    for (const coordinate of layer.geoJSON.geometry.coordinates) {
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

export default function RoutePreviewMap({ layers }: RoutePreviewMapProps) {
  const colors = useThemeColors();
  const mapStyle = useMapStyle();
  const containerRef = useRef<HTMLElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const renderedIdsRef = useRef<string[]>([]);
  const [mapReady, setMapReady] = useState(false);

  const preparedLayers = useMemo<PreparedPreviewLayer[]>(
    () =>
      layers
        .map((layer, index) => {
          if (layer.points.length < 2) return null;
          const safeId = safeLayerId(layer.id, index);
          return {
            safeId,
            isActive: layer.isActive,
            geoJSON: prepareRouteMapGeoJSONForKey(
              layer.cacheKey ?? layer.id,
              layer.points,
              PREVIEW_TOLERANCE_METERS,
            ),
          };
        })
        .filter((layer): layer is PreparedPreviewLayer => layer != null),
    [layers],
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

    for (const layer of preparedLayers) {
      addPreviewRoute(map, layer, colors);
    }
    renderedIdsRef.current = preparedLayers.map((layer) => layer.safeId);

    const bounds = routeLayersBounds(preparedLayers);
    if (!bounds) return;
    map.resize();
    map.fitBounds(bounds, {
      padding: FIT_PADDING,
      duration: 0,
      maxZoom: MAX_FIT_ZOOM,
    });
  }, [colors, mapReady, preparedLayers]);

  return (
    <View className="flex-1" style={{ backgroundColor: colors.background }}>
      <View
        ref={containerRef as unknown as React.RefObject<View>}
        style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }}
      />
    </View>
  );
}
