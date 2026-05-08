import React, { useMemo } from "react";
import { View, TouchableOpacity } from "react-native";
import { Text } from "@/components/ui/text";
import { useSettingsStore } from "@/store/settingsStore";
import { useEtaStore } from "@/store/etaStore";
import { climbDifficultyColor } from "@/constants/climbHelpers";
import { formatDistance, formatElevation, formatDuration, formatETA } from "@/utils/formatters";
import { getClimbProgress } from "@/utils/climbProgress";
import type { DisplayClimb } from "@/types";

interface ClimbListItemProps {
  climb: DisplayClimb;
  currentDistAlongRoute: number | null;
  onPress: (climb: DisplayClimb) => void;
}

function ClimbListItem({ climb, currentDistAlongRoute, onPress }: ClimbListItemProps) {
  const units = useSettingsStore((s) => s.units);
  const getETAToDistance = useEtaStore((s) => s.getETAToDistance);

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
  const progressLabel =
    progress.state === "active" ? `${Math.round(progress.progressRatio * 100)}% done` : null;
  const accessibilityLabel = [
    climb.name ?? "Climb",
    distLabel,
    etaLabel,
    `${formatElevation(climb.totalAscentMeters, units)} gain`,
    `${formatDistance(climb.lengthMeters, units)} long`,
    `${climb.averageGradientPercent}% average grade`,
    `${climb.maxGradientPercent}% max grade`,
    progress.state === "active" ? "on climb" : progress.state,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <TouchableOpacity
      className="flex-row items-center px-4 py-3.5 border-b border-border"
      style={isPast ? { opacity: 0.4 } : undefined}
      onPress={() => onPress(climb)}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <View
        className="w-[4px] self-stretch rounded-full mr-3"
        style={{ backgroundColor: diffColor }}
      />

      <View className="flex-1">
        <View className="flex-row items-baseline">
          {distanceValueMeters != null && (
            <Text className="text-[18px] font-barlow-sc-semibold text-foreground">
              {formatDistance(distanceValueMeters, units)}
            </Text>
          )}
          {etaResult && etaResult.ridingTimeSeconds > 0 ? (
            <Text className="ml-2 text-[15px] font-barlow-sc-semibold text-foreground">
              ~{formatDuration(etaResult.ridingTimeSeconds)}
            </Text>
          ) : null}
          {distanceContext && (
            <Text className="ml-2 text-[14px] text-muted-foreground font-barlow">
              {distanceContext}
            </Text>
          )}
        </View>
        {climb.name && (
          <Text className="text-[14px] font-barlow-medium text-foreground mb-0.5" numberOfLines={1}>
            {climb.name}
          </Text>
        )}
        <Text className="text-[14px] font-barlow-sc-semibold text-foreground">
          {formatElevation(climb.totalAscentMeters, units)} ↑{"  ·  "}
          {formatDistance(climb.lengthMeters, units)}
          {"  ·  "}
          {climb.averageGradientPercent}% avg
        </Text>
        <Text className="text-[12px] text-muted-foreground font-barlow mt-0.5">
          {progressLabel ? `${progressLabel} · ` : ""}
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
    prev.onPress === next.onPress
  );
});
