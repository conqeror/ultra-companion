import React, { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import {
  routePlannerAlternativeLabel,
  routePlannerCandidateColor,
  routePlannerProfileKey,
} from "@/services/routePlannerComparison";
import { useThemeColors } from "@/theme";
import type { RoutePlannerCandidate, UnitSystem } from "@/types";
import { formatDistance, formatElevation } from "@/utils/formatters";
import RouteCandidateElevationChart, {
  getPlannerElevationDomain,
} from "./RouteCandidateElevationChart";

const CARD_WIDTH = 220;

export default function RouteComparisonPanel({
  candidates,
  selectedCandidateId,
  profileErrors,
  alternativeErrors,
  alternativeLoadingProfileIds,
  loadedAlternativeProfileIds,
  units,
  onSelect,
  onLoadAlternatives,
  onRetryFailedProfiles,
}: {
  candidates: readonly RoutePlannerCandidate[];
  selectedCandidateId: string | null;
  profileErrors: Readonly<Record<string, string>>;
  alternativeErrors: Readonly<Record<string, string>>;
  alternativeLoadingProfileIds: readonly (string | null)[];
  loadedAlternativeProfileIds: readonly (string | null)[];
  units: UnitSystem;
  onSelect: (candidateId: string) => void;
  onLoadAlternatives: (profileId: string | null) => void;
  onRetryFailedProfiles: () => void;
}) {
  const colors = useThemeColors();
  const [panelWidth, setPanelWidth] = useState(0);
  const domain = useMemo(() => getPlannerElevationDomain(candidates), [candidates]);
  const selected =
    candidates.find((candidate) => candidate.id === selectedCandidateId) ?? candidates[0];
  const errors = [
    ...Object.entries(profileErrors).map(([key, message]) => [`profile-${key}`, message] as const),
    ...Object.entries(alternativeErrors).map(
      ([key, message]) => [`alternative-${key}`, message] as const,
    ),
  ].filter((entry) => Boolean(entry[1]));

  if (!selected) return null;

  return (
    <View className="gap-2" onLayout={(event) => setPanelWidth(event.nativeEvent.layout.width)}>
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1">
          <Text numberOfLines={1} className="text-[17px] font-barlow-semibold text-foreground">
            {selected.profileName} · {routePlannerAlternativeLabel(selected.alternativeIndex)}
          </Text>
          <Text className="text-[18px] font-barlow-sc-semibold text-foreground">
            {formatDistance(selected.route.totalDistanceMeters, units)} · ↑{" "}
            {formatElevation(selected.route.totalAscentMeters, units)} · ↓{" "}
            {formatElevation(selected.route.totalDescentMeters, units)}
          </Text>
        </View>
        <View
          className="mt-1 h-4 w-4 rounded-full"
          style={{ backgroundColor: routePlannerCandidateColor(selected.id) }}
          accessibilityLabel="Selected route color"
        />
      </View>

      {panelWidth > 0 && (
        <RouteCandidateElevationChart
          points={selected.route.points}
          domain={domain}
          color={routePlannerCandidateColor(selected.id)}
          width={panelWidth}
          height={72}
        />
      )}
      <Text className="text-[11px] text-muted-foreground">
        Shared elevation and distance scales · longest route{" "}
        {formatDistance(domain.maxDistanceMeters, units)}
      </Text>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8 }}
        accessibilityLabel="Route candidates"
      >
        {candidates.map((candidate) => {
          const isSelected = candidate.id === selected.id;
          const color = routePlannerCandidateColor(candidate.id);
          const profileKey = routePlannerProfileKey(candidate.profileId);
          const isLoadingAlternatives = alternativeLoadingProfileIds.includes(candidate.profileId);
          const alternativesLoaded = loadedAlternativeProfileIds.includes(candidate.profileId);
          const alternativeError = alternativeErrors[profileKey];
          return (
            <View
              key={candidate.id}
              className="rounded-xl border bg-card p-2"
              style={{
                width: CARD_WIDTH,
                borderColor: isSelected ? color : colors.border,
                borderWidth: isSelected ? 2 : 1,
              }}
            >
              <Pressable
                className="min-h-[92px]"
                accessibilityRole="radio"
                accessibilityState={{ checked: isSelected }}
                accessibilityLabel={`${candidate.profileName}, ${routePlannerAlternativeLabel(candidate.alternativeIndex)}, ${formatDistance(candidate.route.totalDistanceMeters, units)}, ${formatElevation(candidate.route.totalAscentMeters, units)} ascent, ${formatElevation(candidate.route.totalDescentMeters, units)} descent`}
                onPress={() => onSelect(candidate.id)}
              >
                <View className="flex-row items-center gap-2">
                  <View className="h-3 w-3 rounded-full" style={{ backgroundColor: color }} />
                  <Text
                    numberOfLines={1}
                    className="flex-1 text-[14px] font-barlow-semibold text-foreground"
                  >
                    {candidate.profileName}
                  </Text>
                </View>
                <Text className="text-[12px] text-muted-foreground">
                  {routePlannerAlternativeLabel(candidate.alternativeIndex)}
                </Text>
                <Text className="text-[14px] font-barlow-sc-medium text-foreground">
                  {formatDistance(candidate.route.totalDistanceMeters, units)} · ↑{" "}
                  {formatElevation(candidate.route.totalAscentMeters, units)} · ↓{" "}
                  {formatElevation(candidate.route.totalDescentMeters, units)}
                </Text>
                <RouteCandidateElevationChart
                  points={candidate.route.points}
                  domain={domain}
                  color={color}
                  width={CARD_WIDTH - 20}
                  height={42}
                />
              </Pressable>
              {candidate.alternativeIndex === 0 && (
                <Button
                  size="sm"
                  variant="secondary"
                  className="mt-1 h-[44px] px-2"
                  disabled={isLoadingAlternatives || (alternativesLoaded && !alternativeError)}
                  accessibilityRole="button"
                  accessibilityLabel={
                    isLoadingAlternatives
                      ? `Loading alternatives for ${candidate.profileName}`
                      : alternativeError
                        ? `Retry alternatives for ${candidate.profileName}`
                        : alternativesLoaded
                          ? `Alternatives checked for ${candidate.profileName}`
                          : `Load alternatives for ${candidate.profileName}`
                  }
                  onPress={() => onLoadAlternatives(candidate.profileId)}
                >
                  {isLoadingAlternatives ? (
                    <View className="flex-row items-center gap-2">
                      <ActivityIndicator size="small" color={colors.accent} />
                      <Text className="text-[13px] font-barlow-semibold text-primary">
                        Loading alternatives…
                      </Text>
                    </View>
                  ) : (
                    <Text className="text-[13px] font-barlow-semibold text-primary">
                      {alternativeError
                        ? "Retry alternatives"
                        : alternativesLoaded
                          ? "Alternatives checked"
                          : "Show alternatives"}
                    </Text>
                  )}
                </Button>
              )}
            </View>
          );
        })}
      </ScrollView>
      {errors.slice(0, 2).map(([key, message]) => (
        <Text key={key} accessibilityRole="alert" className="text-[13px] text-destructive">
          {message}
        </Text>
      ))}
      {Object.values(profileErrors).some(Boolean) && (
        <Button
          variant="secondary"
          label="Retry failed profiles"
          accessibilityRole="button"
          onPress={onRetryFailedProfiles}
        />
      )}
    </View>
  );
}
