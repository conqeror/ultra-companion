import React, { useMemo } from "react";
import { View, TouchableOpacity, StyleSheet, useWindowDimensions } from "react-native";
import Animated, {
  useAnimatedStyle,
  withTiming,
  Easing,
} from "react-native-reanimated";
import { Text } from "@/components/ui/text";
import { useThemeColors } from "@/theme";
import { usePanelStore } from "@/store/panelStore";
import { useRouteStore } from "@/store/routeStore";
import { useSettingsStore } from "@/store/settingsStore";
import { usePoiStore } from "@/store/poiStore";
import { useClimbStore } from "@/store/climbStore";
import { useEtaStore } from "@/store/etaStore";
import { BOTTOM_PANEL_HEIGHT_RATIO } from "@/constants";
import { computeElevationProgress, computeSliceAscent, extractRouteSlice } from "@/utils/geo";
import { formatDistance, formatElevation, formatDuration, formatETA } from "@/utils/formatters";
import { stitchPOIs } from "@/services/stitchingService";
import UpcomingElevation from "./UpcomingElevation";
import ElevationProfile from "@/components/elevation/ElevationProfile";
import type { RoutePoint, PanelMode, POI, ActiveRouteData } from "@/types";

const MAX_SNAP_DISTANCE_M = 1000;
const PANEL_CLASS = "absolute bottom-0 left-0 right-0 rounded-t-2xl shadow-lg overflow-hidden";
const STATS_ROW_HEIGHT = 28;

/** Extract the numeric look-ahead in meters from an upcoming-* mode, or null */
function lookAheadForMode(mode: PanelMode): number | null {
  const match = mode.match(/^upcoming-(\d+)$/);
  if (match) return parseInt(match[1], 10) * 1_000;
  return null;
}

interface BottomPanelProps {
  activeData: ActiveRouteData | null;
}

