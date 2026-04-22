import React, { useMemo } from "react";
import { View, TouchableOpacity, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "@/components/ui/text";
import { Minus, Plus } from "lucide-react-native";
import { useThemeColors } from "@/theme";
import { usePanelStore } from "@/store/panelStore";
import { useRouteStore } from "@/store/routeStore";
import { useSettingsStore } from "@/store/settingsStore";
import { usePoiStore } from "@/store/poiStore";
import { useClimbStore } from "@/store/climbStore";
import { useEtaStore } from "@/store/etaStore";
import { PANEL_MODES } from "@/constants";
import { computeSliceAscent, extractRouteSlice } from "@/utils/geo";
import { formatDistance, formatElevation, formatDuration } from "@/utils/formatters";
import { stitchPOIs } from "@/services/stitchingService";
import UpcomingElevation from "./UpcomingElevation";
import ElevationProfile from "@/components/elevation/ElevationProfile";
import type { PanelMode, POI, ActiveRouteData } from "@/types";

const MAX_SNAP_DISTANCE_M = 1000;

function lookAheadForMode(mode: PanelMode): number {
  const match = mode.match(/^upcoming-(\d+)$/);
  return match ? parseInt(match[1], 10) * 1_000 : 50_000;
}

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
  const setPanelMode = usePanelStore((s) => s.setPanelMode);
  const isExpanded = usePanelStore((s) => s.isExpanded);
  const snappedPosition = useRouteStore((s) => s.snappedPosition);
  const units = useSettingsStore((s) => s.units);
  const setSelectedPOI = usePoiStore((s) => s.setSelectedPOI);

  const isSnapped =
    snappedPosition &&
    activeId &&
    snappedPosition.routeId === activeId &&
    snappedPosition.distanceFromRouteMeters <= MAX_SNAP_DISTANCE_M;

  // Starred POIs on chart
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
    return getStarredPOIs(activeRouteIds[0]);
    // starredPOIIds is a reactivity trigger: getStarredPOIs reads store via get() and is not itself reactive
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, activeRouteIds, activeSegments, getStarredPOIs, starredPOIIds]);

  // Climbs for chart
  const getClimbsForDisplay = useClimbStore((s) => s.getClimbsForDisplay);
  const allClimbs = useClimbStore((s) => s.climbs);
  const climbsForChart = useMemo(() => {
    if (!activeId || activeRouteIds.length === 0) return [];
    return getClimbsForDisplay(activeRouteIds, activeSegments);
    // allClimbs is a reactivity trigger: getClimbsForDisplay reads store via get() and is not itself reactive
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, activeRouteIds, activeSegments, getClimbsForDisplay, allClimbs]);

  // Climb zoom mode
  const currentClimbId = useClimbStore((s) => s.currentClimbId);
  const isClimbZoomed = useClimbStore((s) => s.isClimbZoomed);
  const setClimbZoomed = useClimbStore((s) => s.setClimbZoomed);

  const currentClimb = useMemo(() => {
    if (!currentClimbId) return null;
    return climbsForChart.find((c) => c.id === currentClimbId) ?? null;
  }, [currentClimbId, climbsForChart]);

  const climbSlice = useMemo(() => {
    if (!currentClimb || !activeRoutePoints?.length) return null;
    const padding = 500;
    const startDist = Math.max(0, currentClimb.startDistanceMeters - padding);
    let startIdx = 0;
    for (let i = 0; i < activeRoutePoints.length; i++) {
      if (activeRoutePoints[i].distanceFromStartMeters >= startDist) {
        startIdx = Math.max(0, i - 1);
        break;
      }
    }
    const totalSliceM =
      currentClimb.endDistanceMeters +
      padding -
      activeRoutePoints[startIdx].distanceFromStartMeters;
    const sliced = extractRouteSlice(activeRoutePoints, startIdx, totalSliceM);
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

  const climbProgressText = useMemo(() => {
    if (!currentClimb || !isSnapped || !snappedPosition || !activeRoutePoints?.length) return null;
    const currentDist = snappedPosition.distanceAlongRouteMeters;
    const distToTop = currentClimb.endDistanceMeters - currentDist;
    if (distToTop <= 0) return null;
    const ascentRemaining = computeSliceAscent(
      activeRoutePoints,
      snappedPosition.pointIndex,
      currentClimb.endDistanceMeters,
    );
    return `↑ ${formatElevation(ascentRemaining, units)} remaining  ·  ${formatDistance(distToTop, units)} to top  ·  ${currentClimb.averageGradientPercent}% avg`;
  }, [currentClimb, isSnapped, snappedPosition, activeRoutePoints, units]);

  const showClimbZoom = isClimbZoomed && currentClimb && climbSlice && climbSlice.points.length > 1;

  const cumulativeTime = useEtaStore((s) => s.cumulativeTime);

  // Stats header — elevation gain + riding time for the lookahead window
  const statsText = useMemo(() => {
    if (!isSnapped || !activeId || !activeRoutePoints?.length) return null;
    const idx = snappedPosition!.pointIndex;
    const distDone = activeRoutePoints[idx]?.distanceFromStartMeters ?? 0;
    const la = lookAheadForMode(panelMode);
    const endDist = Math.min(distDone + la, activeTotalDistance);
    const sliceAscent = computeSliceAscent(activeRoutePoints, idx, endDist);
    // Compute riding time for the lookahead slice from cumulative time array
    let durationSuffix: string | null = null;
    if (cumulativeTime && activeRoutePoints.length === cumulativeTime.length) {
      // Find point index at endDist
      let endIdx = idx;
      for (let i = idx; i < activeRoutePoints.length; i++) {
        if (activeRoutePoints[i].distanceFromStartMeters >= endDist) {
          endIdx = i;
          break;
        }
        endIdx = i;
      }
      const sliceSeconds = cumulativeTime[endIdx] - cumulativeTime[idx];
      if (sliceSeconds > 0) {
        durationSuffix = `~${formatDuration(sliceSeconds)}`;
      }
    }
    const base = `\u2191 ${formatElevation(sliceAscent, units)}`;
    return durationSuffix ? `${base}  \u00B7  ${durationSuffix}` : base;
  }, [
    isSnapped,
    snappedPosition,
    activeId,
    activeTotalDistance,
    activeRoutePoints,
    units,
    panelMode,
    cumulativeTime,
  ]);

  // Lookahead +/- controls
  const modeIdx = PANEL_MODES.indexOf(panelMode);
  const canZoomIn = modeIdx > 0;
  const canZoomOut = modeIdx < PANEL_MODES.length - 1;
  const handleZoomIn = () => {
    if (canZoomIn) setPanelMode(PANEL_MODES[modeIdx - 1]);
  };
  const handleZoomOut = () => {
    if (canZoomOut) setPanelMode(PANEL_MODES[modeIdx + 1]);
  };
  const km = panelMode.replace("upcoming-", "");

  if (!activeId || !activeRoutePoints?.length) {
    return (
      <View className="flex-1 items-center justify-center">
        <Text className="text-[15px] text-muted-foreground">Import and activate a route</Text>
      </View>
    );
  }

  const effectivePointIndex = isSnapped ? snappedPosition!.pointIndex : 0;
  const lookAhead = lookAheadForMode(panelMode);

  const HEADER_HEIGHT = 28;
  const HORIZONTAL_PADDING = 8;
  const showClimbHeader = isExpanded && showClimbZoom && !!climbProgressText;
  const showStats = isExpanded && !showClimbZoom && !!statsText;
  const headerHeight = showStats || showClimbHeader ? HEADER_HEIGHT : 0;
  const chartHeight = height - headerHeight - safeBottom;
  const chartWidth = width - HORIZONTAL_PADDING * 2;

  return (
    <View style={{ height }}>
      {showClimbHeader && (
        <TouchableOpacity
          className="justify-center items-center"
          style={[
            { height: HEADER_HEIGHT },
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
          className="flex-row items-center justify-between px-2"
          style={[
            { height: HEADER_HEIGHT },
            { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
          ]}
        >
          <Text
            className="text-[13px] text-muted-foreground font-barlow-sc-medium flex-1 text-center"
            numberOfLines={1}
          >
            {statsText}
          </Text>
          <ZoomControls
            km={km}
            canZoomIn={canZoomIn}
            canZoomOut={canZoomOut}
            onZoomIn={handleZoomIn}
            onZoomOut={handleZoomOut}
          />
        </View>
      )}
      <View className="items-center px-2">
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
      </View>
    </View>
  );
}

function ZoomControls({
  km,
  canZoomIn,
  canZoomOut,
  onZoomIn,
  onZoomOut,
}: {
  km: string;
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
}) {
  const colors = useThemeColors();
  return (
    <View className="flex-row items-center ml-1">
      <TouchableOpacity
        className="w-[32px] h-[32px] items-center justify-center"
        hitSlop={10}
        onPress={onZoomIn}
        disabled={!canZoomIn}
        style={{ opacity: canZoomIn ? 1 : 0.25 }}
        accessibilityLabel="Zoom in elevation"
      >
        <Plus size={14} color={colors.textSecondary} />
      </TouchableOpacity>
      <Text className="text-[11px] font-barlow-sc-semibold text-muted-foreground min-w-[24px] text-center">
        {km}
      </Text>
      <TouchableOpacity
        className="w-[32px] h-[32px] items-center justify-center"
        hitSlop={10}
        onPress={onZoomOut}
        disabled={!canZoomOut}
        style={{ opacity: canZoomOut ? 1 : 0.25 }}
        accessibilityLabel="Zoom out elevation"
      >
        <Minus size={14} color={colors.textSecondary} />
      </TouchableOpacity>
    </View>
  );
}
