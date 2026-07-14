import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { ActivityIndicator, View } from "react-native";
import Mapbox, { Camera, MapView as MapboxMapView } from "@rnmapbox/maps";
import Constants from "expo-constants";
import { MAP_LAYER_ANCHOR_IDS } from "@/constants/mapLayers";
import { useMapStyle } from "@/hooks/useMapStyle";
import {
  isRouteGeometryRequestRenderable,
  preparedRouteGeometryHasError,
  preparedRouteGeometryMatchesRequest,
  usePreparedRouteGeometries,
  type PreparedRouteGeometryRequest,
} from "@/hooks/usePreparedRouteGeometries";
import { useRouteGeometryZoom } from "@/hooks/useRouteGeometryZoom";
import { allocateMapCoordinateBudget, MAX_ROUTE_MAP_GEOJSON_POINTS } from "@/utils/geo";
import type { RoutePoint } from "@/types";
import { Text } from "@/components/ui/text";
import { useThemeColors } from "@/theme";
import MapLayerAnchors from "./MapLayerAnchors";
import RouteLayer from "./RouteLayer";

try {
  const mapboxToken = Constants.expoConfig?.extra?.mapboxAccessToken;
  if (mapboxToken) {
    Mapbox.setAccessToken(mapboxToken);
  }
} catch (e) {
  console.warn("Failed to set Mapbox access token:", e);
}

export interface RoutePreviewMapLayer {
  id: string;
  points: RoutePoint[];
  isActive: boolean;
  cacheKey?: string;
}

interface RoutePreviewMapProps {
  layers: RoutePreviewMapLayer[];
}

const FIT_PADDING = 40;

export default function RoutePreviewMap({ layers }: RoutePreviewMapProps) {
  const cameraRef = useRef<Camera>(null);
  const mapStyle = useMapStyle();
  const colors = useThemeColors();
  const { routeGeometryToleranceMeters, updateRouteGeometryZoom } = useRouteGeometryZoom();

  const visibleLayers = useMemo(() => layers.filter((layer) => layer.points.length >= 2), [layers]);

  const routeGeometryRequests = useMemo<PreparedRouteGeometryRequest[]>(() => {
    const budgets = allocateMapCoordinateBudget(
      visibleLayers.map((layer) => layer.points.length),
      MAX_ROUTE_MAP_GEOJSON_POINTS,
    );
    return visibleLayers.map((layer, index) => ({
      id: layer.id,
      cacheKey: layer.cacheKey ?? layer.id,
      points: layer.points,
      toleranceMeters: routeGeometryToleranceMeters,
      maxPoints: budgets[index],
    }));
  }, [routeGeometryToleranceMeters, visibleLayers]);
  const preparedRouteGeometries = usePreparedRouteGeometries(routeGeometryRequests);
  const isPreparing = routeGeometryRequests.some(
    (request) =>
      isRouteGeometryRequestRenderable(request) &&
      !preparedRouteGeometryMatchesRequest(preparedRouteGeometries[request.id], request),
  );
  const hasPreparationError = routeGeometryRequests.some((request) =>
    preparedRouteGeometryHasError(preparedRouteGeometries[request.id], request),
  );
  const bounds = useMemo(() => {
    let minLongitude = Infinity;
    let minLatitude = Infinity;
    let maxLongitude = -Infinity;
    let maxLatitude = -Infinity;
    for (const layer of visibleLayers) {
      const coordinates = preparedRouteGeometries[layer.id]?.geoJSON.geometry.coordinates ?? [];
      for (const coordinate of coordinates) {
        if (!Number.isFinite(coordinate[0]) || !Number.isFinite(coordinate[1])) continue;
        minLongitude = Math.min(minLongitude, coordinate[0]);
        minLatitude = Math.min(minLatitude, coordinate[1]);
        maxLongitude = Math.max(maxLongitude, coordinate[0]);
        maxLatitude = Math.max(maxLatitude, coordinate[1]);
      }
    }
    if (!Number.isFinite(minLongitude) || !Number.isFinite(minLatitude)) return null;
    return {
      ne: [maxLongitude, maxLatitude] as [number, number],
      sw: [minLongitude, minLatitude] as [number, number],
    };
  }, [preparedRouteGeometries, visibleLayers]);

  useEffect(() => {
    if (!bounds) return;
    cameraRef.current?.setCamera({
      bounds: {
        ne: bounds.ne,
        sw: bounds.sw,
        paddingLeft: FIT_PADDING,
        paddingRight: FIT_PADDING,
        paddingTop: FIT_PADDING,
        paddingBottom: FIT_PADDING,
      },
      animationDuration: 300,
    });
  }, [bounds]);

  const handleCameraChanged = useCallback(
    (state: { properties: { zoom: number } }) => {
      updateRouteGeometryZoom(state.properties.zoom);
    },
    [updateRouteGeometryZoom],
  );

  return (
    <View className="flex-1">
      <MapboxMapView
        style={{ flex: 1 }}
        {...mapStyle.props}
        compassEnabled={false}
        scaleBarEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
        scrollEnabled={true}
        zoomEnabled={true}
        onCameraChanged={handleCameraChanged}
      >
        <Camera
          ref={cameraRef}
          defaultSettings={
            bounds
              ? {
                  bounds: {
                    ne: bounds.ne,
                    sw: bounds.sw,
                    paddingLeft: FIT_PADDING,
                    paddingRight: FIT_PADDING,
                    paddingTop: FIT_PADDING,
                    paddingBottom: FIT_PADDING,
                  },
                }
              : undefined
          }
        />
        <MapLayerAnchors key={`map-layer-anchors-${mapStyle.styleKey}`} />
        {visibleLayers.map((layer) => {
          const prepared = preparedRouteGeometries[layer.id];
          if (!prepared) return null;
          return (
            <RouteLayer
              key={`${layer.id}-${mapStyle.styleKey}`}
              routeId={layer.id}
              geoJSON={prepared.geoJSON}
              isActive={layer.isActive}
              aboveLayerID={MAP_LAYER_ANCHOR_IDS.routeLine}
            />
          );
        })}
      </MapboxMapView>
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
