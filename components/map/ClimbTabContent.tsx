import React, { useMemo, useState } from "react";
import { View, TouchableOpacity, TextInput as RNTextInput, useWindowDimensions } from "react-native";
import { Text } from "@/components/ui/text";
import { Mountain, Pencil, Check, ChevronLeft, ChevronRight } from "lucide-react-native";
import { useThemeColors } from "@/theme";
import { useSettingsStore } from "@/store/settingsStore";
import { useRouteStore } from "@/store/routeStore";
import { useClimbStore } from "@/store/climbStore";
import { useEtaStore } from "@/store/etaStore";
import { climbDifficultyColor, getClimbDifficulty, CLIMB_DIFFICULTY_LABELS } from "@/constants/climbHelpers";
import { extractRouteSlice } from "@/utils/geo";
import { formatDistance, formatElevation, formatDuration, formatETA } from "@/utils/formatters";
import ElevationProfile from "@/components/elevation/ElevationProfile";
import { resolveActiveClimb } from "@/utils/climbSelect";
import type { Climb, ActiveRouteData } from "@/types";

interface ClimbTabContentProps {
  activeData: ActiveRouteData | null;
}

export default function ClimbTabContent({ activeData }: ClimbTabContentProps) {
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

  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editingClimb, setEditingClimb] = useState<Climb | null>(null);
  const [graphHeight, setGraphHeight] = useState(0);

  const routeIds = activeData?.routeIds ?? [];
  const segments = activeData?.segments ?? null;
  const currentDist = snappedPosition?.distanceAlongRouteMeters ?? null;

  const displayedClimbs = useMemo(
    () => getClimbsForDisplay(routeIds, segments),
    [routeIds, segments, allClimbs, getClimbsForDisplay],
  );

  const climb = useMemo(() => {
    if (editingClimb) return editingClimb;
    return resolveActiveClimb(displayedClimbs, currentDist, selectedClimb);
  }, [displayedClimbs, currentDist, editingClimb, selectedClimb]);

  // Prev/next navigation
  const climbIdx = climb ? displayedClimbs.findIndex((c) => c.id === climb.id) : -1;
  const canPrev = climbIdx > 0;
  const canNext = climbIdx >= 0 && climbIdx < displayedClimbs.length - 1;
  const handlePrev = () => { if (canPrev) setSelectedClimb(displayedClimbs[climbIdx - 1]); };
  const handleNext = () => { if (canNext) setSelectedClimb(displayedClimbs[climbIdx + 1]); };

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
    let startIdx = 0;
    for (let i = 0; i < points.length; i++) {
      if (points[i].distanceFromStartMeters >= climb.startDistanceMeters) {
        startIdx = Math.max(0, i - 1);
        break;
      }
    }
    const sliceLength = climb.endDistanceMeters - points[startIdx].distanceFromStartMeters;
    if (sliceLength <= 0) return null;
    const sliced = extractRouteSlice(points, startIdx, sliceLength);
    if (sliced.length < 2) return null;
    return { points: sliced, offsetMeters: points[startIdx].distanceFromStartMeters };
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
      setSelectedClimb({ ...editingClimb, name: trimmed });
    }
    setIsEditing(false);
    setEditingClimb(null);
  };

  // Empty state
  if (displayedClimbs.length === 0) {
    return (
      <View className="flex-1 items-center justify-center">
        <Mountain size={24} color={colors.textTertiary} />
        <Text className="text-[13px] text-muted-foreground font-barlow-medium mt-2">
          No climbs on this route
        </Text>
      </View>
    );
  }

  if (!climb) return null;

  return (
    <View className="flex-1">
      {/* Header: < name + difficulty > */}
      <View className="flex-row items-center px-1 pt-1">
        <TouchableOpacity
          className="w-[32px] h-[32px] items-center justify-center"
          hitSlop={12}
          onPress={handlePrev}
          disabled={!canPrev}
          style={{ opacity: canPrev ? 1 : 0.25 }}
          accessibilityLabel="Previous climb"
        >
          <ChevronLeft size={18} color={colors.textSecondary} />
        </TouchableOpacity>

        <View className="flex-1 mx-1">
          {isEditing ? (
            <View className="flex-row items-center">
              <RNTextInput
                className="flex-1 text-[15px] font-barlow-semibold text-foreground border-b border-accent"
                value={editName}
                onChangeText={setEditName}
                placeholder="Climb name"
                placeholderTextColor={colors.textTertiary}
                autoFocus
                autoCorrect={false}
                returnKeyType="done"
                onSubmitEditing={handleSaveName}
              />
              <TouchableOpacity
                className="w-[32px] h-[32px] items-center justify-center"
                hitSlop={8}
                onPress={handleSaveName}
                accessibilityLabel="Save name"
              >
                <Check size={16} color={colors.accent} />
              </TouchableOpacity>
            </View>
          ) : (
            <View className="flex-row items-center justify-between">
              <TouchableOpacity
                className="flex-row items-center flex-1 mr-2"
                hitSlop={8}
                onPress={handleStartEdit}
                accessibilityLabel="Edit climb name"
              >
                <Text className="text-[15px] font-barlow-semibold text-foreground flex-shrink" numberOfLines={1}>
                  {climb.name ?? "Unnamed climb"}
                </Text>
                <Pencil size={10} color={colors.textTertiary} style={{ marginLeft: 4 }} />
              </TouchableOpacity>
              <TouchableOpacity
                hitSlop={8}
                onPress={() => setShowClimbList(true)}
                accessibilityLabel="Show all climbs"
              >
                <Text className="text-[11px] font-barlow-medium" style={{ color: colors.accent }}>
                  All ({displayedClimbs.length})
                </Text>
              </TouchableOpacity>
            </View>
          )}
          <View className="flex-row items-center">
            <Mountain size={11} color={diffColor} />
            <Text className="ml-1 text-[11px] font-barlow-medium" style={{ color: diffColor }}>
              {CLIMB_DIFFICULTY_LABELS[difficulty]} · {Math.round(climb.difficultyScore)}
            </Text>
          </View>
        </View>

        <TouchableOpacity
          className="w-[32px] h-[32px] items-center justify-center"
          hitSlop={12}
          onPress={handleNext}
          disabled={!canNext}
          style={{ opacity: canNext ? 1 : 0.25 }}
          accessibilityLabel="Next climb"
        >
          <ChevronRight size={18} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {/* Elevation profile — fills remaining space */}
      {climbProfile && (
        <View className="flex-1 mx-3 rounded-lg overflow-hidden"
          onLayout={(e) => setGraphHeight(Math.round(e.nativeEvent.layout.height))}
        >
          {graphHeight > 0 && (
            <ElevationProfile
              points={climbProfile.points}
              units={units}
              width={screenWidth - 24}
              height={graphHeight}
              showLegend={false}
              distanceOffsetMeters={climbProfile.offsetMeters}
            />
          )}
        </View>
      )}

      {/* Stats + distance row */}
      <View className="flex-row items-center px-3 mt-1">
        <StatItem label="Gain" value={`${formatElevation(climb.totalAscentMeters, units)} ↑`} />
        <StatItem label="Length" value={formatDistance(climb.lengthMeters, units)} />
        <StatItem label="Avg" value={`${climb.averageGradientPercent}%`} />
        <StatItem label="Max" value={`${climb.maxGradientPercent}%`} />
        {distToStart != null && (
          <View className="flex-1 items-end">
            <Text className="text-[10px] text-muted-foreground font-barlow">Dist</Text>
            <Text className="text-[13px] font-barlow-sc-semibold text-foreground">
              {distToStart >= 0
                ? `${formatDistance(distToStart, units)}`
                : distToStart > -climb.lengthMeters
                  ? "On it"
                  : `${formatDistance(Math.abs(distToStart), units)} ←`}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

function StatItem({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-1">
      <Text className="text-[10px] text-muted-foreground font-barlow">{label}</Text>
      <Text className="text-[13px] font-barlow-sc-semibold text-foreground">{value}</Text>
    </View>
  );
}
