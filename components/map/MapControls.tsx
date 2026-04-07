import React, { useEffect, useState } from "react";
import { View, TouchableOpacity, useWindowDimensions } from "react-native";
import { Text } from "@/components/ui/text";
import { Locate, LocateFixed, List, RefreshCw, CloudSun, Mountain } from "lucide-react-native";
import Animated, { useAnimatedStyle, withRepeat, withTiming, Easing } from "react-native-reanimated";
import { cn } from "@/lib/cn";
import { useThemeColors } from "@/theme";
import { usePanelStore } from "@/store/panelStore";
import { usePoiStore } from "@/store/poiStore";
import { useClimbStore } from "@/store/climbStore";
import { useMapStore } from "@/store/mapStore";
import { formatTimeDelta } from "@/utils/formatters";
import {
  BOTTOM_PANEL_HEIGHT_RATIO,
  POSITION_AGE_VISIBLE_THRESHOLD_MS,
  GPS_STALE_THRESHOLD_MS,
} from "@/constants";

interface MapControlsProps {
  onLocate: () => void;
  activeRouteIds: string[];
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
      <RefreshCw size={20} color={color} />
    </Animated.View>
  );
}

function usePositionAge() {
  const userPosition = useMapStore((s) => s.userPosition);
  const [, setTick] = useState(0);

  const ageMs = userPosition ? Date.now() - userPosition.timestamp : 0;
  const shouldShow = userPosition != null && ageMs >= POSITION_AGE_VISIBLE_THRESHOLD_MS;
  const isStale = ageMs >= GPS_STALE_THRESHOLD_MS;

  useEffect(() => {
    if (!shouldShow) return;
    const interval = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(interval);
  }, [shouldShow]);

  if (!shouldShow || !userPosition) return null;

  return { label: formatTimeDelta(ageMs), isStale };
}

export default function MapControls({
  onLocate,
  activeRouteIds,
}: MapControlsProps) {
  const colors = useThemeColors();
  const positionAge = usePositionAge();

  const followUser = useMapStore((s) => s.followUser);
  const isRefreshing = useMapStore((s) => s.isRefreshing);

  const panelMode = usePanelStore((s) => s.panelMode);
  const cyclePanelMode = usePanelStore((s) => s.cyclePanelMode);
  const bottomSheet = usePanelStore((s) => s.bottomSheet);
  const setBottomSheet = usePanelStore((s) => s.setBottomSheet);
  const showWeather = bottomSheet === "weather";
  const showClimb = bottomSheet === "climb";
  const showElevation = !showWeather && !showClimb;

  const hasPOIs = usePoiStore((s) =>
    activeRouteIds.some((id) => (s.pois[id]?.length ?? 0) > 0),
  );
  const setShowPOIList = usePoiStore((s) => s.setShowPOIList);

  const hasClimbs = useClimbStore((s) =>
    activeRouteIds.some((id) => (s.climbs[id]?.length ?? 0) > 0),
  );
  const setSelectedClimb = useClimbStore((s) => s.setSelectedClimb);

  const { height: screenHeight } = useWindowDimensions();
  const panelHeight = Math.round(screenHeight * BOTTOM_PANEL_HEIGHT_RATIO);
  const TAB_BAR_CLEARANCE = 16;
  const buttonBottom = panelHeight + TAB_BAR_CLEARANCE;

  const locateColor = followUser ? colors.accentForeground : colors.textPrimary;
  const elevColor = showElevation ? colors.accentForeground : colors.textPrimary;

  const locateIcon = isRefreshing ? (
    <SpinningRefreshIcon color={followUser ? colors.accentForeground : colors.accent} />
  ) : followUser ? (
    <LocateFixed size={positionAge ? 20 : 24} color={locateColor} />
  ) : (
    <Locate size={positionAge ? 20 : 24} color={locateColor} />
  );

  const handleElevationPress = () => {
    if (showWeather || showClimb) {
      setBottomSheet(null);
    } else {
      cyclePanelMode();
    }
  };

  const km = panelMode.replace("upcoming-", "");

  return (
    <>
      {/* Locate — top-right */}
      <View className="absolute right-4 top-[120px] items-center">
        <TouchableOpacity
          className={cn(
            "w-[52px] rounded-xl items-center justify-center shadow-md",
            followUser ? "bg-primary" : "bg-card/95 border border-border-subtle",
            positionAge ? "py-2" : "h-[52px]",
          )}
          onPress={onLocate}
          accessibilityLabel="Center on my location"
        >
          {locateIcon}
          {positionAge && !isRefreshing && (
            <Text
              className="text-[10px] font-barlow-semibold mt-1"
              style={{ color: positionAge.isStale
                ? colors.warning
                : followUser ? colors.accentForeground : colors.textTertiary
              }}
            >
              {positionAge.label}
            </Text>
          )}
        </TouchableOpacity>
      </View>

      {/* POI list — bottom-left */}
      {hasPOIs && (
        <View className="absolute left-4" style={{ bottom: buttonBottom }}>
          <TouchableOpacity
            className="w-[52px] h-[52px] rounded-xl items-center justify-center shadow-md bg-card/95 border border-border-subtle"
            onPress={() => setShowPOIList(true)}
            accessibilityLabel="Show POI list"
          >
            <List size={22} color={colors.textPrimary} />
          </TouchableOpacity>
        </View>
      )}

      {/* Climb + Weather + Elevation — bottom-right */}
      <View className="absolute right-4 items-center" style={{ bottom: buttonBottom }}>
        {hasClimbs && (
          <TouchableOpacity
            className={cn(
              "w-[52px] h-[52px] rounded-xl items-center justify-center shadow-md mb-3",
              showClimb ? "bg-primary" : "bg-card/95 border border-border-subtle",
            )}
            onPress={() => {
              if (showClimb) {
                setBottomSheet(null);
              } else {
                setSelectedClimb(null); // clear manual selection, let auto-select pick
                setBottomSheet("climb");
              }
            }}
            accessibilityLabel="Show climb info"
          >
            <Mountain size={22} color={showClimb ? colors.accentForeground : colors.textPrimary} />
          </TouchableOpacity>
        )}
        <TouchableOpacity
          className={cn(
            "w-[52px] h-[52px] rounded-xl items-center justify-center shadow-md",
            showWeather ? "bg-primary" : "bg-card/95 border border-border-subtle",
          )}
          onPress={() => setBottomSheet(showWeather ? null : "weather")}
          accessibilityLabel="Show weather"
        >
          <CloudSun size={22} color={showWeather ? colors.accentForeground : colors.textPrimary} />
        </TouchableOpacity>

        <TouchableOpacity
          className={cn(
            "w-[52px] h-[52px] rounded-xl items-center justify-center shadow-md mt-3",
            showElevation ? "bg-primary" : "bg-card/95 border border-border-subtle",
          )}
          onPress={handleElevationPress}
          accessibilityLabel="Show elevation profile"
        >
          <Text style={{ color: elevColor }} className="text-base font-barlow-bold">{km}</Text>
        </TouchableOpacity>
      </View>
    </>
  );
}
