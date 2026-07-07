import React, { useCallback, useEffect, useMemo, useRef } from "react";
import Mapbox, { Camera, MapView as MapboxMapView } from "@rnmapbox/maps";
import Constants from "expo-constants";
import { MAP_LAYER_ANCHOR_IDS } from "@/constants/mapLayers";
import { useMapStyle } from "@/hooks/useMapStyle";
import {
  usePreparedRouteGeometries,
  type PreparedRouteGeometryRequest,
} from "@/hooks/usePreparedRouteGeometries";
import { useRouteGeometryZoom } from "@/hooks/useRouteGeometryZoom";
import { computeBounds } from "@/utils/geo";
import type { RoutePoint } from "@/types";
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
  const { routeGeometryToleranceMeters, updateRouteGeometryZoom } = useRouteGeometryZoom();

  const visibleLayers = useMemo(() => layers.filter((layer) => layer.points.length >= 2), [layers]);

  const bounds = useMemo(() => {
    const points = visibleLayers.flatMap((layer) => layer.points);
    if (points.length < 2) return null;
    return computeBounds(points);
  }, [visibleLayers]);

  const routeGeometryRequests = useMemo<PreparedRouteGeometryRequest[]>(
    () =>
      visibleLayers.map((layer) => ({
        id: layer.id,
        cacheKey: layer.cacheKey ?? layer.id,
        points: layer.points,
        toleranceMeters: routeGeometryToleranceMeters,
      })),
    [routeGeometryToleranceMeters, visibleLayers],
  );
  const preparedRouteGeometries = usePreparedRouteGeometries(routeGeometryRequests);

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
  );
}