export default function BottomPanel({ activeData }: BottomPanelProps) {
  const activeRoutePoints = activeData?.points ?? null;
  const activeId = activeData?.id ?? null;
  const activeRouteIds = activeData?.routeIds ?? [];
  const activeSegments = activeData?.segments ?? null;
  const activeTotalDistance = activeData?.totalDistanceMeters ?? 0;
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const panelHeight = Math.round(screenHeight * BOTTOM_PANEL_HEIGHT_RATIO);
  const colors = useThemeColors();

  const panelMode = usePanelStore((s) => s.panelMode);
  const snappedPosition = useRouteStore((s) => s.snappedPosition);
  const units = useSettingsStore((s) => s.units);
  const setSelectedPOI = usePoiStore((s) => s.setSelectedPOI);

  const bottomSheet = usePanelStore((s) => s.bottomSheet);
  const isVisible = bottomSheet == null;

  const isSnapped =
    isVisible &&
    snappedPosition &&
    activeId &&
    snappedPosition.routeId === activeId &&
    snappedPosition.distanceFromRouteMeters <= MAX_SNAP_DISTANCE_M;

  // Only starred POIs appear on the elevation profile
  const getStarredPOIs = usePoiStore((s) => s.getStarredPOIs);
  const starredPOIIds = usePoiStore((s) => s.starredPOIIds);
  const poisForChart = useMemo(() => {
    if (!activeId || activeRouteIds.length === 0) return [];
    if (activeSegments) {
      // Collection: stitch starred POIs with distance offsets
      const poisByRoute: Record<string, POI[]> = {};
      for (const routeId of activeRouteIds) {
        poisByRoute[routeId] = getStarredPOIs(routeId);
      }
      return stitchPOIs(activeSegments, poisByRoute);
    }
    return getStarredPOIs(activeRouteIds[0]);
  }, [activeId, activeRouteIds, activeSegments, getStarredPOIs, starredPOIIds]);

  // Current climb mode
  const currentClimbId = useClimbStore((s) => s.currentClimbId);
  const isClimbZoomed = useClimbStore((s) => s.isClimbZoomed);
  const setClimbZoomed = useClimbStore((s) => s.setClimbZoomed);

  // Climbs for the elevation chart
  const getClimbsForDisplay = useClimbStore((s) => s.getClimbsForDisplay);
  const allClimbs = useClimbStore((s) => s.climbs);
  const climbsForChart = useMemo(() => {
    if (!activeId || activeRouteIds.length === 0) return [];
    return getClimbsForDisplay(activeRouteIds, activeSegments);
  }, [activeId, activeRouteIds, activeSegments, getClimbsForDisplay, allClimbs]);

  // Current climb data for zoom mode
  const currentClimb = useMemo(() => {
    if (!currentClimbId) return null;
    return climbsForChart.find((c) => c.id === currentClimbId) ?? null;
  }, [currentClimbId, climbsForChart]);

  const climbSlice = useMemo(() => {
    if (!currentClimb || !activeRoutePoints?.length) return null;
    const padding = 500; // 500m before and after
    const startDist = Math.max(0, currentClimb.startDistanceMeters - padding);

    // Find start index
    let startIdx = 0;
    for (let i = 0; i < activeRoutePoints.length; i++) {
      if (activeRoutePoints[i].distanceFromStartMeters >= startDist) {
        startIdx = Math.max(0, i - 1);
        break;
      }
    }

    const totalSliceM = (currentClimb.endDistanceMeters + padding) - activeRoutePoints[startIdx].distanceFromStartMeters;
    const sliced = extractRouteSlice(activeRoutePoints, startIdx, totalSliceM);

    // Find current position index in slice
    let currentIdxInSlice: number | undefined;
    if (isSnapped) {
      currentIdxInSlice = snappedPosition!.pointIndex - startIdx;
      if (currentIdxInSlice < 0 || currentIdxInSlice >= sliced.length) {
        currentIdxInSlice = undefined;
      }
    }

    return {
      points: sliced,
      currentIdxInSlice,
      offsetMeters: activeRoutePoints[startIdx].distanceFromStartMeters,
    };
  }, [currentClimb, activeRoutePoints, isSnapped, snappedPosition]);

  // Climb progress stats — uses actual route point data for accurate remaining ascent
  const climbProgressText = useMemo(() => {
    if (!currentClimb || !isSnapped || !snappedPosition || !activeRoutePoints?.length) return null;
    const currentDist = snappedPosition.distanceAlongRouteMeters;
    const distToTop = currentClimb.endDistanceMeters - currentDist;
    if (distToTop <= 0) return null;

    const ascentRemaining = computeSliceAscent(activeRoutePoints, snappedPosition.pointIndex, currentClimb.endDistanceMeters);

    return `↑ ${formatElevation(ascentRemaining, units)} remaining  ·  ${formatDistance(distToTop, units)} to top  ·  ${currentClimb.averageGradientPercent}% avg`;
  }, [currentClimb, isSnapped, snappedPosition, activeRoutePoints, units]);

  const showClimbZoom = isClimbZoomed && currentClimb && climbSlice && climbSlice.points.length > 1;

  // ETA to end of route
  const getETAToDistance = useEtaStore((s) => s.getETAToDistance);
  const cumulativeTime = useEtaStore((s) => s.cumulativeTime);

  // Stats for the compact header
  const statsText = useMemo(() => {
    if (!isSnapped || !activeId || !activeRoutePoints?.length) return null;
    const idx = snappedPosition!.pointIndex;
    const distDone = activeRoutePoints[idx]?.distanceFromStartMeters ?? 0;
    const distLeft = activeTotalDistance - distDone;
    const elev = computeElevationProgress(activeRoutePoints, idx);

    // ETA to finish
    const finishETA = getETAToDistance(activeTotalDistance);
    const etaSuffix = finishETA && finishETA.ridingTimeSeconds > 0
      ? `~${formatDuration(finishETA.ridingTimeSeconds)} (${formatETA(finishETA.eta)})`
      : null;

    const la = lookAheadForMode(panelMode);
    if (la == null) return null;

    const sliceAscent = computeSliceAscent(activeRoutePoints, idx, distDone + la);
    const sliceDist = Math.min(la, distLeft);
    const base = `${formatDistance(sliceDist, units)} / ${formatDistance(distLeft, units)} left  \u00B7  \u2191 ${formatElevation(sliceAscent, units)} / ${formatElevation(elev.ascentRemaining, units)}`;
    return etaSuffix ? `${base}  \u00B7  ${etaSuffix}` : base;
  }, [isSnapped, snappedPosition, activeId, activeTotalDistance, activeRoutePoints, units, panelMode, getETAToDistance, cumulativeTime]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateY: withTiming(isVisible ? 0 : panelHeight, {
          duration: 250,
          easing: Easing.out(Easing.cubic),
        }),
      },
    ],
  }));

  if (!isVisible) return null;

  const lookAhead = lookAheadForMode(panelMode)!;

  // Edge case: no active route
  if (!activeId || !activeRoutePoints?.length) {
    return (
      <Animated.View
        className={PANEL_CLASS}
        style={[{ height: panelHeight, backgroundColor: colors.surface }, animatedStyle]}
      >
        <View className="flex-1 items-center justify-center">
          <Text className="text-[15px] text-muted-foreground">
            Import and activate a route
          </Text>
        </View>
      </Animated.View>
    );
  }

  // When not snapped, default to route start (index 0)
  const effectivePointIndex = isSnapped ? snappedPosition!.pointIndex : 0;

  const showClimbHeader = showClimbZoom && !!climbProgressText;
  const showStats = !showClimbZoom && !!statsText;
  const headerHeight = (showStats || showClimbHeader) ? STATS_ROW_HEIGHT : 0;
  const chartHeight = panelHeight - headerHeight;
  const chartWidth = screenWidth - 16;

  return (
    <Animated.View
      className={PANEL_CLASS}
      style={[{ height: panelHeight, backgroundColor: colors.surface }, animatedStyle]}
    >
      {showClimbHeader && (
        <TouchableOpacity
          className="justify-center items-center"
          style={[
            { height: STATS_ROW_HEIGHT },
            { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
          ]}
          onPress={() => setClimbZoomed(false)}
          accessibilityLabel="Exit climb zoom"
        >
          <Text className="text-[13px] text-foreground font-barlow-sc-semibold">
            {climbProgressText}
          </Text>
        </TouchableOpacity>
      )}
      {showStats && (
        <View
          className="justify-center items-center"
          style={[
            { height: STATS_ROW_HEIGHT },
            { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
          ]}
        >
          <Text className="text-[13px] text-muted-foreground font-barlow-sc-medium">
            {statsText}
          </Text>
        </View>
      )}
      {showClimbZoom ? (
        <ElevationProfile
          points={climbSlice!.points}
          units={units}
          width={chartWidth}
          height={chartHeight}
          currentPointIndex={climbSlice!.currentIdxInSlice}
          showLegend={false}
          distanceOffsetMeters={climbSlice!.offsetMeters}
          climbs={climbsForChart}
        />
      ) : (
        <UpcomingElevation
          points={activeRoutePoints}
          currentPointIndex={effectivePointIndex}
          lookAhead={lookAhead}
          units={units}
          width={chartWidth}
          height={chartHeight}
          pois={poisForChart}
          climbs={climbsForChart}
          onPOIPress={(poi) => {
            const raw = usePoiStore.getState().pois[poi.routeId]?.find((p) => p.id === poi.id);
            setSelectedPOI(raw ?? poi);
          }}
        />
      )}
    </Animated.View>
  );
}
