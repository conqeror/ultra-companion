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
import UpcomingElevation from "./UpcomingElevation";
import ElevationProfile from "@/components/elevation/ElevationProfile";
import WeatherPanel from "./WeatherPanel";
import type { RoutePoint, PanelMode, POI } from "@/types";

const MAX_SNAP_DISTANCE_M = 500;
const PANEL_CLASS = "absolute bottom-0 left-0 right-0 bg-surface rounded-t-2xl shadow-lg overflow-hidden";
const STATS_ROW_HEIGHT = 28;
const WHATS_NEXT_ROW_HEIGHT = 48;

/** Priority categories for "What's Next" display */
const WHATS_NEXT_CATEGORIES = ["water", "groceries", "cafe_restaurant", "accommodation"] as const;

/** Extract the numeric look-ahead in meters from an upcoming-* mode, or null */
function lookAheadForMode(mode: PanelMode): number | "remaining" | null {
  if (mode === "upcoming-5") return 5_000;
  if (mode === "upcoming-10") return 10_000;
  if (mode === "upcoming-20") return 20_000;
  if (mode === "remaining") return "remaining";
  return null;
}

interface BottomPanelProps {
  activeRoutePoints: RoutePoint[] | null;
}

export default function BottomPanel({ activeRoutePoints }: BottomPanelProps) {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const panelHeight = Math.round(screenHeight * BOTTOM_PANEL_HEIGHT_RATIO);
  const colors = useThemeColors();

  const panelMode = usePanelStore((s) => s.panelMode);
  const routes = useRouteStore((s) => s.routes);
  const snappedPosition = useRouteStore((s) => s.snappedPosition);
  const units = useSettingsStore((s) => s.units);
  const setSelectedPOI = usePoiStore((s) => s.setSelectedPOI);

  const activeRoute = useMemo(() => routes.find((r) => r.isActive) ?? null, [routes]);
  const isVisible = panelMode !== "none";

  const isSnapped =
    isVisible &&
    snappedPosition &&
    activeRoute &&
    snappedPosition.routeId === activeRoute.id &&
    snappedPosition.distanceFromRouteMeters <= MAX_SNAP_DISTANCE_M;

  // Only starred POIs appear on the elevation profile
  const getStarredPOIs = usePoiStore((s) => s.getStarredPOIs);
  const starredPOIIds = usePoiStore((s) => s.starredPOIIds);
  const poisForChart = useMemo(() => {
    if (!activeRoute) return [];
    return getStarredPOIs(activeRoute.id);
  }, [activeRoute, getStarredPOIs, starredPOIIds]);


  // "What's Next" — next upcoming POI per priority category
  const getNextPOIPerCategory = usePoiStore((s) => s.getNextPOIPerCategory);
  const getETAToPOI = useEtaStore((s) => s.getETAToPOI);
  const cumulativeTime = useEtaStore((s) => s.cumulativeTime);

  const whatsNextItems = useMemo(() => {
    if (!isSnapped || !activeRoute) return [];
    const nextPOIs = getNextPOIPerCategory(activeRoute.id, snappedPosition!.distanceAlongRouteMeters);
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
  }, [isSnapped, activeRoute, snappedPosition, getNextPOIPerCategory, getETAToPOI, units, cumulativeTime]);

  // ETA to end of route
  const getETAToDistance = useEtaStore((s) => s.getETAToDistance);

  // Stats for the compact header
  const statsText = useMemo(() => {
    if (!isSnapped || !activeRoute || !activeRoutePoints?.length) return null;
    const idx = snappedPosition!.pointIndex;
    const distDone = activeRoutePoints[idx]?.distanceFromStartMeters ?? 0;
    const distLeft = activeRoute.totalDistanceMeters - distDone;
    const elev = computeElevationProgress(activeRoutePoints, idx);

    // ETA to finish
    const finishETA = getETAToDistance(activeRoute.totalDistanceMeters);
    const etaSuffix = finishETA && finishETA.ridingTimeSeconds > 0
      ? `~${formatDuration(finishETA.ridingTimeSeconds)} (${formatETA(finishETA.eta)})`
      : null;

    // For upcoming-N modes, compute slice-specific stats
    const la = lookAheadForMode(panelMode);
    if (typeof la === "number") {
      const sliceAscent = computeSliceAscent(activeRoutePoints, idx, distDone + la);
      const sliceDist = Math.min(la, distLeft);
      const base = `${formatDistance(sliceDist, units)} / ${formatDistance(distLeft, units)} left  \u00B7  \u2191 ${formatElevation(sliceAscent, units)} / ${formatElevation(elev.ascentRemaining, units)}`;
      return etaSuffix ? `${base}  \u00B7  ${etaSuffix}` : base;
    }

    const base = `${formatDistance(distLeft, units)} left  \u00B7  \u2191 ${formatElevation(elev.ascentRemaining, units)}`;
    return etaSuffix ? `${base}  \u00B7  ${etaSuffix}` : base;
  }, [isSnapped, snappedPosition, activeRoute, activeRoutePoints, units, panelMode, getETAToDistance, cumulativeTime]);

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

  const isWeatherMode = panelMode === "weather";
  const lookAhead = lookAheadForMode(panelMode);
  const isElevationMode = lookAhead !== null;

  // Edge case: no active route
  if (!activeRoute || !activeRoutePoints?.length) {
    return (
      <Animated.View
        className={PANEL_CLASS}
        style={[{ height: panelHeight }, animatedStyle]}
      >
        <View className="flex-1 items-center justify-center">
          <Text className="text-[15px] text-muted-foreground">
            Import and activate a route
          </Text>
        </View>
      </Animated.View>
    );
  }

  // Weather mode: render directly without needing snap
  if (isWeatherMode) {
    return (
      <Animated.View
        className={PANEL_CLASS}
        style={[{ height: panelHeight }, animatedStyle]}
      >
        <WeatherPanel height={panelHeight} />
      </Animated.View>
    );
  }

  // Edge case: not snapped but elevation mode requires it
  if (isElevationMode && !isSnapped) {
    return (
      <Animated.View
        className={PANEL_CLASS}
        style={[{ height: panelHeight }, animatedStyle]}
      >
        <View className="flex-1 items-center justify-center">
          <Text className="text-[15px] text-muted-foreground">
            Ride closer to your route
          </Text>
        </View>
      </Animated.View>
    );
  }

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
      style={[{ height: panelHeight }, animatedStyle]}
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
      {isElevationMode && isSnapped && (
        <UpcomingElevation
          points={activeRoutePoints}
          currentPointIndex={snappedPosition!.pointIndex}
          lookAhead={lookAhead}
          units={units}
          width={chartWidth}
          height={chartHeight}
          pois={poisForChart}
          onPOIPress={setSelectedPOI}
        />
      )}
      {panelMode === "full" && (
        <ElevationProfile
          points={activeRoutePoints}
          units={units}
          width={chartWidth}
          height={chartHeight}
          currentPointIndex={isSnapped ? snappedPosition!.pointIndex : undefined}
          showLegend={false}
          pois={poisForChart}
          onPOIPress={setSelectedPOI}
        />
      )}
    </Animated.View>
  );
}
