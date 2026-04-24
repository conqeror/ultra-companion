import React, { useMemo, useState, useCallback, useEffect } from "react";
import {
  View,
  TouchableOpacity,
  TextInput as RNTextInput,
  useWindowDimensions,
  FlatList,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "@/components/ui/text";
import { Mountain, Pencil, Check } from "lucide-react-native";
import { useThemeColors } from "@/theme";
import { useSettingsStore } from "@/store/settingsStore";
import { useRouteStore } from "@/store/routeStore";
import { useClimbStore } from "@/store/climbStore";
import { usePanelStore } from "@/store/panelStore";
import {
  climbDifficultyColor,
  getClimbDifficulty,
  CLIMB_DIFFICULTY_LABELS,
} from "@/constants/climbHelpers";
import { extractRouteSlice } from "@/utils/geo";
import { formatDistance, formatElevation } from "@/utils/formatters";
import ElevationProfile from "@/components/elevation/ElevationProfile";
import ClimbListItem from "@/components/climb/ClimbListItem";
import { resolveActiveClimb } from "@/utils/climbSelect";
import type { ActiveRouteData, DisplayClimb } from "@/types";

interface ClimbTabContentProps {
  activeData: ActiveRouteData | null;
}

export default function ClimbTabContent({ activeData }: ClimbTabContentProps) {
  const colors = useThemeColors();
  const { bottom: safeBottom } = useSafeAreaInsets();
  const units = useSettingsStore((s) => s.units);
  const { width: screenWidth } = useWindowDimensions();
  const snappedPosition = useRouteStore((s) => s.snappedPosition);
  const getClimbsForDisplay = useClimbStore((s) => s.getClimbsForDisplay);
  const allClimbs = useClimbStore((s) => s.climbs);
  const selectedClimb = useClimbStore((s) => s.selectedClimb);
  const setSelectedClimb = useClimbStore((s) => s.setSelectedClimb);
  const renameClimb = useClimbStore((s) => s.renameClimb);
  const isExpanded = usePanelStore((s) => s.isExpanded);
  // Reset to current/upcoming climb when tab mounts
  useEffect(() => {
    setSelectedClimb(null);
  }, [setSelectedClimb]);

  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editingClimb, setEditingClimb] = useState<DisplayClimb | null>(null);
  const [graphHeight, setGraphHeight] = useState(0);

  const routeIds = useMemo(() => activeData?.routeIds ?? [], [activeData?.routeIds]);
  const segments = activeData?.segments ?? null;
  const currentDist = snappedPosition?.distanceAlongRouteMeters ?? null;

  const displayedClimbs = useMemo(
    () => getClimbsForDisplay(routeIds, segments),
    // allClimbs is a reactivity trigger: getClimbsForDisplay reads store via get() and is not itself reactive
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [routeIds, segments, allClimbs, getClimbsForDisplay],
  );

  const climb = useMemo(() => {
    if (editingClimb) return editingClimb;
    return resolveActiveClimb(displayedClimbs, currentDist, selectedClimb);
  }, [displayedClimbs, currentDist, editingClimb, selectedClimb]);

  const difficulty = climb ? getClimbDifficulty(climb.difficultyScore) : "low";
  const diffColor = climb ? climbDifficultyColor(climb.difficultyScore) : colors.textTertiary;

  const distToStart = useMemo(() => {
    if (!climb || currentDist == null) return null;
    return climb.effectiveDistanceMeters - currentDist;
  }, [climb, currentDist]);

  const climbProfile = useMemo(() => {
    if (!climb || !activeData?.points?.length) return null;
    const points = activeData.points;
    let startIdx = 0;
    for (let i = 0; i < points.length; i++) {
      if (points[i].distanceFromStartMeters >= climb.effectiveStartDistanceMeters) {
        startIdx = Math.max(0, i - 1);
        break;
      }
    }
    const sliceLength = climb.effectiveEndDistanceMeters - points[startIdx].distanceFromStartMeters;
    if (sliceLength <= 0) return null;
    const sliced = extractRouteSlice(points, startIdx, sliceLength);
    if (sliced.length < 2) return null;
    let currentIdxInSlice: number | undefined;
    if (snappedPosition) {
      const idx = snappedPosition.pointIndex - startIdx;
      if (idx >= 0 && idx < sliced.length) currentIdxInSlice = idx;
    }
    return {
      points: sliced,
      offsetMeters: points[startIdx].distanceFromStartMeters,
      currentIdxInSlice,
    };
  }, [climb, activeData, snappedPosition]);

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

  // Sorted climbs for the expanded list
  const sortedClimbs = useMemo(
    () =>
      isExpanded
        ? [...displayedClimbs].sort(
            (a, b) => a.effectiveStartDistanceMeters - b.effectiveStartDistanceMeters,
          )
        : [],
    [isExpanded, displayedClimbs],
  );

  const handleClimbPress = useCallback(
    (c: DisplayClimb) => {
      setSelectedClimb(c);
    },
    [setSelectedClimb],
  );

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
      {/* Header: name + difficulty */}
      <View className="flex-row items-center px-3 pt-1">
        <View className="flex-1">
          {isExpanded && isEditing ? (
            <View className="flex-row items-center">
              <RNTextInput
                className="flex-1 text-[15px] font-barlow-semibold text-foreground border-b border-accent"
                value={editName}
                onChangeText={setEditName}
                placeholder="Climb name"
                placeholderTextColor={colors.textTertiary}
                // eslint-disable-next-line jsx-a11y/no-autofocus -- intentional: focus input when user taps edit
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
          ) : isExpanded ? (
            <TouchableOpacity
              className="flex-row items-center"
              hitSlop={8}
              onPress={handleStartEdit}
              accessibilityLabel="Edit climb name"
            >
              <Text
                className="text-[15px] font-barlow-semibold text-foreground flex-shrink"
                numberOfLines={1}
              >
                {climb.name ?? "Unnamed climb"}
              </Text>
              <Pencil size={10} color={colors.textTertiary} style={{ marginLeft: 4 }} />
            </TouchableOpacity>
          ) : (
            <Text className="text-[15px] font-barlow-semibold text-foreground" numberOfLines={1}>
              {climb.name ?? "Unnamed climb"}
            </Text>
          )}
          <View className="flex-row items-center">
            <Mountain size={11} color={diffColor} />
            <Text className="ml-1 text-[11px] font-barlow-medium" style={{ color: diffColor }}>
              {CLIMB_DIFFICULTY_LABELS[difficulty]} · {Math.round(climb.difficultyScore)}
            </Text>
          </View>
        </View>
      </View>

      {/* Elevation profile */}
      {climbProfile && (
        <View
          className="flex-1 mx-3 rounded-lg overflow-hidden"
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
              currentPointIndex={climbProfile.currentIdxInSlice}
            />
          )}
        </View>
      )}

      {/* Stats row */}
      <View
        className="flex-row items-center px-3 mt-1"
        style={!isExpanded ? { paddingBottom: safeBottom } : undefined}
      >
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

      {/* Expanded: scrollable climb list */}
      {isExpanded && (
        <View className="flex-1 border-t border-border mt-1">
          <FlatList
            data={sortedClimbs}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <ClimbListItem
                climb={item}
                currentDistAlongRoute={currentDist}
                isPast={currentDist != null && item.effectiveEndDistanceMeters < currentDist}
                onPress={handleClimbPress}
              />
            )}
            contentContainerStyle={{ paddingBottom: safeBottom }}
          />
        </View>
      )}
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
