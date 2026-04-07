import React, { useEffect, useState } from "react";
import { View, TouchableOpacity } from "react-native";
import { useRouter } from "expo-router";
import { Text } from "@/components/ui/text";
import { Locate, LocateFixed, RefreshCw, Menu } from "lucide-react-native";
import Animated, { useAnimatedStyle, withRepeat, withTiming, Easing } from "react-native-reanimated";
import { cn } from "@/lib/cn";
import { useThemeColors } from "@/theme";
import { useMapStore } from "@/store/mapStore";
import { formatTimeDelta } from "@/utils/formatters";
import {
  POSITION_AGE_VISIBLE_THRESHOLD_MS,
  GPS_STALE_THRESHOLD_MS,
} from "@/constants";

interface MapControlsProps {
  onLocate: () => void;
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

export default function MapControls({ onLocate }: MapControlsProps) {
  const colors = useThemeColors();
  const router = useRouter();
  const positionAge = usePositionAge();

  const followUser = useMapStore((s) => s.followUser);
  const isRefreshing = useMapStore((s) => s.isRefreshing);

  const locateColor = followUser ? colors.accentForeground : colors.textPrimary;

  const locateIcon = isRefreshing ? (
    <SpinningRefreshIcon color={followUser ? colors.accentForeground : colors.accent} />
  ) : followUser ? (
    <LocateFixed size={positionAge ? 20 : 24} color={locateColor} />
  ) : (
    <Locate size={positionAge ? 20 : 24} color={locateColor} />
  );

  return (
    <>
      {/* Menu — top-left */}
      <View className="absolute left-4 top-[64px]">
        <TouchableOpacity
          className="w-[52px] h-[52px] rounded-xl items-center justify-center shadow-md bg-surface/95 border border-border-subtle"
          onPress={() => router.push("/menu")}
          accessibilityLabel="Open menu"
        >
          <Menu size={22} color={colors.textPrimary} />
        </TouchableOpacity>
      </View>

      {/* Locate — top-right */}
      <View className="absolute right-4 top-[64px] items-center">
        <TouchableOpacity
          className={cn(
            "w-[52px] min-h-[52px] rounded-xl items-center justify-center shadow-md",
            followUser ? "bg-primary" : "bg-surface/95 border border-border-subtle",
            positionAge ? "py-2" : "",
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
    </>
  );
}
