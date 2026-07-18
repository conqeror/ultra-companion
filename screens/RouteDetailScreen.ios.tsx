import React, { useCallback, useEffect, useState, useMemo } from "react";
import { View, ScrollView, useWindowDimensions, ActivityIndicator, Alert } from "react-native";
import { useLocalSearchParams, Stack } from "expo-router";
import { Share2 } from "lucide-react-native";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { useThemeColors } from "@/theme";
import { useRouteStore } from "@/store/routeStore";
import { useSettingsStore } from "@/store/settingsStore";
import { usePoiStore } from "@/store/poiStore";
import { useClimbStore } from "@/store/climbStore";
import { useFerryStore } from "@/store/ferryStore";
import type { RouteWithPoints, Climb, FerryCrossing } from "@/types";
import { formatDistance, formatElevation } from "@/utils/formatters";
import { findPointIndexAtOrAfterDistance } from "@/utils/geo";
import { resolveRouteProgress } from "@/utils/routeProgress";
import {
  toDisplayClimbs,
  toDisplayDistanceMeters,
  toDisplayPOIs,
} from "@/services/displayDistance";
import {
  computeRidingElevationTotals,
  filterClimbsOutsideFerries,
  projectRoutePointsForRidingProfile,
  ridingDistanceAtGeometricDistance,
  ridingDistanceBetween,
  toDisplayFerryCrossing,
  totalRidingDistanceMeters,
} from "@/services/ferryCrossings";
import ElevationProfile from "@/components/elevation/ElevationProfile";
import RoutePreviewMap, { type RoutePreviewMapLayer } from "@/components/map/RoutePreviewMap";
import StatBox from "@/components/common/StatBox";
import DataSection from "@/components/route/DataSection";
import AddSavedPOISheet from "@/components/poi/AddSavedPOISheet";
import type { SavedPOITarget } from "@/services/savedPOIService";
import { serializeRouteToGPX } from "@/services/gpxSerializer";
import { shareGPXFile } from "@/utils/gpxExportShare";
import { measureSync } from "@/utils/perfMarks";
import { yieldToUI } from "@/utils/yieldToUI";
import RouteFerriesSection from "@/components/ferry/RouteFerriesSection";
import { buildFerryAwarePreviewLayers } from "@/utils/ferryMapRoute";

const EMPTY_CLIMBS: Climb[] = [];
const EMPTY_FERRIES: FerryCrossing[] = [];

