import React, { useEffect, useState, useMemo, useRef } from "react";
import {
  View,
  ScrollView,
  TouchableOpacity,
  useWindowDimensions,
  ActivityIndicator,
} from "react-native";
import { useLocalSearchParams, Stack } from "expo-router";
import { Camera, MapView as MapboxMapView } from "@rnmapbox/maps";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { useThemeColors } from "@/theme";
import { useRouteStore } from "@/store/routeStore";
import { useSettingsStore } from "@/store/settingsStore";
import { usePoiStore } from "@/store/poiStore";
import { MAP_STYLE_URLS } from "@/types";
import type { RouteWithPoints } from "@/types";
import { formatDistance, formatElevation } from "@/utils/formatters";
import { computeElevationProgress, computeBounds } from "@/utils/geo";
import {
  DEFAULT_CORRIDOR_WIDTH_M,
  MIN_CORRIDOR_WIDTH_M,
  MAX_CORRIDOR_WIDTH_M,
} from "@/constants";
import ElevationProfile from "@/components/elevation/ElevationProfile";
import RouteLayer from "@/components/map/RouteLayer";
import StatBox from "@/components/common/StatBox";

export default function RouteDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { width: screenWidth } = useWindowDimensions();
  const cameraRef = useRef<Camera>(null);
  const colors = useThemeColors();

  const [route, setRoute] = useState<RouteWithPoints | null>(null);
  const [loading, setLoading] = useState(true);

  const getRouteDetail = useRouteStore((s) => s.getRouteDetail);
  const snappedPosition = useRouteStore((s) => s.snappedPosition);
  const units = useSettingsStore((s) => s.units);
  const mapStyle = useSettingsStore((s) => s.mapStyle);

  const fetchPOIs = usePoiStore((s) => s.fetchPOIs);
  const loadPOIs = usePoiStore((s) => s.loadPOIs);
  const fetchStatus = usePoiStore((s) => id ? s.fetchStatus[id] : undefined);
  const fetchProgress = usePoiStore((s) => s.fetchProgress);
  const fetchError = usePoiStore((s) => s.fetchError);
  const poiCount = usePoiStore((s) => id ? (s.pois[id]?.length ?? 0) : 0);
  const corridorWidthM = usePoiStore((s) => s.corridorWidthM);
  const setCorridorWidth = usePoiStore((s) => s.setCorridorWidth);

  useEffect(() => {
    if (!id) return;
    (async () => {
      const detail = await getRouteDetail(id);
      setRoute(detail);
      setLoading(false);
    })();
  }, [id, getRouteDetail]);

  useEffect(() => {
    if (id) loadPOIs(id);
  }, [id, loadPOIs]);

  const currentPointIndex = useMemo(() => {
    if (snappedPosition?.routeId === id) return snappedPosition.pointIndex;
    return undefined;
  }, [snappedPosition, id]);

  const elevProgress = useMemo(() => {
    if (currentPointIndex == null || !route) return null;
    return computeElevationProgress(route.points, currentPointIndex);
  }, [currentPointIndex, route]);

  const bounds = useMemo(() => {
    if (!route?.points.length) return null;
    return computeBounds(route.points);
  }, [route]);

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  if (!route) {
    return (
      <View className="flex-1 items-center justify-center">
        <Text className="text-[17px] text-muted-foreground">Route not found</Text>
      </View>
    );
  }

  const chartWidth = screenWidth - 32;
  const chartHeight = 220;

  return (
    <>
      <Stack.Screen
        options={{
          title: route.name,
          headerBackTitle: "Routes",
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.accent,
          headerTitleStyle: {
            color: colors.textPrimary,
            fontFamily: "Barlow-SemiBold",
          },
        }}
      />
      <ScrollView
        className="flex-1 bg-background"
        contentContainerStyle={{ paddingBottom: 40 }}
      >
        {/* Mini map */}
        <View className="h-[250px] mx-4 mt-4 rounded-xl overflow-hidden">
          <MapboxMapView
            style={{ flex: 1 }}
            styleURL={MAP_STYLE_URLS[mapStyle]}
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
            <RouteLayer route={route} points={route.points} />
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
          />
        </View>

        {/* Points of Interest */}
        <Text className="text-[22px] font-barlow-semibold text-foreground px-4 mt-4 mb-3">
          Points of Interest
        </Text>

        {/* Corridor width selector */}
        <View className="flex-row items-center px-4 mb-3 gap-2">
          <Text className="text-[14px] text-muted-foreground font-barlow mr-1">
            Corridor:
          </Text>
          {[1000, 2000, 5000].map((w) => (
            <TouchableOpacity
              key={w}
              className={`px-4 h-[44px] items-center justify-center rounded-full ${
                corridorWidthM === w
                  ? "bg-primary"
                  : "bg-card border border-border"
              }`}
              onPress={() => setCorridorWidth(w)}
            >
              <Text
                className={`text-[13px] font-barlow-medium ${
                  corridorWidthM === w
                    ? "text-primary-foreground"
                    : "text-foreground"
                }`}
              >
                {w / 1000} km
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Fetch button */}
        <View className="px-4 mb-2">
          <Button
            onPress={() => {
              if (route) fetchPOIs(id!, route.points);
            }}
            disabled={fetchStatus === "fetching"}
            variant={poiCount > 0 ? "secondary" : "default"}
            label={
              fetchStatus === "fetching"
                ? "Fetching POIs..."
                : poiCount > 0
                  ? "Refresh POIs"
                  : "Fetch POIs"
            }
          />
        </View>

        {/* Fetch progress */}
        {fetchStatus === "fetching" && fetchProgress && (
          <Text className="text-[13px] text-muted-foreground px-4 mb-2 font-barlow">
            {fetchProgress.phase}: {fetchProgress.done}/{fetchProgress.total}
          </Text>
        )}

        {/* Fetch error */}
        {fetchStatus === "error" && fetchError && (
          <Text className="text-[13px] text-destructive px-4 mb-2 font-barlow">
            {fetchError}
          </Text>
        )}

        {/* POI count */}
        {fetchStatus === "done" && poiCount > 0 && (
          <Text className="text-[14px] text-muted-foreground px-4 mb-2 font-barlow">
            {poiCount} POIs found along route
          </Text>
        )}

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
