import React, { useMemo, useState } from "react";
import { View, TouchableOpacity, TextInput as RNTextInput, useWindowDimensions, ScrollView } from "react-native";
import { Text } from "@/components/ui/text";
import { Mountain, Pencil, Check } from "lucide-react-native";
import { useThemeColors } from "@/theme";
import { useSettingsStore } from "@/store/settingsStore";
import { useRouteStore } from "@/store/routeStore";
import { useClimbStore } from "@/store/climbStore";
import { useEtaStore } from "@/store/etaStore";
import { useActiveRouteData } from "@/hooks/useActiveRouteData";
import { climbDifficultyColor, getClimbDifficulty, CLIMB_DIFFICULTY_LABELS } from "@/constants/climbHelpers";
import { extractRouteSlice } from "@/utils/geo";
import { formatDistance, formatElevation, formatDuration, formatETA } from "@/utils/formatters";
import ElevationProfile from "@/components/elevation/ElevationProfile";
import type { Climb, StitchedSegmentInfo } from "@/types";

interface ClimbBottomSheetProps {
  routeIds: string[];
  segments: StitchedSegmentInfo[] | null;
}

export default function ClimbBottomSheet({ routeIds, segments }: ClimbBottomSheetProps) {
  const colors = useThemeColors();
  const units = useSettingsStore((s) => s.units);
  const { width: screenWidth } = useWindowDimensions();
  const snappedPosition = useRouteStore((s) => s.snappedPosition);
  const getClimbsForDisplay = useClimbStore((s) => s.getClimbsForDisplay);
  const allClimbs = useClimbStore((s) => s.climbs);
  const selectedClimb = useClimbStore((s) => s.selectedClimb);
  const setSelectedClimb = useClimbStore((s) => s.setSelectedClimb);
  const renameClimb = useClimbStore((s) => s.renameClimb);
  const setShowClimbList = useClimbStore((s) => s.setShowClimbList);
  const getETAToDistance = useEtaStore((s) => s.getETAToDistance);
  const activeData = useActiveRouteData();

  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState("");
  // Track the climb being edited to keep it visible during rename
  const [editingClimb, setEditingClimb] = useState<Climb | null>(null);

  const currentDist = snappedPosition?.distanceAlongRouteMeters ?? null;

  const displayedClimbs = useMemo(
    () => getClimbsForDisplay(routeIds, segments),
    [routeIds, segments, allClimbs, getClimbsForDisplay],
  );

  // Manual selection (from climb list) overrides auto-select
  // Auto-select: current climb (if on one) or next upcoming
  const climb = useMemo(() => {
    if (editingClimb) return editingClimb;
    if (selectedClimb) return selectedClimb;
    if (displayedClimbs.length === 0) return null;
    if (currentDist == null) return displayedClimbs[0];

    const current = displayedClimbs.find(
      (c) => currentDist >= c.startDistanceMeters && currentDist <= c.endDistanceMeters,
    );
    if (current) return current;

    const next = displayedClimbs.find((c) => c.startDistanceMeters > currentDist);
    if (next) return next;

    return displayedClimbs[displayedClimbs.length - 1];
  }, [displayedClimbs, currentDist, editingClimb, selectedClimb]);

  const difficulty = climb ? getClimbDifficulty(climb.difficultyScore) : "low";
  const diffColor = climb ? climbDifficultyColor(climb.difficultyScore) : colors.textTertiary;

  const distToStart = useMemo(() => {
    if (!climb || currentDist == null) return null;
    return climb.startDistanceMeters - currentDist;
  }, [climb, currentDist]);

  const etaResult = useMemo(
    () => climb ? getETAToDistance(climb.startDistanceMeters) : null,
    [climb, getETAToDistance],
  );

  const climbProfile = useMemo(() => {
    if (!climb || !activeData?.points?.length) return null;
    const points = activeData.points;
    const climbStart = climb.startDistanceMeters;
    const climbEnd = climb.endDistanceMeters;

    let startIdx = 0;
    for (let i = 0; i < points.length; i++) {
      if (points[i].distanceFromStartMeters >= climbStart) {
        startIdx = Math.max(0, i - 1);
        break;
      }
    }

    const sliceLength = climbEnd - points[startIdx].distanceFromStartMeters;
    if (sliceLength <= 0) return null;

    const sliced = extractRouteSlice(points, startIdx, sliceLength);
    if (sliced.length < 2) return null;

    return {
      points: sliced,
      offsetMeters: points[startIdx].distanceFromStartMeters,
    };
  }, [climb, activeData]);

  const handleStartEdit = () => {
    if (!climb) return;
    setEditingClimb(climb);
    setEditName(climb.name ?? "");
    setIsEditing(true);
  };

  const handleSaveName = () => {
    if (editingClimb) {
      const trimmed = editName.trim() || null;
      renameClimb(editingClimb.id, editingClimb.routeId, trimmed);
    }
    setIsEditing(false);
    setEditingClimb(null);
  };

  if (!climb) {
    return (
      <View
        className="absolute bottom-0 left-0 right-0 rounded-t-2xl shadow-lg overflow-hidden z-20 items-center justify-center py-8"
        style={{ backgroundColor: colors.surface }}
      >
        <Text className="text-[15px] text-muted-foreground">No climbs on this route</Text>
      </View>
    );
  }

  return (
    <View
      className="absolute bottom-0 left-0 right-0 rounded-t-2xl shadow-lg overflow-hidden z-20"
      style={{ backgroundColor: colors.surface }}
    >
      <ScrollView>
        {/* Header */}
        <View className="px-4 pt-3 pb-1">
          <View className="flex-row items-center justify-between">
            <View className="flex-1 mr-2">
              {isEditing ? (
                <View className="flex-row items-center">
                  <RNTextInput
                    className="flex-1 text-[18px] font-barlow-semibold text-foreground border-b border-accent pb-1"
                    value={editName}
                    onChangeText={setEditName}
                    placeholder="Climb name"
                    placeholderTextColor={colors.textTertiary}
                    autoFocus
                    returnKeyType="done"
                    onSubmitEditing={handleSaveName}
                  />
                  <TouchableOpacity
                    className="w-[44px] h-[44px] items-center justify-center"
                    onPress={handleSaveName}
                    accessibilityLabel="Save name"
                  >
                    <Check size={20} color={colors.accent} />
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity
                  className="flex-row items-center"
                  onPress={handleStartEdit}
                  accessibilityLabel="Edit climb name"
                >
                  <Text
                    className="text-[18px] font-barlow-semibold text-foreground flex-shrink"
                    numberOfLines={1}
                  >
                    {climb.name ?? "Unnamed climb"}
                  </Text>
                  <Pencil size={12} color={colors.textTertiary} style={{ marginLeft: 6 }} />
                </TouchableOpacity>
              )}
            </View>

          </View>

          {/* Difficulty + All climbs link */}
          <View className="flex-row items-center justify-between mt-1">
            <View className="flex-row items-center">
              <Mountain size={13} color={diffColor} />
              <Text
                className="ml-1 text-[12px] font-barlow-medium"
                style={{ color: diffColor }}
              >
                {CLIMB_DIFFICULTY_LABELS[difficulty]} · {Math.round(climb.difficultyScore)}
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => setShowClimbList(true)}
              accessibilityLabel="Show all climbs"
            >
              <Text className="text-[12px] font-barlow-medium" style={{ color: colors.accent }}>
                All climbs ({displayedClimbs.length})
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Elevation profile */}
        {climbProfile && (
          <View className="mx-4 mt-1 rounded-lg overflow-hidden">
            <ElevationProfile
              points={climbProfile.points}
              units={units}
              width={screenWidth - 32}
              height={90}
              showLegend={false}
              distanceOffsetMeters={climbProfile.offsetMeters}
            />
          </View>
        )}

        {/* Stats row */}
        <View className="flex-row px-4 mt-2">
          <StatItem label="Gain" value={`${formatElevation(climb.totalAscentMeters, units)} ↑`} />
          <StatItem label="Length" value={formatDistance(climb.lengthMeters, units)} />
          <StatItem label="Avg" value={`${climb.averageGradientPercent}%`} />
          <StatItem label="Max" value={`${climb.maxGradientPercent}%`} />
        </View>

        {/* Distance + ETA */}
        <View className="flex-row items-center px-4 mt-2 pb-3">
          {distToStart != null && (
            <Text className="text-[13px] font-barlow-sc-semibold text-foreground">
              {distToStart >= 0
                ? `${formatDistance(distToStart, units)} ahead`
                : distToStart > -climb.lengthMeters
                  ? "On this climb"
                  : `${formatDistance(Math.abs(distToStart), units)} behind`}
            </Text>
          )}
          {etaResult && etaResult.ridingTimeSeconds > 0 && distToStart != null && distToStart > 0 && (
            <Text className="ml-3 text-[13px] font-barlow-sc-medium text-muted-foreground">
              ~{formatDuration(etaResult.ridingTimeSeconds)} · ETA {formatETA(etaResult.eta)}
            </Text>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function StatItem({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-1">
      <Text className="text-[10px] text-muted-foreground font-barlow">{label}</Text>
      <Text className="text-[15px] font-barlow-sc-semibold text-foreground">{value}</Text>
    </View>
  );
}
