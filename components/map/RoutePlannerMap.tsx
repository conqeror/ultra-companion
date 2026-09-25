import React, { useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, View } from "react-native";
import Mapbox, { Camera, CircleLayer, MapView, ShapeSource, SymbolLayer } from "@rnmapbox/maps";
import Constants from "expo-constants";
import { LocateFixed, Scan } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import { MAP_LAYER_ANCHOR_IDS } from "@/constants/mapLayers";
import { useMapStyle } from "@/hooks/useMapStyle";
import { useRouteGeometryZoom } from "@/hooks/useRouteGeometryZoom";
import {
  preparedRouteGeometryMatchesSource,
  usePreparedRouteGeometries,
} from "@/hooks/usePreparedRouteGeometries";
import { useMapStore } from "@/store/mapStore";
import { useThemeColors } from "@/theme";
import { computeBounds, MAX_ROUTE_MAP_GEOJSON_POINTS } from "@/utils/geo";
import type { RoutePoint, RoutingWaypoint } from "@/types";
import RouteLayer from "./RouteLayer";
import MapLayerAnchors from "./MapLayerAnchors";

const token = Constants.expoConfig?.extra?.mapboxAccessToken;
if (token) Mapbox.setAccessToken(token);

interface RoutePlannerMapProps {
  waypoints: RoutingWaypoint[];
  points: RoutePoint[] | null;
  disabled: boolean;
  onAddPoint: (point: RoutingWaypoint) => void;
}

export default function RoutePlannerMap({
  waypoints,
  points,
  disabled,
  onAddPoint,
}: RoutePlannerMapProps) {
  const camera = useRef<Camera>(null);
  const initialCamera = useRef({
    centerCoordinate: useMapStore.getState().center,
    zoomLevel: useMapStore.getState().zoom,
  });
  const colors = useThemeColors();
  const mapStyle = useMapStyle();
  const [locating, setLocating] = useState(false);
  const { routeGeometryToleranceMeters, updateRouteGeometryZoom } = useRouteGeometryZoom();
  const requests = useMemo(
    () =>
      points
        ? [
            {
              id: "planner",
              cacheKey: "route-planner",
              points,
              toleranceMeters: routeGeometryToleranceMeters,
              maxPoints: MAX_ROUTE_MAP_GEOJSON_POINTS,
            },
          ]
        : [],
    [points, routeGeometryToleranceMeters],
  );
  const prepared = usePreparedRouteGeometries(requests);
  const geometry =
    requests[0] && preparedRouteGeometryMatchesSource(prepared.planner, requests[0])
      ? prepared.planner.geoJSON
      : null;
  const markers = useMemo<GeoJSON.FeatureCollection<GeoJSON.Point>>(
    () => ({
      type: "FeatureCollection",
      features: waypoints.map((point, index) => ({
        type: "Feature",
        properties: {
          label: index === 0 ? "S" : index === waypoints.length - 1 ? "E" : String(index),
        },
        geometry: { type: "Point", coordinates: [point.longitude, point.latitude] },
      })),
    }),
    [waypoints],
  );

  const fitRoute = () => {
    if (!points?.length) return;
    const { ne, sw } = computeBounds(points);
    camera.current?.fitBounds(ne, sw, [55, 70, 45, 45], 300);
  };

  const locate = async () => {
    if (locating) return;
    setLocating(true);
    try {
      const position = await useMapStore.getState().refreshPosition();
      if (position) {
        camera.current?.setCamera({
          centerCoordinate: [position.longitude, position.latitude],
          zoomLevel: 13,
          animationDuration: 300,
        });
      } else {
        Alert.alert(
          "Location unavailable",
          "Allow location access in Settings, or move the map to your starting point.",
        );
      }
    } catch {
      Alert.alert("Location unavailable", "Move the map to your starting point or try again.");
    } finally {
      setLocating(false);
    }
  };

  return (
    <View className="flex-1">
      <MapView
        style={{ flex: 1 }}
        {...mapStyle.props}
        rotateEnabled={false}
        pitchEnabled={false}
        scaleBarEnabled={false}
        compassEnabled={false}
        accessibilityLabel="Route planning map. Tap to add a route point."
        onCameraChanged={(state) => updateRouteGeometryZoom(state.properties.zoom)}
        onPress={(event) => {
          if (disabled || event.geometry.type !== "Point") return;
          onAddPoint({
            longitude: event.geometry.coordinates[0],
            latitude: event.geometry.coordinates[1],
          });
        }}
      >
        <Camera ref={camera} defaultSettings={initialCamera.current} />
        <MapLayerAnchors key={`anchors-${mapStyle.styleKey}`} />
        {geometry && (
          <RouteLayer
            key={`route-${mapStyle.styleKey}`}
            routeId="planner"
            geoJSON={geometry}
            isActive
            aboveLayerID={MAP_LAYER_ANCHOR_IDS.routeLine}
          />
        )}
        <ShapeSource key={`points-${mapStyle.styleKey}`} id="planner-points" shape={markers}>
          <CircleLayer
            id="planner-point-circles"
            aboveLayerID={MAP_LAYER_ANCHOR_IDS.routeMarkerSymbol}
            style={{
              circleRadius: 13,
              circleColor: colors.accent,
              circleStrokeColor: colors.surface,
              circleStrokeWidth: 3,
            }}
          />
          <SymbolLayer
            id="planner-point-labels"
            aboveLayerID="planner-point-circles"
            style={{
              textField: ["get", "label"],
              textSize: 13,
              textColor: colors.accentForeground,
              textAllowOverlap: true,
              textIgnorePlacement: true,
            }}
          />
        </ShapeSource>
      </MapView>
      <View className="absolute right-3 top-3 gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="bg-surface border border-border"
          disabled={locating || disabled}
          accessibilityRole="button"
          accessibilityLabel="Center planning map on my location"
          onPress={() => void locate()}
        >
          {locating ? (
            <ActivityIndicator color={colors.accent} />
          ) : (
            <LocateFixed color={colors.textPrimary} size={24} />
          )}
        </Button>
        {points && (
          <Button
            variant="ghost"
            size="icon"
            className="bg-surface border border-border"
            onPress={fitRoute}
            accessibilityRole="button"
            accessibilityLabel="Show whole planned route"
          >
            <Scan color={colors.textPrimary} size={24} />
          </Button>
        )}
      </View>
    </View>
  );
}
