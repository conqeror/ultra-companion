import React, { useMemo, useCallback } from "react";
import { View, FlatList, TouchableOpacity } from "react-native";
import Animated, { useAnimatedStyle, withTiming, Easing } from "react-native-reanimated";
import { Text } from "@/components/ui/text";
import { X, Check } from "lucide-react-native";
import { cn } from "@/lib/cn";
import { useThemeColors } from "@/theme";
import { useRouteStore } from "@/store/routeStore";
import { useSettingsStore } from "@/store/settingsStore";
import { formatDistance, formatElevation } from "@/utils/formatters";
import type { Route } from "@/types";

interface AddSegmentSheetProps {
  visible: boolean;
  onClose: () => void;
  onAdd: (routeId: string) => void;
  existingRouteIds: Set<string>;
}

export default function AddSegmentSheet({
  visible,
  onClose,
  onAdd,
  existingRouteIds,
}: AddSegmentSheetProps) {
  const colors = useThemeColors();
  const routes = useRouteStore((s) => s.routes);
  const units = useSettingsStore((s) => s.units);

  const sortedRoutes = useMemo(
    () => [...routes].sort((a, b) => a.name.localeCompare(b.name)),
    [routes],
  );

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateY: withTiming(visible ? 0 : 2000, {
          duration: 300,
          easing: Easing.out(Easing.cubic),
        }),
      },
    ],
  }));

  const renderItem = useCallback(
    ({ item: route }: { item: Route }) => {
      const isInCollection = existingRouteIds.has(route.id);
      return (
        <TouchableOpacity
          className="flex-row items-center px-4 py-3 min-h-[56px]"
          onPress={() => !isInCollection && onAdd(route.id)}
          disabled={isInCollection}
          activeOpacity={0.7}
        >
          <View className="flex-1 mr-3">
            <Text
              className={cn(
                "text-[15px] font-barlow-medium",
                isInCollection ? "text-muted-foreground" : "text-foreground",
              )}
              numberOfLines={1}
            >
              {route.name}
            </Text>
            <Text className="text-[12px] text-muted-foreground font-barlow-sc-medium mt-0.5">
              {formatDistance(route.totalDistanceMeters, units)}
              {"  ·  "}↑ {formatElevation(route.totalAscentMeters, units)}
            </Text>
          </View>
          {isInCollection && <Check size={18} color={colors.positive} />}
        </TouchableOpacity>
      );
    },
    [existingRouteIds, onAdd, units, colors.positive],
  );

  if (!visible) return null;

  return (
    <Animated.View
      className="absolute inset-0 z-30"
      style={[{ top: 48, backgroundColor: colors.background }, animatedStyle]}
    >
      <View className="flex-row items-center px-4 py-3 border-b border-border">
        <Text className="flex-1 text-[20px] font-barlow-semibold text-foreground">Add Segment</Text>
        <TouchableOpacity
          className="w-[48px] h-[48px] items-center justify-center -mr-2"
          onPress={onClose}
          accessibilityLabel="Close"
        >
          <X size={22} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {sortedRoutes.length === 0 ? (
        <View className="flex-1 items-center justify-center">
          <Text className="text-[15px] text-muted-foreground">Import routes first</Text>
        </View>
      ) : (
        <FlatList
          data={sortedRoutes}
          keyExtractor={(r) => r.id}
          renderItem={renderItem}
          contentContainerStyle={{ paddingBottom: 100 }}
        />
      )}
    </Animated.View>
  );
}
