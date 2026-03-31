import React, { useMemo } from "react";
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
  Tent,
} from "lucide-react-native";
import { Star } from "lucide-react-native";
import { useThemeColors } from "@/theme";
import { useSettingsStore } from "@/store/settingsStore";
import { usePoiStore } from "@/store/poiStore";
import { POI_CATEGORIES } from "@/constants";
import { ohStatusColorKey } from "@/constants/poiHelpers";
import { formatDistance, formatDuration } from "@/utils/formatters";
import { getOpeningHoursStatus } from "@/services/openingHoursParser";
import { useEtaStore } from "@/store/etaStore";
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
  Tent,
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

  const isStarred = usePoiStore((s) => s.starredPOIIds.has(poi.id));
  const getETAToPOI = useEtaStore((s) => s.getETAToPOI);

  const distAhead =
    currentDistAlongRoute != null
      ? poi.distanceAlongRouteMeters - currentDistAlongRoute
      : null;

  const etaResult = useMemo(() => getETAToPOI(poi), [poi, getETAToPOI]);

  const ohStatus = useMemo(() => {
    const tag = poi.tags?.opening_hours;
    return tag ? getOpeningHoursStatus(tag) : null;
  }, [poi.tags?.opening_hours]);

  const ohColor = useMemo(() => {
    const key = ohStatusColorKey(ohStatus);
    return key ? colors[key] : undefined;
  }, [ohStatus, colors]);

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
        <View className="flex-row items-center">
          {isStarred && (
            <Star size={12} color={colors.warning} fill={colors.warning} style={{ marginRight: 4 }} />
          )}
          <Text
            className="text-[15px] font-barlow-medium text-foreground flex-shrink"
            numberOfLines={1}
          >
            {poi.name ?? catMeta?.label ?? "Unnamed"}
          </Text>
        </View>
        <View className="flex-row items-center mt-1">
          {ohStatus && (
            <View className="flex-row items-center">
              <View
                className="w-[6px] h-[6px] rounded-full"
                style={{ backgroundColor: ohColor }}
              />
              <Text
                className="ml-1 text-[12px] font-barlow-medium"
                style={{ color: ohColor }}
              >
                {ohStatus.label}
                {ohStatus.detail ? ` · ${ohStatus.detail}` : ""}
              </Text>
            </View>
          )}
          {ohStatus && poi.distanceFromRouteMeters > 50 && (
            <Text className="text-[11px] text-muted-foreground/60 font-barlow ml-2">
              {Math.round(poi.distanceFromRouteMeters)} m off
            </Text>
          )}
          {!ohStatus && poi.distanceFromRouteMeters > 50 && (
            <Text className="text-[11px] text-muted-foreground/60 font-barlow">
              {Math.round(poi.distanceFromRouteMeters)} m off route
            </Text>
          )}
        </View>
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
        {etaResult && etaResult.ridingTimeSeconds > 0 ? (
          <Text className="text-[11px] text-muted-foreground font-barlow-sc-medium">
            ~{formatDuration(etaResult.ridingTimeSeconds)}
          </Text>
        ) : distAhead != null ? (
          <Text className="text-[11px] text-muted-foreground font-barlow">
            {distAhead >= 0 ? "ahead" : "behind"}
          </Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}
