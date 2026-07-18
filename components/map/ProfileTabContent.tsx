import React, { useMemo } from "react";
import { View, TouchableOpacity, StyleSheet, ScrollView } from "react-native";
import { useShallow } from "zustand/react/shallow";
import { Text } from "@/components/ui/text";
import { useThemeColors } from "@/theme";
import { usePanelStore } from "@/store/panelStore";
import { useRouteStore } from "@/store/routeStore";
import { useSettingsStore } from "@/store/settingsStore";
import { usePoiStore } from "@/store/poiStore";
import { useClimbStore } from "@/store/climbStore";
import { findNearestPointIndexAtDistance } from "@/utils/geo";
import { resolveRouteProgress } from "@/utils/routeProgress";
import { bucketDistanceForDerivedWork } from "@/utils/distanceBuckets";
import { formatDistance, formatElevation } from "@/utils/formatters";
import { climbDifficultyColor } from "@/constants/climbHelpers";
import { stitchPOIs } from "@/services/stitchingService";
import { toDisplayDistanceMeters, toDisplayPOIs } from "@/services/displayDistance";
import {
  createRidingHorizonWindow,
  ridingHorizonMetersForMode,
  ridingHorizonScopeLabelForMode,
} from "@/utils/ridingHorizon";
import { measureSync } from "@/utils/perfMarks";
import { pickRouteRecords } from "@/utils/routeScopedRecords";
import { buildCollectionSegmentProfileBoundaries } from "@/utils/collectionSegmentDisplay";
import { projectFerrySpansForRidingProfile } from "@/utils/elevationProfileFerries";
import UpcomingElevation from "./UpcomingElevation";
import ElevationProfile from "@/components/elevation/ElevationProfile";
import type { POI, ActiveRouteData, DisplayClimb } from "@/types";
import {
  computeRidingElevationTotals,
  projectRoutePointsForRidingProfile,
  ridingDistanceAtGeometricDistance,
  totalRidingDistanceMeters,
} from "@/services/ferryCrossings";

const STATS_HEIGHT = 36;
const CLIMB_ROW_HEIGHT = 36;
const MAX_CLIMBS_AHEAD = 4;
const HORIZONTAL_PADDING = 8;

interface ProfileTabContentProps {
  activeData: ActiveRouteData | null;
  width: number;
  height: number;
  showClimbsAheadStrip?: boolean;
}

