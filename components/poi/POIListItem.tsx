import React from "react";
import { View, TouchableOpacity } from "react-native";
import { Text } from "@/components/ui/text";
import {
  Droplets,
  ShoppingCart,
  Fuel,
  Coffee,
  Bed,
  Wrench,
  Banknote,
  Cross,
  ShowerHead,
} from "lucide-react-native";
import { useThemeColors } from "@/theme";
import { useSettingsStore } from "@/store/settingsStore";
import { POI_CATEGORIES } from "@/constants";
import { formatDistance } from "@/utils/formatters";
import type { POI } from "@/types";

const ICON_MAP: Record<string, React.ComponentType<any>> = {
  Droplets,
  ShoppingCart,
  Fuel,
  Coffee,
  Bed,
  Wrench,
  Banknote,
  Cross,
  ShowerHead,
};

interface POIListItemProps {
  poi: POI;
  currentDistAlongRoute: number | null;
  onPress: (poi: POI) => void;
}

export default function POIListItem({
  poi,
  currentDistAlongRoute,
  onPress,
}: POIListItemProps) {
  const colors = useThemeColors();
  const units = useSettingsStore((s) => s.units);

  const catMeta = POI_CATEGORIES.find((c) => c.key === poi.category);
  const IconComp = catMeta ? ICON_MAP[catMeta.iconName] : null;

  const distAhead =
    currentDistAlongRoute != null
      ? poi.distanceAlongRouteMeters - currentDistAlongRoute
      : null;

  return (
    <TouchableOpacity
      className="flex-row items-center px-4 py-3 border-b border-border"
      onPress={() => onPress(poi)}
      accessibilityLabel={poi.name ?? catMeta?.label ?? "POI"}
    >
      <View
        className="w-[32px] h-[32px] rounded-full items-center justify-center"
        style={{ backgroundColor: (catMeta?.color ?? colors.textTertiary) + "1A" }}
      >
        {IconComp && (
          <IconComp size={18} color={catMeta?.color ?? colors.textPrimary} />
        )}
      </View>

      <View className="flex-1 ml-3">
        <Text
          className="text-[15px] font-barlow-medium text-foreground"
          numberOfLines={1}
        >
          {poi.name ?? catMeta?.label ?? "Unnamed"}
        </Text>
        <Text className="text-[12px] text-muted-foreground font-barlow mt-1">
          {Math.round(poi.distanceFromRouteMeters)} m off route
        </Text>
      </View>

      <View className="items-end ml-2">
        {distAhead != null && (
          <Text
            className="text-[15px] font-barlow-sc-semibold text-foreground"
          >
            {distAhead >= 0
              ? formatDistance(distAhead, units)
              : `-${formatDistance(Math.abs(distAhead), units)}`}
          </Text>
        )}
        {distAhead != null && (
          <Text className="text-[11px] text-muted-foreground font-barlow">
            {distAhead >= 0 ? "ahead" : "behind"}
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );
}
