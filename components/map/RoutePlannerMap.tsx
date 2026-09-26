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
import {
  allocateMapCoordinateBudget,
  computeBounds,
  MAX_ROUTE_MAP_GEOJSON_POINTS,
} from "@/utils/geo";
import { routePlannerCandidateColor } from "@/services/routePlannerComparison";
import type { RoutePlannerCandidate, RoutingWaypoint } from "@/types";
import RouteLayer from "./RouteLayer";
import MapLayerAnchors from "./MapLayerAnchors";

const token = Constants.expoConfig?.extra?.mapboxAccessToken;
if (token) Mapbox.setAccessToken(token);

interface RoutePlannerMapProps {
  waypoints: RoutingWaypoint[];
  candidates: readonly RoutePlannerCandidate[];
  selectedCandidateId: string | null;
  disabled: boolean;
  onAddPoint: (point: RoutingWaypoint) => void;
}

export default function RoutePlannerMap({
  waypoints,
  candidates,
  selectedCandidateId,
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
  const requests = useMemo(() => {
    const budgets = allocateMapCoordinateBudget(
      candidates.map((candidate) => candidate.route.points.length),
      MAX_ROUTE_MAP_GEOJSON_POINTS,
    );
    return candidates.map((candidate, index) => ({
      id: candidate.id,
      cacheKey: `route-planner-${candidate.id}`,
      points: candidate.route.points,
      toleranceMeters: routeGeometryToleranceMeters,
      maxPoints: budgets[index],
    }));
  }, [candidates, routeGeometryToleranceMeters]);
  const prepared = usePreparedRouteGeometries(requests);
  const selectedCandidate =
    candidates.find((candidate) => candidate.id === selectedCandidateId) ?? candidates[0];
  const renderedCandidates = useMemo(
    () => [
      ...candidates.filter((candidate) => candidate.id !== selectedCandidate?.id),
      ...(selectedCandidate ? [selectedCandidate] : []),
    ],
    [candidates, selectedCandidate],
  );
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
    if (!selectedCandidate?.route.points.length) return;
    const { ne, sw } = computeBounds(selectedCandidate.route.points);
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
        {renderedCandidates.map((candidate) => {
          const request = requests.find((item) => item.id === candidate.id);
          const ready = prepared[candidate.id];
          if (!request || !preparedRouteGeometryMatchesSource(ready, request)) return null;
          return (
            <RouteLayer
              key={`route-${candidate.id}-${mapStyle.styleKey}`}
              routeId={`planner-${candidate.id}`}
              geoJSON={ready.geoJSON}
              isActive={candidate.id === selectedCandidate?.id}
              color={routePlannerCandidateColor(candidate.id)}
              aboveLayerID={MAP_LAYER_ANCHOR_IDS.routeLine}
            />
          );
        })}
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
        {selectedCandidate && (
          <Button
            variant="ghost"
            size="icon"
            className="bg-surface border border-border"
            onPress={fitRoute}
            accessibilityRole="button"
            accessibilityLabel="Show whole selected planned route"
          >
            <Scan color={colors.textPrimary} size={24} />
          </Button>
        )}
      </View>
    </View>
  );
}
