import React, { useMemo, useState, useCallback, useEffect } from "react";
import {
  View,
  TouchableOpacity,
  TextInput as RNTextInput,
  useWindowDimensions,
  FlatList,
  ScrollView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "@/components/ui/text";
import { Mountain, Pencil, Check, ChevronLeft, ChevronRight } from "lucide-react-native";
import { cn } from "@/lib/cn";
import { useThemeColors } from "@/theme";
import { useSettingsStore } from "@/store/settingsStore";
import { useRouteStore } from "@/store/routeStore";
import { useClimbStore } from "@/store/climbStore";
import { usePoiStore } from "@/store/poiStore";
import { usePanelStore } from "@/store/panelStore";
import {
  climbDifficultyColor,
  getClimbDifficulty,
  CLIMB_DIFFICULTY_LABELS,
  isClimbAtLeastDifficulty,
} from "@/constants/climbHelpers";
import { extractRouteSlice, findNearestPointIndexAtDistance } from "@/utils/geo";
import { resolveActiveRouteProgress } from "@/utils/routeProgress";
import { formatDistance, formatElevation } from "@/utils/formatters";
import { stitchPOIs } from "@/services/stitchingService";
import { toDisplayPOIs } from "@/services/displayDistance";
import {
  createRidingHorizonWindow,
  filterClimbsToRidingHorizon,
  ridingHorizonMetersForMode,
  ridingHorizonScopeLabelForMode,
} from "@/utils/ridingHorizon";
import ElevationProfile from "@/components/elevation/ElevationProfile";
import ClimbListItem from "@/components/climb/ClimbListItem";
import { resolveActiveClimb } from "@/utils/climbSelect";
import type { ActiveRouteData, ClimbDifficulty, DisplayClimb, POI } from "@/types";

interface ClimbTabContentProps {
  activeData: ActiveRouteData | null;
}

const DIFFICULTY_FILTERS: {
  key: ClimbDifficulty;
  label: string;
  accessibilityLabel: string;
}[] = [
  {
    key: "low",
    label: "Easy+",
    accessibilityLabel: "Show easy, moderate, and hard climbs",
  },
  {
    key: "medium",
    label: "Moderate+",
    accessibilityLabel: "Show moderate and hard climbs",
  },
  { key: "hard", label: "Hard", accessibilityLabel: "Show hard climbs" },
];

const DIFFICULTY_FILTER_COLOR_SCORE: Record<ClimbDifficulty, number> = {
  low: 0,
  medium: 150,
  hard: 400,
};

const FILTER_BAR_HEIGHT = 56;

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
  const minimumDifficulty = useClimbStore((s) => s.minimumDifficulty);
  const setMinimumDifficulty = useClimbStore((s) => s.setMinimumDifficulty);
  const renameClimb = useClimbStore((s) => s.renameClimb);
  const getStarredPOIs = usePoiStore((s) => s.getStarredPOIs);
  const starredPOIIds = usePoiStore((s) => s.starredPOIIds);
  const setSelectedPOI = usePoiStore((s) => s.setSelectedPOI);
  const isExpanded = usePanelStore((s) => s.isExpanded);
  const panelMode = usePanelStore((s) => s.panelMode);
  // Reset to current/upcoming climb when tab mounts
  useEffect(() => {
    setSelectedClimb(null);
  }, [setSelectedClimb]);

  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editingClimb, setEditingClimb] = useState<DisplayClimb | null>(null);
  const [graphHeight, setGraphHeight] = useState(0);

  const activeId = activeData?.id ?? null;
  const routeIds = useMemo(() => activeData?.routeIds ?? [], [activeData?.routeIds]);
  const segments = activeData?.segments ?? null;
  const activeTotalDistance = activeData?.totalDistanceMeters;
  const activeRouteProgress = useMemo(
    () => resolveActiveRouteProgress(activeData, snappedPosition),
    [activeData, snappedPosition],
  );
  const currentDist = activeRouteProgress?.distanceAlongRouteMeters ?? null;
  const ridingHorizonMeters = ridingHorizonMetersForMode(panelMode);
  const horizonWindow = useMemo(
    () =>
      createRidingHorizonWindow(currentDist, ridingHorizonMeters, {
        totalDistanceMeters: activeTotalDistance,
      }),
    [currentDist, ridingHorizonMeters, activeTotalDistance],
  );
  const horizonScopeLabel = ridingHorizonScopeLabelForMode(panelMode);

  const poisForChart = useMemo(() => {
    if (!activeId || routeIds.length === 0) return [];
    if (segments) {
      const poisByRoute: Record<string, POI[]> = {};
      for (const routeId of routeIds) {
        poisByRoute[routeId] = getStarredPOIs(routeId);
      }
      return stitchPOIs(segments, poisByRoute);
    }
    return toDisplayPOIs(getStarredPOIs(routeIds[0]));
    // starredPOIIds is a reactivity trigger: getStarredPOIs reads store via get() and is not itself reactive
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, routeIds, segments, getStarredPOIs, starredPOIIds]);

  const displayedClimbs = useMemo(
    () => getClimbsForDisplay(routeIds, segments),
    // allClimbs is a reactivity trigger: getClimbsForDisplay reads store via get() and is not itself reactive
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [routeIds, segments, allClimbs, getClimbsForDisplay],
  );

  const sortedClimbs = useMemo(
    () =>
      filterClimbsToRidingHorizon(displayedClimbs, horizonWindow).sort(
        (a, b) => a.effectiveStartDistanceMeters - b.effectiveStartDistanceMeters,
      ),
    [displayedClimbs, horizonWindow],
  );

  const filteredClimbs = useMemo(
    () =>
      sortedClimbs.filter((c) => isClimbAtLeastDifficulty(c.difficultyScore, minimumDifficulty)),
    [minimumDifficulty, sortedClimbs],
  );

  const difficultyCounts = useMemo(() => {
    const counts: Record<ClimbDifficulty, number> = { low: 0, medium: 0, hard: 0 };
    for (const c of sortedClimbs) {
      counts.low += 1;
      if (isClimbAtLeastDifficulty(c.difficultyScore, "medium")) counts.medium += 1;
      if (isClimbAtLeastDifficulty(c.difficultyScore, "hard")) counts.hard += 1;
    }
    return counts;
  }, [sortedClimbs]);

  const selectedClimbForFilter =
    selectedClimb && filteredClimbs.some((c) => c.id === selectedClimb.id) ? selectedClimb : null;

  const climb = useMemo(() => {
    if (editingClimb) return editingClimb;
    return resolveActiveClimb(filteredClimbs, currentDist, selectedClimbForFilter);
  }, [filteredClimbs, currentDist, editingClimb, selectedClimbForFilter]);

  const difficulty = climb ? getClimbDifficulty(climb.difficultyScore) : "low";
  const diffColor = climb ? climbDifficultyColor(climb.difficultyScore) : colors.textTertiary;

  const climbIndex = useMemo(
    () => (climb ? filteredClimbs.findIndex((c) => c.id === climb.id) : -1),
    [climb, filteredClimbs],
  );

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
    let currentDistanceInSliceMeters: number | undefined;
    if (currentDist != null) {
      const relativeDistance = currentDist - points[startIdx].distanceFromStartMeters;
      const sliceEndDistance = sliced[sliced.length - 1].distanceFromStartMeters;
      if (relativeDistance >= 0 && relativeDistance <= sliceEndDistance) {
        currentIdxInSlice = findNearestPointIndexAtDistance(sliced, relativeDistance);
        currentDistanceInSliceMeters = relativeDistance;
      }
    }
    return {
      points: sliced,
      offsetMeters: points[startIdx].distanceFromStartMeters,
      currentIdxInSlice,
      currentDistanceInSliceMeters,
    };
  }, [climb, activeData, currentDist]);

  const climbProfilePOIs = useMemo(() => {
    if (!climbProfile) return undefined;
    const endDistance =
      climbProfile.offsetMeters +
      climbProfile.points[climbProfile.points.length - 1].distanceFromStartMeters;
    return poisForChart.filter(
      (poi) =>
        poi.effectiveDistanceMeters >= climbProfile.offsetMeters &&
        poi.effectiveDistanceMeters <= endDistance,
    );
  }, [climbProfile, poisForChart]);

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

  const handleMinimumDifficultyChange = useCallback(
    (filter: ClimbDifficulty) => {
      setIsEditing(false);
      setEditingClimb(null);
      setMinimumDifficulty(filter);
    },
    [setMinimumDifficulty],
  );

  const handleNavigateClimb = useCallback(
    (direction: -1 | 1) => {
      if (climbIndex < 0) return;
      const nextClimb = filteredClimbs[climbIndex + direction];
      if (!nextClimb) return;
      setSelectedClimb(nextClimb);
    },
    [climbIndex, filteredClimbs, setSelectedClimb],
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

  if (!climb) {
    return (
      <View className="flex-1">
        {isExpanded && (
          <DifficultyFilterBar
            activeFilter={minimumDifficulty}
            counts={difficultyCounts}
            onChange={handleMinimumDifficultyChange}
          />
        )}
        <View className="flex-1 items-center justify-center px-4">
          <Mountain size={24} color={colors.textTertiary} />
          <Text className="text-[13px] text-muted-foreground font-barlow-medium mt-2 text-center">
            {sortedClimbs.length === 0
              ? `No climbs in ${horizonScopeLabel}`
              : `No climbs match this filter in ${horizonScopeLabel}`}
          </Text>
        </View>
      </View>
    );
  }

  const climbPositionLabel =
    climbIndex >= 0 ? `${climbIndex + 1}/${filteredClimbs.length}` : `-/${filteredClimbs.length}`;
  const climbTitle = `${climbPositionLabel}: ${climb.name ?? "Climb"}`;
  const compactDistanceText =
    distToStart == null
      ? null
      : distToStart >= 0
        ? `in ${formatDistance(distToStart, units)}`
        : distToStart > -climb.lengthMeters
          ? "on it"
          : `${formatDistance(Math.abs(distToStart), units)} past`;
  const compactClimbTitle = compactDistanceText
    ? `${climbTitle} (${compactDistanceText})`
    : climbTitle;
  const statsRow = (
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
  );

  return (
    <View className="flex-1">
      {isExpanded && (
        <DifficultyFilterBar
          activeFilter={minimumDifficulty}
          counts={difficultyCounts}
          onChange={handleMinimumDifficultyChange}
        />
      )}

      {/* Header: name + difficulty */}
      <View className="flex-row items-center px-3 pt-1">
        <ClimbArrowButton
          direction="previous"
          disabled={climbIndex <= 0}
          onPress={() => handleNavigateClimb(-1)}
          compact={!isExpanded}
        />

        <View className="flex-1 mx-2">
          {isExpanded && isEditing ? (
            <View className="flex-row items-center">
              <Text className="text-[15px] font-barlow-semibold text-foreground mr-1.5">
                {climbPositionLabel}:
              </Text>
              <RNTextInput
                className="flex-1 text-[15px] font-barlow-semibold text-foreground border-b border-accent"
                value={editName}
                onChangeText={setEditName}
                placeholder="Climb"
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
                {climbTitle}
              </Text>
              <Pencil size={10} color={colors.textTertiary} style={{ marginLeft: 4 }} />
            </TouchableOpacity>
          ) : (
            <Text className="text-[14px] font-barlow-semibold text-foreground" numberOfLines={1}>
              {compactClimbTitle}
            </Text>
          )}
          <View className="flex-row items-center">
            <Mountain size={isExpanded ? 11 : 10} color={diffColor} />
            <Text
              className={cn("ml-1 font-barlow-medium", isExpanded ? "text-[11px]" : "text-[10px]")}
              style={{ color: diffColor }}
            >
              {CLIMB_DIFFICULTY_LABELS[difficulty]} · {Math.round(climb.difficultyScore)}
            </Text>
            {!isExpanded && (
              <>
                <Text className="ml-2 text-[10px] font-barlow-sc-semibold text-foreground">
                  +{formatElevation(climb.totalAscentMeters, units)}
                </Text>
                <Text className="ml-2 text-[10px] font-barlow-sc-semibold text-foreground">
                  {climb.averageGradientPercent}% avg
                </Text>
              </>
            )}
          </View>
        </View>

        <ClimbArrowButton
          direction="next"
          disabled={climbIndex < 0 || climbIndex >= filteredClimbs.length - 1}
          onPress={() => handleNavigateClimb(1)}
          compact={!isExpanded}
        />
      </View>

      {/* Elevation profile */}
      {climbProfile && (
        <View
          className={cn("flex-1", isExpanded ? "mx-3" : "mx-2")}
          style={!isExpanded ? { paddingBottom: Math.max(4, safeBottom - 8) } : undefined}
        >
          <View
            className="flex-1 rounded-lg overflow-hidden"
            onLayout={(e) => setGraphHeight(Math.round(e.nativeEvent.layout.height))}
          >
            {graphHeight > 0 && (
              <ElevationProfile
                points={climbProfile.points}
                units={units}
                width={screenWidth - (isExpanded ? 24 : 16)}
                height={graphHeight}
                showLegend={false}
                distanceOffsetMeters={climbProfile.offsetMeters}
                currentPointIndex={climbProfile.currentIdxInSlice}
                currentDistanceMeters={climbProfile.currentDistanceInSliceMeters}
                pois={climbProfilePOIs}
                onPOIPress={setSelectedPOI}
              />
            )}
          </View>
        </View>
      )}

      {isExpanded && statsRow}

      {/* Expanded: scrollable climb list */}
      {isExpanded && (
        <View className="flex-1 border-t border-border mt-1">
          <FlatList
            data={filteredClimbs}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <ClimbListItem
                climb={item}
                currentDistAlongRoute={currentDist}
                isPast={currentDist != null && item.effectiveEndDistanceMeters < currentDist}
                onPress={handleClimbPress}
              />
            )}
            ListEmptyComponent={
              <View className="items-center justify-center py-8 px-4">
                <Text className="text-[13px] text-muted-foreground font-barlow-medium">
                  No climbs match this difficulty in {horizonScopeLabel}
                </Text>
              </View>
            }
            contentContainerStyle={{ paddingBottom: safeBottom }}
          />
        </View>
      )}
    </View>
  );
}

