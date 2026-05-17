import React, { useMemo } from "react";
import { View, TouchableOpacity } from "react-native";
import { Text } from "@/components/ui/text";
import { useSettingsStore } from "@/store/settingsStore";
import { useEtaStore } from "@/store/etaStore";
import { useThemeColors } from "@/theme";
import { climbDifficultyColor } from "@/constants/climbHelpers";
import { formatDistance, formatElevation, formatDuration, formatETA } from "@/utils/formatters";
import { getClimbProgress } from "@/utils/climbProgress";
import type { DisplayClimb } from "@/types";

interface ClimbListItemProps {
  climb: DisplayClimb;
  currentDistAlongRoute: number | null;
  onPress: (climb: DisplayClimb) => void;
  isSelected?: boolean;
  height?: number;
}

function ClimbListItem({
  climb,
  currentDistAlongRoute,
  onPress,
  isSelected = false,
  height,
}: ClimbListItemProps) {
  const units = useSettingsStore((s) => s.units);
  const getETAToDistance = useEtaStore((s) => s.getETAToDistance);
  const colors = useThemeColors();

  const diffColor = climbDifficultyColor(climb.difficultyScore);
  const progress = useMemo(
    () => getClimbProgress(climb, currentDistAlongRoute),
    [climb, currentDistAlongRoute],
  );
  const targetDistanceMeters =
    progress.state === "active"
      ? climb.effectiveEndDistanceMeters
      : climb.effectiveStartDistanceMeters;
  const isPast = progress.state === "past";
  const distanceValueMeters =
    progress.state === "unknown"
      ? null
      : progress.state === "active"
        ? progress.distanceToTopMeters
        : progress.state === "past"
          ? progress.distancePastTopMeters
          : progress.distanceToStartMeters;
  const distanceContext =
    progress.state === "active"
      ? "to top"
      : progress.state === "past"
        ? "past"
        : progress.state === "upcoming"
          ? "ahead"
          : null;

  const etaResult = useMemo(
    () => (progress.state === "past" ? null : getETAToDistance(targetDistanceMeters)),
    [progress.state, targetDistanceMeters, getETAToDistance],
  );
  const distLabel =
    distanceValueMeters != null && distanceContext
      ? `${formatDistance(distanceValueMeters, units)} ${distanceContext}`
      : null;
  const etaLabel =
    etaResult && etaResult.ridingTimeSeconds > 0
      ? `${formatDuration(etaResult.ridingTimeSeconds)}, ETA ${formatETA(etaResult.eta)}`
      : null;
  const accessibilityLabel = [
    climb.name ?? "Climb",
    distLabel,
    etaLabel,
    `${formatElevation(climb.totalAscentMeters, units)} total gain`,
    `${formatDistance(climb.lengthMeters, units)} long`,
    `${climb.averageGradientPercent}% average grade`,
    `${climb.maxGradientPercent}% max grade`,
    progress.state === "active" ? "on climb" : progress.state,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <TouchableOpacity
      className="flex-row items-center px-3.5 py-1 border-b border-border overflow-hidden"
      style={[
        height != null ? { height } : undefined,
        isSelected ? { backgroundColor: colors.accentSubtle } : undefined,
        isPast ? { opacity: 0.4 } : undefined,
      ]}
      onPress={() => onPress(climb)}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: isSelected }}
    >
      <View
        className="w-[4px] self-stretch rounded-full mr-2.5"
        style={{ backgroundColor: diffColor }}
      />

      <View className="flex-1">
        <View className="flex-row items-baseline">
          {distanceValueMeters != null && (
            <Text className="text-[16px] leading-[18px] font-barlow-sc-semibold text-foreground">
              {formatDistance(distanceValueMeters, units)}
            </Text>
          )}
          {etaResult && etaResult.ridingTimeSeconds > 0 ? (
            <Text className="ml-2 text-[13px] leading-[18px] font-barlow-sc-semibold text-foreground">
              ~{formatDuration(etaResult.ridingTimeSeconds)}
            </Text>
          ) : null}
          {distanceContext && (
            <Text className="ml-2 text-[12px] leading-[18px] text-muted-foreground font-barlow">
              {distanceContext}
            </Text>
          )}
        </View>
        {climb.name && (
          <Text
            className="text-[12px] leading-[14px] font-barlow-medium text-foreground"
            numberOfLines={1}
          >
            {climb.name}
          </Text>
        )}
        <Text className="text-[13px] leading-[15px] font-barlow-sc-semibold text-foreground">
          {formatElevation(climb.totalAscentMeters, units)} ↑{"  ·  "}
          {formatDistance(climb.lengthMeters, units)}
          {"  ·  "}
          {climb.averageGradientPercent}% avg
        </Text>
        <Text className="text-[10px] leading-[13px] text-muted-foreground font-barlow">
          max {climb.maxGradientPercent}%{"  ·  "}
          difficulty: {Math.round(climb.difficultyScore)}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

export default React.memo(ClimbListItem, (prev, next) => {
  return (
    prev.climb === next.climb &&
    prev.currentDistAlongRoute === next.currentDistAlongRoute &&
    prev.onPress === next.onPress &&
    prev.isSelected === next.isSelected &&
    prev.height === next.height
  );
});
