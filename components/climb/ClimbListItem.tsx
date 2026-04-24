import React, { useMemo } from "react";
import { View, TouchableOpacity } from "react-native";
import { Text } from "@/components/ui/text";
import { useSettingsStore } from "@/store/settingsStore";
import { useEtaStore } from "@/store/etaStore";
import { climbDifficultyColor } from "@/constants/climbHelpers";
import { formatDistance, formatElevation, formatDuration, formatETA } from "@/utils/formatters";
import type { DisplayClimb } from "@/types";

interface ClimbListItemProps {
  climb: DisplayClimb;
  currentDistAlongRoute: number | null;
  isPast: boolean;
  onPress: (climb: DisplayClimb) => void;
}

export default function ClimbListItem({
  climb,
  currentDistAlongRoute,
  isPast,
  onPress,
}: ClimbListItemProps) {
  const units = useSettingsStore((s) => s.units);
  const getETAToDistance = useEtaStore((s) => s.getETAToDistance);

  const diffColor = climbDifficultyColor(climb.difficultyScore);

  const distAhead =
    currentDistAlongRoute != null ? climb.effectiveDistanceMeters - currentDistAlongRoute : null;

  const etaResult = useMemo(
    () => getETAToDistance(climb.effectiveDistanceMeters),
    [climb.effectiveDistanceMeters, getETAToDistance],
  );

  return (
    <TouchableOpacity
      className="flex-row items-center px-4 py-3 border-b border-border"
      style={isPast ? { opacity: 0.4 } : undefined}
      onPress={() => onPress(climb)}
      accessibilityLabel={climb.name ?? `Climb ${formatElevation(climb.totalAscentMeters, units)}`}
    >
      <View
        className="w-[4px] self-stretch rounded-full mr-3"
        style={{ backgroundColor: diffColor }}
      />

      <View className="flex-1">
        {climb.name && (
          <Text className="text-[15px] font-barlow-medium text-foreground mb-0.5" numberOfLines={1}>
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
          max {climb.maxGradientPercent}%{"  ·  "}
          difficulty: {Math.round(climb.difficultyScore)}
        </Text>
      </View>

      <View className="items-end ml-2">
        {distAhead != null && (
          <Text className="text-[15px] font-barlow-sc-semibold text-foreground">
            {distAhead >= 0
              ? formatDistance(distAhead, units)
              : `-${formatDistance(Math.abs(distAhead), units)}`}
          </Text>
        )}
        {etaResult && etaResult.ridingTimeSeconds > 0 ? (
          <Text className="text-[11px] text-muted-foreground font-barlow-sc-medium">
            ~{formatDuration(etaResult.ridingTimeSeconds)} · {formatETA(etaResult.eta)}
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
