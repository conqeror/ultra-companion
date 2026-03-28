import React, { useMemo } from "react";
import { View, StyleSheet, TouchableOpacity, useWindowDimensions } from "react-native";
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
import { useEtaStore } from "@/store/etaStore";
import { BOTTOM_PANEL_HEIGHT_RATIO, POI_CATEGORIES } from "@/constants";
import { computeElevationProgress, computeSliceAscent } from "@/utils/geo";
import { formatDistance, formatElevation, formatDuration, formatETA } from "@/utils/formatters";
import { stitchPOIs } from "@/services/stitchingService";
import UpcomingElevation from "./UpcomingElevation";
import type { RoutePoint, PanelMode, POI, ActiveRouteData } from "@/types";

const MAX_SNAP_DISTANCE_M = 1000;
const PANEL_CLASS = "absolute bottom-0 left-0 right-0 rounded-t-2xl shadow-lg overflow-hidden";
const STATS_ROW_HEIGHT = 28;
const WHATS_NEXT_ROW_HEIGHT = 48;

/** Priority categories for "What's Next" display */
const WHATS_NEXT_CATEGORIES = ["water", "groceries"] as const;

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

  const isVisible = panelMode !== "none";

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
      // Race: stitch starred POIs with distance offsets
      const poisByRoute: Record<string, POI[]> = {};
      for (const routeId of activeRouteIds) {
        poisByRoute[routeId] = getStarredPOIs(routeId);
      }
      return stitchPOIs(activeSegments, poisByRoute);
    }
    return getStarredPOIs(activeRouteIds[0]);
  }, [activeId, activeRouteIds, activeSegments, getStarredPOIs, starredPOIIds]);

  // "What's Next" — next upcoming POI per priority category
  const getNextPOIPerCategory = usePoiStore((s) => s.getNextPOIPerCategory);
  const getETAToPOI = useEtaStore((s) => s.getETAToPOI);
  const cumulativeTime = useEtaStore((s) => s.cumulativeTime);

  const whatsNextItems = useMemo(() => {
    if (!isSnapped || !activeId) return [];
    // For races: combine next POIs from all segments with distance offsets
    let nextPOIs: Partial<Record<string, POI>> = {};
    if (activeSegments) {
      for (const seg of activeSegments) {
        const segNext = getNextPOIPerCategory(
          seg.routeId,
          Math.max(0, snappedPosition!.distanceAlongRouteMeters - seg.distanceOffsetMeters),
        );
        for (const [cat, poi] of Object.entries(segNext)) {
          if (!poi) continue;
          const adjusted: POI = {
            ...poi,
            distanceAlongRouteMeters: poi.distanceAlongRouteMeters + seg.distanceOffsetMeters,
          };
          if (adjusted.distanceAlongRouteMeters <= snappedPosition!.distanceAlongRouteMeters) continue;
          const existing = nextPOIs[cat];
          if (!existing || adjusted.distanceAlongRouteMeters < existing.distanceAlongRouteMeters) {
            nextPOIs[cat] = adjusted;
          }
        }
      }
    } else {
      nextPOIs = getNextPOIPerCategory(activeRouteIds[0], snappedPosition!.distanceAlongRouteMeters);
    }
    const items: { poi: POI; label: string; distText: string; etaText: string | null }[] = [];

    for (const catKey of WHATS_NEXT_CATEGORIES) {
      const poi = nextPOIs[catKey];
      if (!poi) continue;
      const catMeta = POI_CATEGORIES.find((c) => c.key === catKey);
      const dist = poi.distanceAlongRouteMeters - snappedPosition!.distanceAlongRouteMeters;
      if (dist <= 0) continue;

      const eta = getETAToPOI(poi);
      items.push({
        poi,
        label: catMeta?.label ?? catKey,
        distText: formatDistance(dist, units),
        etaText: eta && eta.ridingTimeSeconds > 0 ? `~${formatDuration(eta.ridingTimeSeconds)}` : null,
      });
    }
    return items;
  }, [isSnapped, activeId, activeRouteIds, activeSegments, snappedPosition, getNextPOIPerCategory, getETAToPOI, units, cumulativeTime]);

  // ETA to end of route
  const getETAToDistance = useEtaStore((s) => s.getETAToDistance);

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

  const showStats = !!statsText;
  const showWhatsNext = whatsNextItems.length > 0;
  const headerHeight =
    (showStats ? STATS_ROW_HEIGHT : 0) +
    (showWhatsNext ? WHATS_NEXT_ROW_HEIGHT : 0);
  const chartHeight = panelHeight - headerHeight;
  const chartWidth = screenWidth - 16;

  return (
    <Animated.View
      className={PANEL_CLASS}
      style={[{ height: panelHeight, backgroundColor: colors.surface }, animatedStyle]}
    >
      {showStats && (
        <View
          className="justify-center items-center"
          style={[
            { height: STATS_ROW_HEIGHT },
            !showWhatsNext && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
          ]}
        >
          <Text className="text-[13px] text-muted-foreground font-barlow-sc-medium">
            {statsText}
          </Text>
        </View>
      )}
      {showWhatsNext && (
        <View
          className="flex-row items-center justify-center px-3 gap-3"
          style={[
            { height: WHATS_NEXT_ROW_HEIGHT },
            { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
          ]}
        >
          {whatsNextItems.map((item) => (
            <TouchableOpacity
              key={item.poi.id}
              className="flex-row items-center"
              onPress={() => setSelectedPOI(item.poi)}
            >
              <Text className="text-[11px] font-barlow-semibold text-primary">
                {item.label}
              </Text>
              <Text className="text-[11px] font-barlow-sc-medium text-muted-foreground ml-1">
                {item.distText}
              </Text>
              {item.etaText && (
                <Text className="text-[11px] font-barlow-sc-medium text-muted-foreground ml-1">
                  {item.etaText}
                </Text>
              )}
            </TouchableOpacity>
          ))}
        </View>
      )}
      <UpcomingElevation
        points={activeRoutePoints}
        currentPointIndex={effectivePointIndex}
        lookAhead={lookAhead}
        units={units}
        width={chartWidth}
        height={chartHeight}
        pois={poisForChart}
        onPOIPress={setSelectedPOI}
      />
    </Animated.View>
  );
}
