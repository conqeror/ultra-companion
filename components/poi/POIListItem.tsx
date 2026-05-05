import React, { useMemo } from "react";
import { View, TouchableOpacity } from "react-native";
import { Text } from "@/components/ui/text";
import { Star } from "lucide-react-native";
import { useThemeColors } from "@/theme";
import { useSettingsStore } from "@/store/settingsStore";
import { usePoiStore } from "@/store/poiStore";
import { POI_ICON_MAP } from "@/constants/poiIcons";
import { getCategoryMeta, ohStatusColorKey } from "@/constants/poiHelpers";
import { formatDistance, formatDuration, formatETA } from "@/utils/formatters";
import { getOpeningHoursStatus } from "@/services/openingHoursParser";
import { useEtaStore } from "@/store/etaStore";
import type { DisplayPOI } from "@/types";

interface POIListItemProps {
  poi: DisplayPOI;
  currentDistAlongRoute: number | null;
  onPress: (poi: DisplayPOI) => void;
}

function POIListItem({ poi, currentDistAlongRoute, onPress }: POIListItemProps) {
  const colors = useThemeColors();
  const units = useSettingsStore((s) => s.units);

  const catMeta = getCategoryMeta(poi.category);
  const IconComp = catMeta ? POI_ICON_MAP[catMeta.iconName] : null;

  const isStarred = usePoiStore((s) => s.starredPOIIds.has(poi.id));
  const getETAToPOI = useEtaStore((s) => s.getETAToPOI);

  const distAhead =
    currentDistAlongRoute != null ? poi.effectiveDistanceMeters - currentDistAlongRoute : null;

  const etaResult = getETAToPOI(poi);

  const ohStatus = useMemo(() => {
    const tag = poi.tags?.opening_hours;
    return tag ? getOpeningHoursStatus(tag) : null;
  }, [poi.tags?.opening_hours]);

  const ohColor = useMemo(() => {
    const key = ohStatusColorKey(ohStatus);
    return key ? colors[key] : undefined;
  }, [ohStatus, colors]);

  const distanceLabel =
    distAhead != null
      ? distAhead >= 0
        ? `${formatDistance(distAhead, units)} ahead`
        : `${formatDistance(Math.abs(distAhead), units)} behind`
      : null;
  const etaLabel =
    etaResult && etaResult.ridingTimeSeconds > 0
      ? `${formatDuration(etaResult.ridingTimeSeconds)}, ETA ${formatETA(etaResult.eta)}`
      : null;
  const offRouteLabel =
    poi.distanceFromRouteMeters > 50
      ? `${Math.round(poi.distanceFromRouteMeters)} meters off route`
      : "on route";
  const accessibilityLabel = [
    poi.name ?? catMeta?.label ?? "POI",
    distanceLabel,
    etaLabel,
    ohStatus?.label,
    offRouteLabel,
    isStarred ? "starred" : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <TouchableOpacity
      className="flex-row items-center px-4 py-3.5 border-b border-border"
      onPress={() => onPress(poi)}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <View
        className="w-[40px] h-[40px] rounded-full items-center justify-center"
        style={{ backgroundColor: (catMeta?.color ?? colors.textTertiary) + "1A" }}
      >
        {IconComp && <IconComp size={20} color={catMeta?.color ?? colors.textPrimary} />}
      </View>

      <View className="flex-1 ml-3">
        <View className="flex-row items-baseline">
          {distAhead != null && (
            <Text className="text-[18px] font-barlow-sc-semibold text-foreground">
              {distAhead >= 0
                ? formatDistance(distAhead, units)
                : `-${formatDistance(Math.abs(distAhead), units)}`}
            </Text>
          )}
          {etaResult && etaResult.ridingTimeSeconds > 0 ? (
            <Text className="ml-2 text-[15px] font-barlow-sc-semibold text-foreground">
              ~{formatDuration(etaResult.ridingTimeSeconds)}
            </Text>
          ) : distAhead != null ? (
            <Text className="ml-2 text-[14px] font-barlow-medium text-muted-foreground">
              {distAhead >= 0 ? "ahead" : "behind"}
            </Text>
          ) : null}
        </View>
        <View className="flex-row items-center">
          {isStarred && (
            <Star
              size={12}
              color={colors.warning}
              fill={colors.warning}
              style={{ marginRight: 4 }}
            />
          )}
          <Text
            className="text-[14px] font-barlow-medium text-foreground flex-shrink"
            numberOfLines={1}
          >
            {poi.name ?? catMeta?.label ?? "Unnamed"}
          </Text>
        </View>
        <View className="flex-row items-center mt-1">
          {ohStatus && (
            <View className="flex-row items-center">
              <View className="w-[6px] h-[6px] rounded-full" style={{ backgroundColor: ohColor }} />
              <Text className="ml-1 text-[14px] font-barlow-medium" style={{ color: ohColor }}>
                {ohStatus.label}
                {ohStatus.detail ? ` · ${ohStatus.detail}` : ""}
              </Text>
            </View>
          )}
          {ohStatus && poi.distanceFromRouteMeters > 50 && (
            <Text className="text-[14px] text-muted-foreground font-barlow ml-2">
              {Math.round(poi.distanceFromRouteMeters)} m off
            </Text>
          )}
          {!ohStatus && poi.distanceFromRouteMeters > 50 && (
            <Text className="text-[14px] text-muted-foreground font-barlow">
              {Math.round(poi.distanceFromRouteMeters)} m off route
            </Text>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

export default React.memo(POIListItem);
