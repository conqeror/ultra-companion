import React, { useEffect, useState, useMemo, useRef } from "react";
import {
  View,
  ScrollView,
  useWindowDimensions,
  ActivityIndicator,
} from "react-native";
import { useLocalSearchParams, Stack } from "expo-router";
import { Camera, MapView as MapboxMapView } from "@rnmapbox/maps";
import { Text } from "@/components/ui/text";
import { useThemeColors } from "@/theme";
import { useRouteStore } from "@/store/routeStore";
import { useSettingsStore } from "@/store/settingsStore";
import { usePoiStore } from "@/store/poiStore";
import { useClimbStore } from "@/store/climbStore";
import type { RouteWithPoints } from "@/types";
import { useMapStyle } from "@/hooks/useMapStyle";
import { formatDistance, formatElevation } from "@/utils/formatters";
import { computeElevationProgress, computeBounds } from "@/utils/geo";
import ElevationProfile from "@/components/elevation/ElevationProfile";
import RouteLayer from "@/components/map/RouteLayer";
import StatBox from "@/components/common/StatBox";
import DataSection from "@/components/route/DataSection";

export default function RouteDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { width: screenWidth } = useWindowDimensions();
  const cameraRef = useRef<Camera>(null);
  const colors = useThemeColors();
  const mapStyle = useMapStyle();

  const [route, setRoute] = useState<RouteWithPoints | null>(null);
  const [loading, setLoading] = useState(true);

  const getRouteDetail = useRouteStore((s) => s.getRouteDetail);
  const snappedPosition = useRouteStore((s) => s.snappedPosition);
  const units = useSettingsStore((s) => s.units);
  const loadPOIs = usePoiStore((s) => s.loadPOIs);
  const getStarredPOIs = usePoiStore((s) => s.getStarredPOIs);
  const starredPOIIds = usePoiStore((s) => s.starredPOIIds);
  const setSelectedPOI = usePoiStore((s) => s.setSelectedPOI);

  useEffect(() => {
    if (!id) return;
    (async () => {
      const detail = await getRouteDetail(id);
      setRoute(detail);
      setLoading(false);
    })();
  }, [id, getRouteDetail]);

  const loadClimbs = useClimbStore((s) => s.loadClimbs);
  const routeClimbs = useClimbStore((s) => id ? s.climbs[id] ?? [] : []);

  useEffect(() => {
    if (id) {
      loadPOIs(id);
      loadClimbs(id);
    }
  }, [id, loadPOIs, loadClimbs]);

  const currentPointIndex = useMemo(() => {
    if (snappedPosition?.routeId === id) return snappedPosition.pointIndex;
    return undefined;
  }, [snappedPosition, id]);

  const elevProgress = useMemo(() => {
    if (currentPointIndex == null || !route) return null;
    return computeElevationProgress(route.points, currentPointIndex);
  }, [currentPointIndex, route]);

  const chartPOIs = useMemo(() => {
    if (!id) return [];
    return getStarredPOIs(id);
  }, [id, getStarredPOIs, starredPOIIds]);

  const bounds = useMemo(() => {
    if (!route?.points.length) return null;
    return computeBounds(route.points);
  }, [route]);

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  if (!route) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <Text className="text-[17px] text-muted-foreground">Route not found</Text>
      </View>
    );
  }

  const chartWidth = screenWidth - 32;
  const chartHeight = 220;

  return (
    <>
      <Stack.Screen options={{ title: route.name }} />
      <ScrollView
        className="flex-1 bg-background"
        contentContainerStyle={{ paddingBottom: 40 }}
      >
        {/* Mini map */}
        <View className="h-[250px] mx-4 mt-4 rounded-xl overflow-hidden">
          <MapboxMapView
            style={{ flex: 1 }}
            {...mapStyle.props}
            compassEnabled={false}
            scaleBarEnabled={false}
            rotateEnabled={false}
            scrollEnabled={true}
            zoomEnabled={true}
          >
            <Camera
              ref={cameraRef}
              defaultSettings={
                bounds
                  ? {
                      bounds: {
                        ne: bounds.ne,
                        sw: bounds.sw,
                        paddingLeft: 40,
                        paddingRight: 40,
                        paddingTop: 40,
                        paddingBottom: 40,
                      },
                    }
                  : undefined
              }
            />
            <RouteLayer key={mapStyle.styleKey} route={route} points={route.points} />
          </MapboxMapView>
        </View>

        {/* Stats */}
        <View className="flex-row px-4 mt-3 mb-3 gap-3">
          <StatBox
            label="Distance"
            value={formatDistance(route.totalDistanceMeters, units)}
          />
          <StatBox
            label="Ascent"
            value={"↑ " + formatElevation(route.totalAscentMeters, units)}
          />
          <StatBox
            label="Descent"
            value={"↓ " + formatElevation(route.totalDescentMeters, units)}
          />
        </View>

        {/* Elevation Profile */}
        <Text className="text-[22px] font-barlow-semibold text-foreground px-4 mt-2 mb-3">
          Elevation Profile
        </Text>
        <View className="mx-4 rounded-xl overflow-hidden bg-surface">
          <ElevationProfile
            points={route.points}
            units={units}
            width={chartWidth}
            height={chartHeight}
            currentPointIndex={currentPointIndex}
            pois={chartPOIs}
            onPOIPress={setSelectedPOI}
            climbs={routeClimbs}
          />
        </View>

        {/* Data: Map tiles, Google Places, OSM */}
        <DataSection routeId={id!} points={route.points} />

        {/* Progress (if snapped) */}
        {currentPointIndex != null && elevProgress && (
          <View className="mt-2">
            <Text className="text-[22px] font-barlow-semibold text-foreground px-4 mt-2 mb-3">
              Progress
            </Text>
            <View className="flex-row px-4 mb-3 gap-3">
              <StatBox
                label="Completed"
                value={formatDistance(
                  route.points[currentPointIndex].distanceFromStartMeters,
                  units,
                )}
              />
              <StatBox
                label="Remaining"
                value={formatDistance(
                  route.totalDistanceMeters -
                    route.points[currentPointIndex].distanceFromStartMeters,
                  units,
                )}
              />
            </View>
            <View className="flex-row px-4 mb-3 gap-3">
              <StatBox
                label="Ascent done"
                value={"↑ " + formatElevation(elevProgress.ascentDone, units)}
              />
              <StatBox
                label="Ascent left"
                value={"↑ " + formatElevation(elevProgress.ascentRemaining, units)}
              />
            </View>
            <View className="flex-row px-4 mb-3 gap-3">
              <StatBox
                label="Descent done"
                value={"↓ " + formatElevation(elevProgress.descentDone, units)}
              />
              <StatBox
                label="Descent left"
                value={"↓ " + formatElevation(elevProgress.descentRemaining, units)}
              />
            </View>
          </View>
        )}
      </ScrollView>
    </>
  );
}