export default function RouteDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { width: screenWidth } = useWindowDimensions();
  const colors = useThemeColors();

  const [route, setRoute] = useState<RouteWithPoints | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAddPOI, setShowAddPOI] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const getRouteDetail = useRouteStore((s) => s.getRouteDetail);
  const snappedPosition = useRouteStore((s) => s.snappedPosition);
  const units = useSettingsStore((s) => s.units);
  const loadPOIs = usePoiStore((s) => s.loadPOIs);
  const getStarredPOIs = usePoiStore((s) => s.getStarredPOIs);
  const starredPOIIds = usePoiStore((s) => s.starredPOIIds);
  const setSelectedPOI = usePoiStore((s) => s.setSelectedPOI);
  const loadFerries = useFerryStore((s) => s.loadFerries);
  const routeFerries = useFerryStore((s) =>
    id ? (s.ferries[id] ?? EMPTY_FERRIES) : EMPTY_FERRIES,
  );

  useEffect(() => {
    if (!id) return;
    (async () => {
      const detail = await getRouteDetail(id);
      setRoute(detail);
      setLoading(false);
    })();
  }, [id, getRouteDetail]);

  const loadClimbs = useClimbStore((s) => s.loadClimbs);
  const routeClimbs = useClimbStore((s) => (id ? (s.climbs[id] ?? EMPTY_CLIMBS) : EMPTY_CLIMBS));

  useEffect(() => {
    if (id) {
      loadPOIs(id);
      loadClimbs(id);
      loadFerries(id);
    }
  }, [id, loadPOIs, loadClimbs, loadFerries]);

  const activeRouteProgress = useMemo(
    () => resolveRouteProgress(snappedPosition, id, route?.points),
    [snappedPosition, id, route?.points],
  );
  const currentDistanceMeters = activeRouteProgress?.distanceAlongRouteMeters;

  const ridingStats = useMemo(() => {
    if (!route) return null;
    const elevation = computeRidingElevationTotals(route.points, routeFerries);
    return {
      distance: totalRidingDistanceMeters(route.totalDistanceMeters, routeFerries),
      ascent: elevation.ascent,
      descent: elevation.descent,
    };
  }, [route, routeFerries]);
  const profilePoints = useMemo(
    () => (route ? projectRoutePointsForRidingProfile(route.points, routeFerries) : []),
    [route, routeFerries],
  );
  const currentRidingDistanceMeters = useMemo(
    () =>
      currentDistanceMeters == null
        ? undefined
        : ridingDistanceAtGeometricDistance(currentDistanceMeters, routeFerries),
    [currentDistanceMeters, routeFerries],
  );
  const currentPointIndex = useMemo(() => {
    if (currentRidingDistanceMeters == null || profilePoints.length === 0) return undefined;
    return findPointIndexAtOrAfterDistance(profilePoints, currentRidingDistanceMeters);
  }, [currentRidingDistanceMeters, profilePoints]);

  const elevProgress = useMemo(() => {
    if (currentDistanceMeters == null || !route) return null;
    const done = computeRidingElevationTotals(route.points, routeFerries, 0, currentDistanceMeters);
    const remaining = computeRidingElevationTotals(
      route.points,
      routeFerries,
      currentDistanceMeters,
      route.totalDistanceMeters,
    );
    return {
      ascentDone: done.ascent,
      descentDone: done.descent,
      ascentRemaining: remaining.ascent,
      descentRemaining: remaining.descent,
    };
  }, [currentDistanceMeters, route, routeFerries]);

  const screenOptions = useMemo(() => ({ title: route?.name ?? "Route" }), [route?.name]);

  const chartPOIs = useMemo(() => {
    if (!id) return [];
    return toDisplayPOIs(getStarredPOIs(id)).map((poi) =>
      Object.assign({}, poi, {
        effectiveDistanceMeters: toDisplayDistanceMeters(
          ridingDistanceAtGeometricDistance(poi.effectiveDistanceMeters, routeFerries),
        ),
      }),
    );
    // starredPOIIds is a reactivity trigger: getStarredPOIs reads store via get() and is not itself reactive
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, getStarredPOIs, starredPOIIds, routeFerries]);

  const chartClimbs = useMemo(
    () =>
      toDisplayClimbs(filterClimbsOutsideFerries(routeClimbs, routeFerries)).map((climb) => {
        const effectiveStartDistanceMeters = toDisplayDistanceMeters(
          ridingDistanceAtGeometricDistance(climb.startDistanceMeters, routeFerries),
        );
        const effectiveEndDistanceMeters = toDisplayDistanceMeters(
          ridingDistanceAtGeometricDistance(climb.endDistanceMeters, routeFerries),
        );
        return Object.assign({}, climb, {
          lengthMeters: effectiveEndDistanceMeters - effectiveStartDistanceMeters,
          effectiveDistanceMeters: effectiveStartDistanceMeters,
          effectiveStartDistanceMeters,
          effectiveEndDistanceMeters,
        });
      }),
    [routeClimbs, routeFerries],
  );

  const displayFerries = useMemo(
    () =>
      route
        ? routeFerries.map((crossing) =>
            toDisplayFerryCrossing(
              crossing,
              crossing.startDistanceMeters,
              crossing.endDistanceMeters,
              0,
              route.points,
            ),
          )
        : [],
    [route, routeFerries],
  );

  const previewLayers = useMemo<RoutePreviewMapLayer[]>(() => {
    if (!route?.points.length) return [];
    return buildFerryAwarePreviewLayers(
      [
        {
          id: route.id,
          cacheKey: route.id,
          points: route.points,
          isActive: true,
        },
      ],
      displayFerries,
    );
  }, [displayFerries, route]);

  const savedPOITargets = useMemo<SavedPOITarget[]>(() => {
    if (!route) return [];
    return [{ routeId: route.id, routeName: route.name, points: route.points }];
  }, [route]);

  const handleExportGPX = useCallback(async () => {
    if (!route) return;
    setIsExporting(true);
    try {
      await yieldToUI();
      const gpx = measureSync("gpx.serializeRoute", () =>
        serializeRouteToGPX(route, { poisAsWaypoints: chartPOIs }),
      );
      await shareGPXFile(gpx, route.name);
    } catch {
      Alert.alert("Export Failed", "Could not export this route as GPX.");
    } finally {
      setIsExporting(false);
    }
  }, [route, chartPOIs]);

  if (loading) {
    return (
      <View
        className="flex-1 items-center justify-center bg-background px-6"
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel="Loading route"
      >
        <ActivityIndicator size="large" color={colors.accent} />
        <Text className="mt-3 text-[17px] font-barlow-semibold text-foreground">
          Loading route…
        </Text>
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
      <Stack.Screen options={screenOptions} />
      <ScrollView className="flex-1 bg-background" contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Mini map */}
        {previewLayers.length > 0 && (
          <View className="mx-4 mt-4 rounded-xl overflow-hidden" style={{ height: 250 }}>
            <RoutePreviewMap layers={previewLayers} ferries={displayFerries} />
          </View>
        )}

        {/* Stats */}
        <View className="flex-row px-4 mt-3 mb-3 gap-3">
          <StatBox label="Distance" value={formatDistance(ridingStats?.distance ?? 0, units)} />
          <StatBox label="Ascent" value={"↑ " + formatElevation(ridingStats?.ascent ?? 0, units)} />
          <StatBox
            label="Descent"
            value={"↓ " + formatElevation(ridingStats?.descent ?? 0, units)}
          />
        </View>

        <RouteFerriesSection route={route} />

        {/* Elevation Profile */}
        <Text className="text-[22px] font-barlow-semibold text-foreground px-4 mt-2 mb-3">
          Elevation Profile
        </Text>
        <View className="mx-4 rounded-xl overflow-hidden bg-surface">
          <ElevationProfile
            points={profilePoints}
            units={units}
            width={chartWidth}
            height={chartHeight}
            currentPointIndex={currentPointIndex}
            currentDistanceMeters={currentRidingDistanceMeters}
            pois={chartPOIs}
            onPOIPress={setSelectedPOI}
            climbs={chartClimbs}
          />
        </View>

        <View className="px-4 mt-4 gap-3">
          <Button variant="secondary" onPress={() => setShowAddPOI(true)} label="Add POI" />
          <Button variant="secondary" onPress={handleExportGPX} disabled={isExporting}>
            <Share2 size={18} color={colors.accent} />
            <Text className="ml-2 text-primary font-barlow-semibold text-[15px]">
              {isExporting ? "Exporting..." : "Export GPX"}
            </Text>
          </Button>
        </View>

        {/* Data: Map tiles, Google Places, OSM */}
        <DataSection
          routeId={id!}
          points={route.points}
          totalDistanceMeters={route.totalDistanceMeters}
          totalAscentMeters={route.totalAscentMeters}
          totalDescentMeters={route.totalDescentMeters}
          ferries={routeFerries}
        />

        {/* Progress (if snapped) */}
        {currentDistanceMeters != null && elevProgress && (
          <View className="mt-2">
            <Text className="text-[22px] font-barlow-semibold text-foreground px-4 mt-2 mb-3">
              Progress
            </Text>
            <View className="flex-row px-4 mb-3 gap-3">
              <StatBox
                label="Completed"
                value={formatDistance(currentRidingDistanceMeters ?? 0, units)}
              />
              <StatBox
                label="Remaining"
                value={formatDistance(
                  ridingDistanceBetween(
                    currentDistanceMeters,
                    route.totalDistanceMeters,
                    routeFerries,
                  ),
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
      <AddSavedPOISheet
        visible={showAddPOI}
        targets={savedPOITargets}
        onClose={() => setShowAddPOI(false)}
      />
    </>
  );
}
