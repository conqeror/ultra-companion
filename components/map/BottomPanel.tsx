import React, { useMemo } from "react";
import { View, StyleSheet, useWindowDimensions } from "react-native";
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
import { BOTTOM_PANEL_HEIGHT_RATIO } from "@/constants";
import { computeElevationProgress, computeSliceAscent } from "@/utils/geo";
import { formatDistance, formatElevation } from "@/utils/formatters";
import UpcomingElevation from "./UpcomingElevation";
import ElevationProfile from "@/components/elevation/ElevationProfile";
import type { RoutePoint, PanelMode } from "@/types";

const MAX_SNAP_DISTANCE_M = 500;
const PANEL_CLASS = "absolute bottom-0 left-0 right-0 bg-surface rounded-t-2xl shadow-lg overflow-hidden";
const STATS_ROW_HEIGHT = 28;

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

  const activeRoute = useMemo(() => routes.find((r) => r.isActive) ?? null, [routes]);
  const isVisible = panelMode !== "none";

  const isSnapped =
    isVisible &&
    snappedPosition &&
    activeRoute &&
    snappedPosition.routeId === activeRoute.id &&
    snappedPosition.distanceFromRouteMeters <= MAX_SNAP_DISTANCE_M;

  // Stats for the compact header
  const statsText = useMemo(() => {
    if (!isSnapped || !activeRoute || !activeRoutePoints?.length) return null;
    const idx = snappedPosition!.pointIndex;
    const distDone = activeRoutePoints[idx]?.distanceFromStartMeters ?? 0;
    const distLeft = activeRoute.totalDistanceMeters - distDone;
    const pct = activeRoute.totalDistanceMeters > 0
      ? Math.round((distDone / activeRoute.totalDistanceMeters) * 100)
      : 0;
    const elev = computeElevationProgress(activeRoutePoints, idx);

    // For upcoming-N modes, compute slice-specific stats
    const la = lookAheadForMode(panelMode);
    if (typeof la === "number") {
      const sliceAscent = computeSliceAscent(activeRoutePoints, idx, distDone + la);
      const sliceDist = Math.min(la, distLeft);
      return `${formatDistance(sliceDist, units)} / ${formatDistance(distLeft, units)} left  \u00B7  \u2191 ${formatElevation(sliceAscent, units)} / ${formatElevation(elev.ascentRemaining, units)}  \u00B7  ${pct}%`;
    }

    return `${formatDistance(distLeft, units)} left  \u00B7  \u2191 ${formatElevation(elev.ascentRemaining, units)}  \u00B7  ${pct}%`;
  }, [isSnapped, snappedPosition, activeRoute, activeRoutePoints, units, panelMode]);

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
  const chartHeight = showStats ? panelHeight - STATS_ROW_HEIGHT : panelHeight;
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
            { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
          ]}
        >
          <Text className="text-[13px] text-muted-foreground font-barlow-sc-medium">
            {statsText}
          </Text>
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
        />
      )}
    </Animated.View>
  );
}
