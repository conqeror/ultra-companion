import React, { useEffect, useState } from "react";
import { View, TouchableOpacity } from "react-native";
import { useRouter } from "expo-router";
import { Text } from "@/components/ui/text";
import { Layers, Locate, LocateFixed, MapPin, Menu, Ruler } from "lucide-react-native";
import Animated, {
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
  useSharedValue,
} from "react-native-reanimated";
import { cn } from "@/lib/cn";
import { useThemeColors } from "@/theme";
import { useMapStore } from "@/store/mapStore";
import { formatTimeDelta } from "@/utils/formatters";
import { POSITION_AGE_VISIBLE_THRESHOLD_MS, GPS_STALE_THRESHOLD_MS } from "@/constants";

interface MapControlsProps {
  onLocate: () => void;
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
  const [isDisplayMenuOpen, setIsDisplayMenuOpen] = useState(false);

  const followUser = useMapStore((s) => s.followUser);
  const isRefreshing = useMapStore((s) => s.isRefreshing);
  const showDistanceMarkers = useMapStore((s) => s.showDistanceMarkers);
  const showPOIs = useMapStore((s) => s.showPOIs);
  const toggleDistanceMarkers = useMapStore((s) => s.toggleDistanceMarkers);
  const togglePOIs = useMapStore((s) => s.togglePOIs);

  const locateColor = followUser ? colors.accentForeground : colors.textPrimary;
  const iconSize = positionAge ? 20 : 24;
  const hasDisplayOverride = showDistanceMarkers || !showPOIs;

  const pulse = useSharedValue(0);

  useEffect(() => {
    if (isRefreshing) {
      pulse.value = withRepeat(
        withTiming(1, { duration: 800, easing: Easing.inOut(Easing.ease) }),
        -1,
        true,
      );
    } else {
      pulse.value = withTiming(0, { duration: 300 });
    }
    // pulse is a Reanimated SharedValue with a stable ref; reading .value should not be a dep
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRefreshing]);

  const pulseStyle = useAnimatedStyle(() => ({
    opacity: isRefreshing ? 0.4 + pulse.value * 0.6 : 1,
  }));

  const locateIcon = (
    <Animated.View style={pulseStyle}>
      {followUser ? (
        <LocateFixed size={iconSize} color={locateColor} />
      ) : (
        <Locate size={iconSize} color={locateColor} />
      )}
    </Animated.View>
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
              style={{
                color: positionAge.isStale
                  ? colors.warning
                  : followUser
                    ? colors.accentForeground
                    : colors.textTertiary,
              }}
            >
              {positionAge.label}
            </Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Display toggles — top-right, below locate */}
      <View className="absolute right-4 top-[128px] items-end">
        <TouchableOpacity
          className={cn(
            "w-[52px] h-[52px] rounded-xl items-center justify-center shadow-md",
            isDisplayMenuOpen || hasDisplayOverride
              ? "bg-primary"
              : "bg-surface/95 border border-border-subtle",
          )}
          onPress={() => setIsDisplayMenuOpen((open) => !open)}
          accessibilityLabel="Map display options"
          accessibilityRole="button"
          accessibilityState={{ expanded: isDisplayMenuOpen }}
        >
          <Layers
            size={23}
            color={
              isDisplayMenuOpen || hasDisplayOverride ? colors.accentForeground : colors.textPrimary
            }
          />
        </TouchableOpacity>

        {isDisplayMenuOpen && (
          <View className="mt-3 w-[164px] overflow-hidden rounded-xl border border-border-subtle bg-surface/95 shadow-md">
            <MapDisplayToggle icon="pois" label="POIs" value={showPOIs} onPress={togglePOIs} />
            <View className="h-px bg-border-subtle" />
            <MapDisplayToggle
              icon="markers"
              label="Markers"
              value={showDistanceMarkers}
              onPress={toggleDistanceMarkers}
            />
          </View>
        )}
      </View>
    </>
  );
}

function MapDisplayToggle({
  icon,
  label,
  value,
  onPress,
}: {
  icon: "pois" | "markers";
  label: string;
  value: boolean;
  onPress: () => void;
}) {
  const colors = useThemeColors();
  const Icon = icon === "pois" ? MapPin : Ruler;

  return (
    <TouchableOpacity
      className="min-h-[48px] flex-row items-center px-3"
      onPress={onPress}
      accessibilityLabel={`${value ? "Hide" : "Show"} ${label}`}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      activeOpacity={0.75}
    >
      <View className="w-[28px] items-start">
        <Icon size={19} color={value ? colors.accent : colors.textTertiary} />
      </View>
      <Text className="flex-1 text-[13px] font-barlow-semibold text-foreground">{label}</Text>
      <View
        className={cn("h-[24px] w-[42px] rounded-full p-0.5", value ? "bg-primary" : "bg-muted")}
      >
        <View
          className={cn(
            "h-[20px] w-[20px] rounded-full bg-background shadow-sm",
            value ? "self-end" : "self-start",
          )}
        />
      </View>
    </TouchableOpacity>
  );
}