export default function ProfileTabContent({
  activeData,
  width,
  height,
  showClimbsAheadStrip = true,
}: ProfileTabContentProps) {
  const colors = useThemeColors();
  const activeRoutePoints = activeData?.points ?? null;
  const activeId = activeData?.id ?? null;
  const activeRouteIds = useMemo(() => activeData?.routeIds ?? [], [activeData?.routeIds]);
  const activeSegments = activeData?.segments ?? null;
  const activeTotalDistance = activeData?.totalDistanceMeters ?? 0;
  const ferrySpans = useMemo(
    () =>
      (activeData?.ferries ?? []).map((ferry) => ({
        startDistanceMeters: ferry.effectiveStartDistanceMeters,
        endDistanceMeters: ferry.effectiveEndDistanceMeters,
      })),
    [activeData?.ferries],
  );
  const profilePoints = useMemo(
    () =>
      activeRoutePoints ? projectRoutePointsForRidingProfile(activeRoutePoints, ferrySpans) : null,
    [activeRoutePoints, ferrySpans],
  );
  const profileFerries = useMemo(
    () =>
      projectFerrySpansForRidingProfile(
        (activeData?.ferries ?? []).map((ferry) => ({
          id: ferry.id,
          name: ferry.name,
          startDistanceMeters: ferry.effectiveStartDistanceMeters,
          endDistanceMeters: ferry.effectiveEndDistanceMeters,
        })),
        ferrySpans,
      ),
    [activeData?.ferries, ferrySpans],
  );
  const activeTotalRidingDistance = totalRidingDistanceMeters(activeTotalDistance, ferrySpans);

  const panelMode = usePanelStore((s) => s.panelMode);
  const horizonScopeLabel = ridingHorizonScopeLabelForMode(panelMode);
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
  const derivedCurrentDistanceMeters = bucketDistanceForDerivedWork(currentDistanceMeters);

  const getStarredPOIs = usePoiStore((s) => s.getStarredPOIs);
  const starredPOIIds = usePoiStore((s) => s.starredPOIIds);
  const routePois = usePoiStore(useShallow((s) => pickRouteRecords(s.pois, activeRouteIds)));
  const poisForChart = useMemo(() => {
    if (!activeId || activeRouteIds.length === 0) return [];
    return measureSync("profile.poisForChart", () => {
      if (activeSegments) {
        const poisByRoute: Record<string, POI[]> = {};
        for (const routeId of activeRouteIds) {
          poisByRoute[routeId] = getStarredPOIs(routeId);
        }
        return stitchPOIs(activeSegments, poisByRoute);
      }
      return toDisplayPOIs(getStarredPOIs(activeRouteIds[0]));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, activeRouteIds, activeSegments, getStarredPOIs, starredPOIIds, routePois]);
  const projectedPOIsForChart = useMemo(
    () =>
      poisForChart.map((poi) =>
        Object.assign({}, poi, {
          effectiveDistanceMeters: toDisplayDistanceMeters(
            ridingDistanceAtGeometricDistance(poi.effectiveDistanceMeters, ferrySpans),
          ),
        }),
      ),
    [ferrySpans, poisForChart],
  );

  const getClimbsForDisplay = useClimbStore((s) => s.getClimbsForDisplay);
  const routeClimbs = useClimbStore(useShallow((s) => pickRouteRecords(s.climbs, activeRouteIds)));
  const climbsForChart = useMemo(() => {
    if (!activeId || activeRouteIds.length === 0) return [];
    return measureSync("profile.climbsForChart", () =>
      getClimbsForDisplay(activeRouteIds, activeSegments)
        .filter(
          (climb) =>
            !ferrySpans.some(
              (ferry) =>
                climb.effectiveEndDistanceMeters > ferry.startDistanceMeters &&
                climb.effectiveStartDistanceMeters < ferry.endDistanceMeters,
            ),
        )
        .map((climb) => {
          const effectiveStartDistanceMeters = toDisplayDistanceMeters(
            ridingDistanceAtGeometricDistance(climb.effectiveStartDistanceMeters, ferrySpans),
          );
          const effectiveEndDistanceMeters = toDisplayDistanceMeters(
            ridingDistanceAtGeometricDistance(climb.effectiveEndDistanceMeters, ferrySpans),
          );
          return Object.assign({}, climb, {
            lengthMeters: effectiveEndDistanceMeters - effectiveStartDistanceMeters,
            effectiveDistanceMeters: effectiveStartDistanceMeters,
            effectiveStartDistanceMeters,
            effectiveEndDistanceMeters,
          });
        }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, activeRouteIds, activeSegments, getClimbsForDisplay, routeClimbs, ferrySpans]);

  const setSelectedClimb = useClimbStore((s) => s.setSelectedClimb);

  // Slice bounds (matches UpcomingElevation's window)
  const { windowStartDist, windowEndDist } = useMemo(() => {
    if (derivedCurrentDistanceMeters == null || !activeRoutePoints?.length) {
      return { windowStartDist: 0, windowEndDist: 0 };
    }
    const distDone = derivedCurrentDistanceMeters;
    const la = ridingHorizonMetersForMode(panelMode);
    if (la == null) return { windowStartDist: distDone, windowEndDist: activeTotalDistance };
    const window = createRidingHorizonWindow(distDone, la, {
      totalDistanceMeters: activeTotalDistance,
      ferrySpans,
    });
    return {
      windowStartDist: window?.startDistanceMeters ?? distDone,
      windowEndDist: window?.endDistanceMeters ?? activeTotalDistance,
    };
  }, [derivedCurrentDistanceMeters, activeRoutePoints, panelMode, activeTotalDistance, ferrySpans]);

  const statsText = useMemo(() => {
    if (!isSnapped || !activeRoutePoints?.length) return null;
    const { ascent: asc, descent: desc } = measureSync("profile.sliceElevationTotals", () =>
      computeRidingElevationTotals(activeRoutePoints, ferrySpans, windowStartDist, windowEndDist),
    );
    return `↑ ${formatElevation(asc, units)}  ·  ↓ ${formatElevation(desc, units)}`;
  }, [isSnapped, activeRoutePoints, ferrySpans, windowStartDist, windowEndDist, units]);
  const horizonSummaryText = statsText;
  const profileWindowStartDist = ridingDistanceAtGeometricDistance(windowStartDist, ferrySpans);
  const profileWindowEndDist = ridingDistanceAtGeometricDistance(windowEndDist, ferrySpans);

  const climbsAhead = useMemo<DisplayClimb[]>(() => {
    if (climbsForChart.length === 0) return [];
    return climbsForChart
      .filter(
        (c) =>
          c.effectiveEndDistanceMeters > profileWindowStartDist &&
          c.effectiveStartDistanceMeters < profileWindowEndDist,
      )
      .sort((a, b) => a.effectiveStartDistanceMeters - b.effectiveStartDistanceMeters)
      .slice(0, MAX_CLIMBS_AHEAD);
  }, [climbsForChart, profileWindowStartDist, profileWindowEndDist]);
  const segmentBoundaries = useMemo(
    () =>
      buildCollectionSegmentProfileBoundaries(activeSegments).map((boundary) =>
        Object.assign({}, boundary, {
          distanceMeters: ridingDistanceAtGeometricDistance(boundary.distanceMeters, ferrySpans),
        }),
      ),
    [activeSegments, ferrySpans],
  );

  if (!activeId || !activeRoutePoints?.length) {
    return (
      <View className="flex-1 items-center justify-center">
        <Text className="text-[15px] text-muted-foreground">Import and activate a route</Text>
      </View>
    );
  }

  const lookAhead = ridingHorizonMetersForMode(panelMode) ?? activeTotalRidingDistance;

  const showStats = !!horizonSummaryText;
  const showClimbsAhead = showClimbsAheadStrip && isExpanded && climbsAhead.length > 0;
  const isFullRouteHorizon = panelMode === "full-route";

  const climbsAheadHeight = showClimbsAhead
    ? Math.min(climbsAhead.length, MAX_CLIMBS_AHEAD) * CLIMB_ROW_HEIGHT + 24
    : 0;

  const headerBlockHeight = (showStats ? STATS_HEIGHT : 0) + climbsAheadHeight;

  const chartHeight = height - headerBlockHeight;
  const chartWidth = width - HORIZONTAL_PADDING * 2;
  const currentRidingDistanceMeters =
    currentDistanceMeters != null
      ? ridingDistanceAtGeometricDistance(currentDistanceMeters, ferrySpans)
      : null;
  const fullProfileCurrentPointIndex =
    currentRidingDistanceMeters != null && profilePoints
      ? findNearestPointIndexAtDistance(profilePoints, currentRidingDistanceMeters)
      : undefined;

  return (
    <View style={{ height }}>
      {showStats && (
        <View
          className="items-center justify-center"
          style={[
            { height: STATS_HEIGHT },
            { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
          ]}
          accessibilityLabel={`Profile summary for ${horizonScopeLabel}, ${statsText}`}
        >
          <Text
            className="text-[15px] text-muted-foreground font-barlow-sc-medium"
            numberOfLines={1}
          >
            {horizonSummaryText}
          </Text>
        </View>
      )}

      {showClimbsAhead && (
        <ClimbsAheadStrip
          climbs={climbsAhead}
          riderDistance={profileWindowStartDist}
          units={units}
          height={climbsAheadHeight}
          onClimbPress={(climb) => {
            setSelectedClimb(climb);
            setPanelTab("climbs");
          }}
        />
      )}

      <View className="items-center px-2">
        {isFullRouteHorizon ? (
          <ElevationProfile
            points={profilePoints ?? activeRoutePoints}
            units={units}
            width={chartWidth}
            height={chartHeight}
            currentPointIndex={fullProfileCurrentPointIndex}
            currentDistanceMeters={currentRidingDistanceMeters ?? undefined}
            showLegend={false}
            pois={projectedPOIsForChart}
            climbs={climbsForChart}
            ferries={profileFerries}
            segmentBoundaries={segmentBoundaries}
            onPOIPress={(poi) => {
              setSelectedPOI(poi);
            }}
          />
        ) : (
          <UpcomingElevation
            points={profilePoints ?? activeRoutePoints}
            currentDistanceMeters={currentRidingDistanceMeters}
            lookAhead={lookAhead}
            units={units}
            width={chartWidth}
            height={chartHeight}
            pois={projectedPOIsForChart}
            climbs={climbsForChart}
            ferries={profileFerries}
            segmentBoundaries={segmentBoundaries}
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
