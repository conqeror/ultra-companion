import React from "react";
import { View, TouchableOpacity, useWindowDimensions } from "react-native";
import { Text } from "@/components/ui/text";
import { Locate, LocateFixed, Mountain, List, RefreshCw, CloudSun } from "lucide-react-native";
import Animated, { useAnimatedStyle, withRepeat, withTiming, Easing } from "react-native-reanimated";
import { cn } from "@/lib/cn";
import { useThemeColors } from "@/theme";
import { usePanelStore } from "@/store/panelStore";
import { usePoiStore } from "@/store/poiStore";
import { BOTTOM_PANEL_HEIGHT_RATIO } from "@/constants";
import PositionAgeIndicator from "./PositionAgeIndicator";
import ConnectivityIndicator from "./ConnectivityIndicator";
import type { PanelMode } from "@/types";

interface MapControlsProps {
  onCenterUser: () => void;
  followUser: boolean;
  onRefreshPosition: () => void;
  isRefreshing: boolean;
  showWeather: boolean;
  onToggleWeather: () => void;
  activeRouteIds: string[];
}

function PanelIcon({ mode, color }: { mode: PanelMode; color: string }) {
  if (mode === "none") return <Mountain size={22} color={color} />;
  const km = mode.replace("upcoming-", "");
  return <Text style={{ color }} className="text-base font-barlow-bold">{km}</Text>;
}

function SpinningRefreshIcon({ color }: { color: string }) {
  const spinStyle = useAnimatedStyle(() => ({
    transform: [
      {
        rotateZ: `${withRepeat(
          withTiming(360, { duration: 1000, easing: Easing.linear }),
          -1,
          false,
        )}deg`,
      },
    ],
  }));

  return (
    <Animated.View style={spinStyle}>
      <RefreshCw size={22} color={color} />
    </Animated.View>
  );
}

export default function MapControls({
  onCenterUser,
  followUser,
  onRefreshPosition,
  isRefreshing,
  showWeather,
  onToggleWeather,
  activeRouteIds,
}: MapControlsProps) {
  const colors = useThemeColors();
  const panelMode = usePanelStore((s) => s.panelMode);
  const cyclePanelMode = usePanelStore((s) => s.cyclePanelMode);
  const panelOpen = panelMode !== "none";

  const hasPOIs = usePoiStore((s) =>
    activeRouteIds.some((id) => (s.pois[id]?.length ?? 0) > 0),
  );
  const setShowPOIList = usePoiStore((s) => s.setShowPOIList);

  const { height: screenHeight } = useWindowDimensions();
  const panelHeight = Math.round(screenHeight * BOTTOM_PANEL_HEIGHT_RATIO);
  const TAB_BAR_CLEARANCE = 16;
  const elevButtonBottom = panelOpen ? panelHeight + TAB_BAR_CLEARANCE : TAB_BAR_CLEARANCE;

  const locateColor = followUser ? colors.accentForeground : colors.textPrimary;
  const panelColor = panelOpen ? colors.accentForeground : colors.textPrimary;

  return (
    <>
      {/* Location + refresh controls — top-right */}
      <View className="absolute right-4 top-[120px] items-center">
        <TouchableOpacity
          className={cn(
            "w-[52px] h-[52px] rounded-xl items-center justify-center shadow-md",
            followUser ? "bg-primary" : "bg-card/95 border border-border-subtle",
          )}
          onPress={onCenterUser}
          accessibilityLabel="Center on my location"
        >
          {followUser ? (
            <LocateFixed size={24} color={locateColor} />
          ) : (
            <Locate size={24} color={locateColor} />
          )}
        </TouchableOpacity>

        <TouchableOpacity
          className="w-[52px] h-[52px] rounded-xl items-center justify-center shadow-md bg-card/95 border border-border-subtle mt-3"
          onPress={onRefreshPosition}
          disabled={isRefreshing}
          accessibilityLabel="Refresh GPS position"
        >
          {isRefreshing ? (
            <SpinningRefreshIcon color={colors.accent} />
          ) : (
            <RefreshCw size={22} color={colors.textPrimary} />
          )}
        </TouchableOpacity>

        <TouchableOpacity
          className={cn(
            "w-[52px] h-[52px] rounded-xl items-center justify-center shadow-md mt-3",
            showWeather ? "bg-primary" : "bg-card/95 border border-border-subtle",
          )}
          onPress={onToggleWeather}
          accessibilityLabel="Toggle weather"
        >
          <CloudSun size={22} color={showWeather ? colors.accentForeground : colors.textPrimary} />
        </TouchableOpacity>

        <PositionAgeIndicator />
        <ConnectivityIndicator />
      </View>

      {/* POI list button — bottom-left, above panel/tab bar */}
      {hasPOIs && (
        <View className="absolute left-4" style={{ bottom: elevButtonBottom }}>
          <TouchableOpacity
            className="w-[52px] h-[52px] rounded-xl items-center justify-center shadow-md bg-card/95 border border-border-subtle"
            onPress={() => setShowPOIList(true)}
            accessibilityLabel="Show POI list"
          >
            <List size={22} color={colors.textPrimary} />
          </TouchableOpacity>
        </View>
      )}

      {/* Elevation panel control — bottom-right, above panel/tab bar */}
      <View className="absolute right-4" style={{ bottom: elevButtonBottom }}>
        <TouchableOpacity
          className={cn(
            "w-[52px] h-[52px] rounded-xl items-center justify-center shadow-md",
            panelOpen ? "bg-primary" : "bg-card/95 border border-border-subtle",
          )}
          onPress={cyclePanelMode}
          accessibilityLabel="Cycle bottom panel mode"
        >
          <PanelIcon mode={panelMode} color={panelColor} />
        </TouchableOpacity>
      </View>
    </>
  );
}
