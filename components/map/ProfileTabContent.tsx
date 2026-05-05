import React, { useMemo } from "react";
import { View, TouchableOpacity, StyleSheet, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "@/components/ui/text";
import { useThemeColors } from "@/theme";
import { usePanelStore } from "@/store/panelStore";
import { useRouteStore } from "@/store/routeStore";
import { useSettingsStore } from "@/store/settingsStore";
import { usePoiStore } from "@/store/poiStore";
import { useClimbStore } from "@/store/climbStore";
import {
  computeSliceAscentFromDistance,
  computeSliceElevationTotalsFromDistance,
  extractRouteSlice,
  findFirstPointAtOrAfterDistance,
  findNearestPointIndexAtDistance,
} from "@/utils/geo";
import { resolveRouteProgress } from "@/utils/routeProgress";
import { formatDistance, formatElevation } from "@/utils/formatters";
import { climbDifficultyColor } from "@/constants/climbHelpers";
import { stitchPOIs } from "@/services/stitchingService";
import { toDisplayPOIs } from "@/services/displayDistance";
import { ridingHorizonMetersForMode } from "@/utils/ridingHorizon";
import UpcomingElevation from "./UpcomingElevation";
import ElevationProfile from "@/components/elevation/ElevationProfile";
import type { POI, ActiveRouteData, DisplayClimb } from "@/types";

const STATS_HEIGHT = 28;
const CLIMB_ROW_HEIGHT = 36;
const MAX_CLIMBS_AHEAD = 4;
const HORIZONTAL_PADDING = 8;

interface ProfileTabContentProps {
  activeData: ActiveRouteData | null;
  width: number;
  height: number;
}

export default function ProfileTabContent({ activeData, width, height }: ProfileTabContentProps) {
  const colors = useThemeColors();
  const { bottom: safeBottom } = useSafeAreaInsets();
  const activeRoutePoints = activeData?.points ?? null;
  const activeId = activeData?.id ?? null;
  const activeRouteIds = useMemo(() => activeData?.routeIds ?? [], [activeData?.routeIds]);
  const activeSegments = activeData?.segments ?? null;
  const activeTotalDistance = activeData?.totalDistanceMeters ?? 0;

  const panelMode = usePanelStore((s) => s.panelMode);
  const setPanelTab = usePanelStore((s) => s.setPanelTab);
  const isExpanded = usePanelStore((s) => s.isExpanded);
  const snappedPosition = useRouteStore((s) => s.snappedPosition);
  const units = useSettingsStore((s) => s.units);
  const setSelectedPOI = usePoiStore((s) => s.setSelectedPOI);

  const activeRouteProgress = useMemo(
    () => resolveRouteProgress(snappedPosition, activeId, activeRoutePoints),
    [snappedPosition, activeId, activeRoutePoints],
  );
  const isSnapped = activeRouteProgress != null;
  const currentDistanceMeters = activeRouteProgress?.distanceAlongRouteMeters ?? null;

  const getStarredPOIs = usePoiStore((s) => s.getStarredPOIs);
  const starredPOIIds = usePoiStore((s) => s.starredPOIIds);
  const poisForChart = useMemo(() => {
    if (!activeId || activeRouteIds.length === 0) return [];
    if (activeSegments) {
      const poisByRoute: Record<string, POI[]> = {};
      for (const routeId of activeRouteIds) {
        poisByRoute[routeId] = getStarredPOIs(routeId);
      }
      return stitchPOIs(activeSegments, poisByRoute);
    }
    return toDisplayPOIs(getStarredPOIs(activeRouteIds[0]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, activeRouteIds, activeSegments, getStarredPOIs, starredPOIIds]);

  const getClimbsForDisplay = useClimbStore((s) => s.getClimbsForDisplay);
  const allClimbs = useClimbStore((s) => s.climbs);
  const climbsForChart = useMemo(() => {
    if (!activeId || activeRouteIds.length === 0) return [];
    return getClimbsForDisplay(activeRouteIds, activeSegments);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, activeRouteIds, activeSegments, getClimbsForDisplay, allClimbs]);

  const currentClimbId = useClimbStore((s) => s.currentClimbId);
  const isClimbZoomed = useClimbStore((s) => s.isClimbZoomed);
  const setClimbZoomed = useClimbStore((s) => s.setClimbZoomed);
  const setSelectedClimb = useClimbStore((s) => s.setSelectedClimb);

  const currentClimb = useMemo(() => {
    if (!currentClimbId) return null;
    return climbsForChart.find((c) => c.id === currentClimbId) ?? null;
  }, [currentClimbId, climbsForChart]);

  const climbSlice = useMemo(() => {
    if (!currentClimb || !activeRoutePoints?.length) return null;
    const padding = 500;
    const startDist = Math.max(0, currentClimb.effectiveStartDistanceMeters - padding);
    const firstAtOrAfterStart = findFirstPointAtOrAfterDistance(activeRoutePoints, startDist);
    const startIdx =
      activeRoutePoints[firstAtOrAfterStart]?.distanceFromStartMeters === startDist
        ? firstAtOrAfterStart
        : Math.max(0, firstAtOrAfterStart - 1);
    const totalSliceM =
      currentClimb.effectiveEndDistanceMeters +
      padding -
      activeRoutePoints[startIdx].distanceFromStartMeters;
    const sliced = extractRouteSlice(activeRoutePoints, startIdx, totalSliceM);
    let currentIdxInSlice: number | undefined;
    let currentDistanceInSliceMeters: number | undefined;
    if (currentDistanceMeters != null) {
      const relativeDistanceMeters =
        currentDistanceMeters - activeRoutePoints[startIdx].distanceFromStartMeters;
      const sliceEndMeters = sliced[sliced.length - 1]?.distanceFromStartMeters ?? 0;
      if (relativeDistanceMeters >= 0 && relativeDistanceMeters <= sliceEndMeters) {
        currentIdxInSlice = findNearestPointIndexAtDistance(sliced, relativeDistanceMeters);
        currentDistanceInSliceMeters = relativeDistanceMeters;
      }
    }
    return {
      points: sliced,
      currentIdxInSlice,
      currentDistanceInSliceMeters,
      offsetMeters: activeRoutePoints[startIdx].distanceFromStartMeters,
    };
  }, [currentClimb, activeRoutePoints, currentDistanceMeters]);

  const climbProgressText = useMemo(() => {
    if (!currentClimb || !activeRouteProgress || !activeRoutePoints?.length) return null;
    const currentDist = activeRouteProgress.distanceAlongRouteMeters;
    const distToTop = currentClimb.effectiveEndDistanceMeters - currentDist;
    if (distToTop <= 0) return null;
    const ascentRemaining = computeSliceAscentFromDistance(
      activeRoutePoints,
      currentDist,
      currentClimb.effectiveEndDistanceMeters,
    );
    return `↑ ${formatElevation(ascentRemaining, units)} remaining  ·  ${formatDistance(distToTop, units)} to top  ·  ${currentClimb.averageGradientPercent}% avg`;
  }, [currentClimb, activeRouteProgress, activeRoutePoints, units]);

  const showClimbZoom = isClimbZoomed && currentClimb && climbSlice && climbSlice.points.length > 1;

  // Slice bounds (matches UpcomingElevation's window)
  const { windowStartDist, windowEndDist } = useMemo(() => {
    if (currentDistanceMeters == null || !activeRoutePoints?.length) {
      return { windowStartDist: 0, windowEndDist: 0 };
    }
    const distDone = currentDistanceMeters;
    const la = ridingHorizonMetersForMode(panelMode);
    if (la == null) return { windowStartDist: distDone, windowEndDist: activeTotalDistance };
    const endDist = Math.min(distDone + la, activeTotalDistance);
    return { windowStartDist: distDone, windowEndDist: endDist };
  }, [currentDistanceMeters, activeRoutePoints, panelMode, activeTotalDistance]);

  const statsText = useMemo(() => {
    if (!isSnapped || !activeRoutePoints?.length) return null;
    const { ascent: asc, descent: desc } = computeSliceElevationTotalsFromDistance(
      activeRoutePoints,
      windowStartDist,
      windowEndDist,
    );
    return `↑ ${formatElevation(asc, units)}  ·  ↓ ${formatElevation(desc, units)}`;
  }, [isSnapped, activeRoutePoints, windowStartDist, windowEndDist, units]);

  const climbsAhead = useMemo<DisplayClimb[]>(() => {
    if (climbsForChart.length === 0) return [];
    return climbsForChart
      .filter(
        (c) =>
          c.effectiveEndDistanceMeters > windowStartDist &&
          c.effectiveStartDistanceMeters < windowEndDist,
      )
      .sort((a, b) => a.effectiveStartDistanceMeters - b.effectiveStartDistanceMeters)
      .slice(0, MAX_CLIMBS_AHEAD);
  }, [climbsForChart, windowStartDist, windowEndDist]);

  if (!activeId || !activeRoutePoints?.length) {
    return (
      <View className="flex-1 items-center justify-center">
        <Text className="text-[15px] text-muted-foreground">Import and activate a route</Text>
      </View>
    );
  }

  const lookAhead = ridingHorizonMetersForMode(panelMode) ?? activeTotalDistance;

  const showClimbBar = isExpanded && showClimbZoom && !!climbProgressText;
  const showStats = isExpanded && !showClimbZoom && !!statsText;
  const showClimbsAhead = isExpanded && !showClimbZoom && climbsAhead.length > 0;
  const isFullRouteHorizon = panelMode === "full-route";

  const climbsAheadHeight = showClimbsAhead
    ? Math.min(climbsAhead.length, MAX_CLIMBS_AHEAD) * CLIMB_ROW_HEIGHT + 24
    : 0;

  const headerBlockHeight =
    (showStats ? STATS_HEIGHT : 0) + (showClimbBar ? STATS_HEIGHT : 0) + climbsAheadHeight;

  const chartHeight = height - headerBlockHeight - safeBottom;
  const chartWidth = width - HORIZONTAL_PADDING * 2;
  const fullProfileCurrentPointIndex =
    currentDistanceMeters != null
      ? findNearestPointIndexAtDistance(activeRoutePoints, currentDistanceMeters)
      : undefined;
  const segmentBoundaries = activeSegments?.slice(1).map((segment) => ({
    distanceMeters: segment.distanceOffsetMeters,
    label: segment.routeName,
  }));

  return (
    <View style={{ height }}>
      {showClimbBar && (
        <TouchableOpacity
          className="justify-center items-center"
          style={[
            { height: STATS_HEIGHT },
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
          className="items-center justify-center"
          style={[
            { height: STATS_HEIGHT },
            { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
          ]}
        >
          <Text
            className="text-[13px] text-muted-foreground font-barlow-sc-medium"
            numberOfLines={1}
          >
            {statsText}
          </Text>
        </View>
      )}

      {showClimbsAhead && (
        <ClimbsAheadStrip
          climbs={climbsAhead}
          riderDistance={windowStartDist}
          units={units}
          height={climbsAheadHeight}
          onClimbPress={(climb) => {
            setSelectedClimb(climb);
            setPanelTab("climbs");
          }}
        />
      )}

      <View className="items-center px-2">
        {showClimbZoom ? (
          <ElevationProfile
            points={climbSlice!.points}
            units={units}
            width={chartWidth}
            height={chartHeight}
            currentPointIndex={climbSlice!.currentIdxInSlice}
            currentDistanceMeters={climbSlice!.currentDistanceInSliceMeters}
            showLegend={false}
            distanceOffsetMeters={climbSlice!.offsetMeters}
            pois={poisForChart}
            onPOIPress={(poi) => {
              setSelectedPOI(poi);
            }}
            climbs={climbsForChart}
            fitToWidth
          />
        ) : isFullRouteHorizon ? (
          <ElevationProfile
            points={activeRoutePoints}
            units={units}
            width={chartWidth}
            height={chartHeight}
            currentPointIndex={fullProfileCurrentPointIndex}
            currentDistanceMeters={currentDistanceMeters ?? undefined}
            showLegend={false}
            pois={poisForChart}
            climbs={climbsForChart}
            segmentBoundaries={segmentBoundaries}
            onPOIPress={(poi) => {
              setSelectedPOI(poi);
            }}
          />
        ) : (
          <UpcomingElevation
            points={activeRoutePoints}
            currentDistanceMeters={currentDistanceMeters}
            lookAhead={lookAhead}
            units={units}
            width={chartWidth}
            height={chartHeight}
            pois={poisForChart}
            climbs={climbsForChart}
            fitToWidth
            onPOIPress={(poi) => {
              setSelectedPOI(poi);
            }}
          />
        )}
      </View>
    </View>
  );
}

function ClimbsAheadStrip({
  climbs,
  riderDistance,
  units,
  height,
  onClimbPress,
}: {
  climbs: DisplayClimb[];
  riderDistance: number;
  units: "metric" | "imperial";
  height: number;
  onClimbPress?: (climb: DisplayClimb) => void;
}) {
  const colors = useThemeColors();
  return (
    <View
      style={{
        height,
        paddingHorizontal: HORIZONTAL_PADDING + 4,
        paddingVertical: 8,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: colors.border,
      }}
    >
      <Text
        className="font-barlow-sc-semibold text-[11px] text-muted-foreground"
        style={{ marginBottom: 4 }}
      >
        CLIMBS AHEAD
      </Text>
      <ScrollView
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        scrollEnabled={climbs.length > MAX_CLIMBS_AHEAD}
      >
        {climbs.map((climb) => {
          const distTo = Math.max(0, climb.effectiveDistanceMeters - riderDistance);
          const color = climbDifficultyColor(climb.difficultyScore);
          return (
            <TouchableOpacity
              key={climb.id}
              className="flex-row items-center"
              style={{ height: CLIMB_ROW_HEIGHT }}
              onPress={onClimbPress ? () => onClimbPress(climb) : undefined}
              disabled={!onClimbPress}
              accessibilityRole="button"
              accessibilityLabel={`Open climb, ${formatDistance(climb.lengthMeters, units)}, ${climb.averageGradientPercent.toFixed(1)}% average`}
            >
              <View
                style={{
                  width: 6,
                  height: 22,
                  borderRadius: 3,
                  backgroundColor: color,
                  marginRight: 10,
                }}
              />
              <View className="flex-1">
                <Text
                  className="font-barlow-semibold text-[13px] text-foreground"
                  numberOfLines={1}
                >
                  {distTo > 0 ? `in ${formatDistance(distTo, units)}` : "now"}
                  <Text className="font-barlow-sc-medium text-[11px] text-muted-foreground">
                    {`  ·  ${formatDistance(climb.lengthMeters, units)} · +${formatElevation(climb.totalAscentMeters, units)}`}
                  </Text>
                </Text>
              </View>
              <Text
                className="font-barlow-sc-semibold text-[13px]"
                style={{ color, minWidth: 44, textAlign: "right" }}
              >
                {climb.averageGradientPercent.toFixed(1)}%
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}