function ClimbArrowButton({
  direction,
  disabled,
  onPress,
  compact = false,
}: {
  direction: "previous" | "next";
  disabled: boolean;
  onPress: () => void;
  compact?: boolean;
}) {
  const colors = useThemeColors();
  const Icon = direction === "previous" ? ChevronLeft : ChevronRight;

  return (
    <TouchableOpacity
      className={cn(
        "items-center justify-center rounded-full border",
        compact ? "w-[40px] h-[40px]" : "w-[48px] h-[48px]",
        disabled ? "border-transparent" : "bg-muted border-border",
      )}
      style={disabled ? { opacity: 0.4 } : undefined}
      hitSlop={compact ? 4 : undefined}
      disabled={disabled}
      onPress={onPress}
      accessibilityLabel={direction === "previous" ? "Previous climb" : "Next climb"}
      accessibilityState={{ disabled }}
    >
      <Icon
        size={compact ? 20 : 22}
        color={disabled ? colors.textTertiary : colors.textSecondary}
      />
    </TouchableOpacity>
  );
}

function DifficultyFilterBar({
  activeFilter,
  counts,
  onChange,
}: {
  activeFilter: ClimbDifficulty;
  counts: Record<ClimbDifficulty, number>;
  onChange: (filter: ClimbDifficulty) => void;
}) {
  const colors = useThemeColors();

  return (
    <View
      style={{
        height: FILTER_BAR_HEIGHT,
        borderBottomWidth: 1,
        borderBottomColor: colors.borderSubtle,
      }}
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ height: FILTER_BAR_HEIGHT, flexGrow: 0 }}
        contentContainerStyle={{
          height: FILTER_BAR_HEIGHT,
          alignItems: "center",
          paddingHorizontal: 12,
          gap: 8,
        }}
      >
        {DIFFICULTY_FILTERS.map((filter) => {
          const isActive = activeFilter === filter.key;
          const color = climbDifficultyColor(DIFFICULTY_FILTER_COLOR_SCORE[filter.key]);

          return (
            <TouchableOpacity
              key={filter.key}
              className={cn(
                "flex-row items-center px-3 min-h-[48px] rounded-full",
                isActive ? "bg-muted border border-border" : "border border-transparent",
              )}
              onPress={() => onChange(filter.key)}
              accessibilityLabel={filter.accessibilityLabel}
              accessibilityState={{ selected: isActive }}
            >
              <View
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: isActive ? color : colors.textTertiary }}
              />
              <Text
                className={cn(
                  "ml-1.5 text-[12px] font-barlow-medium",
                  isActive ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {filter.label}
              </Text>
              <Text
                className={cn(
                  "ml-1 text-[10px] font-barlow-sc-medium",
                  isActive ? "text-muted-foreground" : "text-muted-foreground/50",
                )}
              >
                {counts[filter.key]}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
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
