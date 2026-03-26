import React, { useEffect, useState, useMemo, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  useWindowDimensions,
  ActivityIndicator,
} from "react-native";
import { useLocalSearchParams, Stack } from "expo-router";
import { Camera, MapView as MapboxMapView } from "@rnmapbox/maps";
import { useRouteStore } from "@/store/routeStore";
import { useSettingsStore } from "@/store/settingsStore";
import { MAP_STYLE_URLS } from "@/types";
import type { RouteWithPoints } from "@/types";
import { formatDistance, formatElevation } from "@/utils/formatters";
import { computeElevationProgress, computeBounds } from "@/utils/geo";
import ElevationProfile from "@/components/elevation/ElevationProfile";
import RouteLayer from "@/components/map/RouteLayer";
import StatBox from "@/components/common/StatBox";

export default function RouteDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { width: screenWidth } = useWindowDimensions();
  const cameraRef = useRef<Camera>(null);

  const [route, setRoute] = useState<RouteWithPoints | null>(null);
  const [loading, setLoading] = useState(true);

  const getRouteDetail = useRouteStore((s) => s.getRouteDetail);
  const snappedPosition = useRouteStore((s) => s.snappedPosition);
  const units = useSettingsStore((s) => s.units);
  const mapStyle = useSettingsStore((s) => s.mapStyle);

  useEffect(() => {
    if (!id) return;
    (async () => {
      const detail = await getRouteDetail(id);
      setRoute(detail);
      setLoading(false);
    })();
  }, [id, getRouteDetail]);

  const currentPointIndex = useMemo(() => {
    if (snappedPosition?.routeId === id) return snappedPosition.pointIndex;
    return undefined;
  }, [snappedPosition, id]);

  // Elevation progress at current position
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
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (!route) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Route not found</Text>
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
        }}
      />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {/* Mini map */}
        <View style={styles.mapContainer}>
          <MapboxMapView
            style={styles.map}
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
        <View style={styles.statsRow}>
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
        <Text style={styles.sectionTitle}>Elevation Profile</Text>
        <View style={styles.chartContainer}>
          <ElevationProfile
            points={route.points}
            units={units}
            width={chartWidth}
            height={chartHeight}
            currentPointIndex={currentPointIndex}
          />
        </View>

        {/* Progress (if snapped) */}
        {currentPointIndex != null && elevProgress && (
          <View style={styles.progressSection}>
            <Text style={styles.sectionTitle}>Progress</Text>
            <View style={styles.statsRow}>
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
            <View style={styles.statsRow}>
              <StatBox
                label="Ascent done"
                value={"↑ " + formatElevation(elevProgress.ascentDone, units)}
              />
              <StatBox
                label="Ascent left"
                value={"↑ " + formatElevation(elevProgress.ascentRemaining, units)}
              />
            </View>
            <View style={styles.statsRow}>
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F2F2F7",
  },
  content: {
    paddingBottom: 40,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  errorText: {
    fontSize: 17,
    color: "#8E8E93",
  },
  mapContainer: {
    height: 250,
    margin: 16,
    borderRadius: 12,
    overflow: "hidden",
  },
  map: {
    flex: 1,
  },
  statsRow: {
    flexDirection: "row",
    paddingHorizontal: 16,
    marginBottom: 12,
    gap: 12,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: "#1C1C1E",
    paddingHorizontal: 16,
    marginTop: 8,
    marginBottom: 12,
  },
  chartContainer: {
    marginHorizontal: 16,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "#fff",
  },
  progressSection: {
    marginTop: 8,
  },
});
