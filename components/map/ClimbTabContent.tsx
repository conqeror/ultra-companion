import React, { useMemo, useState, useCallback, useEffect, useRef } from "react";
import {
  View,
  TouchableOpacity,
  TextInput as RNTextInput,
  useWindowDimensions,
  FlatList,
} from "react-native";
import { useShallow } from "zustand/react/shallow";
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
} from "@/constants/climbHelpers";
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
import { bucketDistanceForDerivedWork } from "@/utils/distanceBuckets";
import { pickRouteRecords } from "@/utils/routeScopedRecords";
import { getClimbProgress } from "@/utils/climbProgress";
import { computeClimbSegmentStats } from "@/utils/climbSegmentStats";
import {
  buildClimbProfileSegments,
  buildClimbProfileSlice,
  chooseClimbTickIntervalMeters,
} from "@/utils/climbProfile";
import ElevationProfile from "@/components/elevation/ElevationProfile";
import ClimbListItem from "@/components/climb/ClimbListItem";
import { resolveActiveClimb } from "@/utils/climbSelect";
import type { ActiveRouteData, DisplayClimb, POI } from "@/types";

const CLIMB_LIST_ROW_HEIGHT = 70;

interface ClimbTabContentProps {
  activeData: ActiveRouteData | null;
  width?: number;
  presentation?: "default" | "web";
}

export default function ClimbTabContent({
  activeData,
  width,
  presentation = "default",
}: ClimbTabContentProps) {
  const colors = useThemeColors();
  const units = useSettingsStore((s) => s.units);
  const { width: screenWidth } = useWindowDimensions();
  const contentWidth = width ?? screenWidth;
  const snappedPosition = useRouteStore((s) => s.snappedPosition);
  const getClimbsForDisplay = useClimbStore((s) => s.getClimbsForDisplay);
  const selectedClimb = useClimbStore((s) => s.selectedClimb);
  const setSelectedClimb = useClimbStore((s) => s.setSelectedClimb);
  const renameClimb = useClimbStore((s) => s.renameClimb);
  const getStarredPOIs = usePoiStore((s) => s.getStarredPOIs);
  const starredPOIIds = usePoiStore((s) => s.starredPOIIds);
  const setSelectedPOI = usePoiStore((s) => s.setSelectedPOI);
  const isExpanded = usePanelStore((s) => s.isExpanded);
  const panelMode = usePanelStore((s) => s.panelMode);

  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editingClimb, setEditingClimb] = useState<DisplayClimb | null>(null);
  const [graphHeight, setGraphHeight] = useState(0);
  const climbListRef = useRef<FlatList<DisplayClimb>>(null);

  const activeId = activeData?.id ?? null;
  const activeRoutePoints = activeData?.points ?? null;
  const routeIds = useMemo(() => activeData?.routeIds ?? [], [activeData?.routeIds]);
  const routePois = usePoiStore(useShallow((s) => pickRouteRecords(s.pois, routeIds)));
  const routeClimbs = useClimbStore(useShallow((s) => pickRouteRecords(s.climbs, routeIds)));
  const segments = activeData?.segments ?? null;
  const activeTotalDistance = activeData?.totalDistanceMeters;
  const activeRouteProgress = useMemo(
    () => resolveActiveRouteProgress(activeData, snappedPosition),
    [activeData, snappedPosition],
  );
  const currentDist = activeRouteProgress?.distanceAlongRouteMeters ?? null;
  const derivedCurrentDist = bucketDistanceForDerivedWork(currentDist);
  const ridingHorizonMeters = ridingHorizonMetersForMode(panelMode);
  const horizonWindow = useMemo(
    () =>
      createRidingHorizonWindow(derivedCurrentDist, ridingHorizonMeters, {
        totalDistanceMeters: activeTotalDistance,
      }),
    [derivedCurrentDist, ridingHorizonMeters, activeTotalDistance],
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
    // starredPOIIds/routePois are reactivity triggers: getStarredPOIs reads store via get()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, routeIds, segments, getStarredPOIs, starredPOIIds, routePois]);

  const displayedClimbs = useMemo(
    () => getClimbsForDisplay(routeIds, segments),
    // routeClimbs is a reactivity trigger: getClimbsForDisplay reads store via get()
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [routeIds, segments, getClimbsForDisplay, routeClimbs],
  );

  const sortedClimbs = useMemo(
    () =>
      filterClimbsToRidingHorizon(displayedClimbs, horizonWindow).sort(
        (a, b) => a.effectiveStartDistanceMeters - b.effectiveStartDistanceMeters,
      ),
    [displayedClimbs, horizonWindow],
  );

  const selectedClimbInScope =
    selectedClimb && sortedClimbs.some((c) => c.id === selectedClimb.id) ? selectedClimb : null;

  const climb = useMemo(() => {
    if (editingClimb) return editingClimb;
    return resolveActiveClimb(sortedClimbs, currentDist, selectedClimbInScope);
  }, [sortedClimbs, currentDist, editingClimb, selectedClimbInScope]);

  const climbProgress = useMemo(
    () => (climb ? getClimbProgress(climb, currentDist) : null),
    [climb, currentDist],
  );

  const activeRemainingStats = useMemo(() => {
    if (
      !climb ||
      climbProgress?.state !== "active" ||
      !activeRoutePoints?.length ||
      currentDist == null
    ) {
      return null;
    }
    return computeClimbSegmentStats(
      activeRoutePoints,
      currentDist,
      climb.effectiveEndDistanceMeters,
    );
  }, [climb, climbProgress?.state, activeRoutePoints, currentDist]);

  const difficulty = climb ? getClimbDifficulty(climb.difficultyScore) : "low";
  const diffColor = climb ? climbDifficultyColor(climb.difficultyScore) : colors.textTertiary;

  const climbIndex = useMemo(
    () => (climb ? sortedClimbs.findIndex((c) => c.id === climb.id) : -1),
    [climb, sortedClimbs],
  );

  const climbProfile = useMemo(() => {
    if (!climb || !activeRoutePoints?.length) return null;
    const sliced = buildClimbProfileSlice(
      activeRoutePoints,
      climb.effectiveStartDistanceMeters,
      climb.effectiveEndDistanceMeters,
    );
    if (sliced.length < 2) return null;
    return {
      points: sliced,
      offsetMeters: climb.effectiveStartDistanceMeters,
      gradientSegments: buildClimbProfileSegments(sliced),
    };
  }, [climb, activeRoutePoints]);

  const climbProfileCurrentDistanceMeters = (() => {
    if (!climbProfile || currentDist == null) return undefined;
    const relativeDistance = currentDist - climbProfile.offsetMeters;
    const sliceEndDistance =
      climbProfile.points[climbProfile.points.length - 1].distanceFromStartMeters;
    return relativeDistance >= 0 && relativeDistance <= sliceEndDistance
      ? relativeDistance
      : undefined;
  })();

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

  const handleNavigateClimb = useCallback(
    (direction: -1 | 1) => {
      if (climbIndex < 0) return;
      const nextClimb = sortedClimbs[climbIndex + direction];
      if (!nextClimb) return;
      setSelectedClimb(nextClimb);
    },
    [climbIndex, sortedClimbs, setSelectedClimb],
  );

  const handleClimbPress = useCallback(
    (c: DisplayClimb) => {
      setSelectedClimb(c);
    },
    [setSelectedClimb],
  );

  const renderClimbItem = useCallback(
    ({ item }: { item: DisplayClimb }) => (
      <ClimbListItem
        climb={item}
        currentDistAlongRoute={currentDist}
        onPress={handleClimbPress}
        isSelected={climb?.id === item.id}
        height={CLIMB_LIST_ROW_HEIGHT}
      />
    ),
    [climb?.id, currentDist, handleClimbPress],
  );

  useEffect(() => {
    if (!isExpanded || climbIndex < 0) return;

    const frame = requestAnimationFrame(() => {
      climbListRef.current?.scrollToIndex({
        index: climbIndex,
        animated: true,
        viewPosition: 0.16,
      });
    });

    return () => cancelAnimationFrame(frame);
  }, [climbIndex, isExpanded]);

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
      <View className="flex-1 items-center justify-center px-4">
        <Mountain size={24} color={colors.textTertiary} />
        <Text className="text-[13px] text-muted-foreground font-barlow-medium mt-2 text-center">
          No climbs in {horizonScopeLabel}
        </Text>
      </View>
    );
  }

  const climbPositionLabel =
    climbIndex >= 0 ? `${climbIndex + 1}/${sortedClimbs.length}` : `-/${sortedClimbs.length}`;
  const climbTitle = `${climbPositionLabel}: ${climb.name ?? "Climb"}`;
  const progress = climbProgress ?? getClimbProgress(climb, currentDist);
  const remainingLengthMeters =
    progress.state === "active"
      ? (activeRemainingStats?.lengthMeters ?? progress.remainingDistanceMeters)
      : climb.lengthMeters;
  const remainingGainMeters =
    progress.state === "active"
      ? (activeRemainingStats?.gainMeters ??
        climb.totalAscentMeters * (remainingLengthMeters / Math.max(1, climb.lengthMeters)))
      : climb.totalAscentMeters;
  const remainingAverageGradientPercent =
    progress.state === "active"
      ? (activeRemainingStats?.averageGradientPercent ??
        (remainingLengthMeters > 0 ? (remainingGainMeters / remainingLengthMeters) * 100 : 0))
      : climb.averageGradientPercent;
  const remainingMaxGradientPercent =
    progress.state === "active"
      ? (activeRemainingStats?.maxGradientPercent ?? climb.maxGradientPercent)
      : climb.maxGradientPercent;
  const compactDistanceText =
    progress.state === "upcoming" && progress.distanceToStartMeters != null
      ? `in ${formatDistance(progress.distanceToStartMeters, units)}`
      : progress.state === "active" && progress.distanceToTopMeters != null
        ? `+${formatElevation(remainingGainMeters, units)}, ${formatDistance(
            remainingLengthMeters,
            units,
          )} to top`
        : progress.state === "past" && progress.distancePastTopMeters != null
          ? `${formatDistance(progress.distancePastTopMeters, units)} past`
          : null;
  const compactClimbTitle = compactDistanceText
    ? `${climbTitle} (${compactDistanceText})`
    : climbTitle;
  const expandedDistanceLabel =
    progress.state === "upcoming" ? "To start" : progress.state === "past" ? "Past" : null;
  const expandedDistanceValue =
    progress.state === "upcoming" && progress.distanceToStartMeters != null
      ? formatDistance(progress.distanceToStartMeters, units)
      : progress.state === "past" && progress.distancePastTopMeters != null
        ? formatDistance(progress.distancePastTopMeters, units)
        : null;
  const isActiveClimb = progress.state === "active";
  const summaryMaxGradient = roundOne(remainingMaxGradientPercent);
  const climbProfileLengthMeters =
    climbProfile?.points[climbProfile.points.length - 1]?.distanceFromStartMeters;
  const compactTickIntervalMeters =
    climbProfileLengthMeters != null
      ? chooseClimbTickIntervalMeters(climbProfileLengthMeters)
      : undefined;
  const expandedUsesOneKmScroll =
    isExpanded && compactTickIntervalMeters != null && compactTickIntervalMeters > 1000;
  const statsRow = (
    <View
      className="flex-row items-center px-3 py-1.5"
      style={{
        borderTopWidth: 1,
        borderTopColor: colors.borderSubtle,
      }}
    >
      <MetricCell
        label="Gain"
        value={`+${formatElevation(climb.totalAscentMeters, units)}`}
        detail={isActiveClimb ? `+${formatElevation(remainingGainMeters, units)} left` : undefined}
      />
      <MetricCell
        label="Length"
        value={formatDistance(climb.lengthMeters, units)}
        detail={isActiveClimb ? `${formatDistance(remainingLengthMeters, units)} left` : undefined}
      />
      <MetricCell
        label="Avg"
        value={`${climb.averageGradientPercent}%`}
        detail={isActiveClimb ? `${roundOne(remainingAverageGradientPercent)}% left` : undefined}
      />
      <MetricCell
        label="Max"
        value={`${climb.maxGradientPercent}%`}
        detail={isActiveClimb ? `${summaryMaxGradient}% left` : undefined}
      />
      {expandedDistanceLabel && expandedDistanceValue && (
        <MetricCell label={expandedDistanceLabel} value={expandedDistanceValue} />
      )}
    </View>
  );
  const statsColumn = (
    <View className="justify-center gap-2 py-2 pr-3" style={{ width: 176 }}>
      <CompactStatCard
        label="Gain"
        value={`+${formatElevation(climb.totalAscentMeters, units)}`}
        detail={isActiveClimb ? `+${formatElevation(remainingGainMeters, units)} left` : undefined}
      />
      <CompactStatCard
        label="Length"
        value={formatDistance(climb.lengthMeters, units)}
        detail={isActiveClimb ? `${formatDistance(remainingLengthMeters, units)} left` : undefined}
      />
      <CompactStatCard
        label="Avg"
        value={`${climb.averageGradientPercent}%`}
        detail={isActiveClimb ? `${roundOne(remainingAverageGradientPercent)}% left` : undefined}
      />
      <CompactStatCard
        label="Max"
        value={`${climb.maxGradientPercent}%`}
        detail={isActiveClimb ? `${summaryMaxGradient}% left` : undefined}
      />
      {expandedDistanceLabel && expandedDistanceValue && (
        <CompactStatCard label={expandedDistanceLabel} value={expandedDistanceValue} />
      )}
    </View>
  );

  if (presentation === "web") {
    const graphWidth = Math.max(280, contentWidth - 212);
    return (
      <View className="flex-1 flex-row">
        <View className="flex-1 min-w-0">
          <View className="flex-row items-center px-3 pt-2">
            <View className="flex-1 mr-2">
              {isEditing ? (
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
              ) : (
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
              )}
              <View className="flex-row items-center">
                <Mountain size={13} color={diffColor} />
                <Text
                  className="ml-1 font-barlow-medium text-[13px]"
                  style={{ color: diffColor }}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.82}
                >
                  {`${CLIMB_DIFFICULTY_LABELS[difficulty]} · ${Math.round(climb.difficultyScore)}`}
                </Text>
              </View>
            </View>

            <ClimbStepControl
              previousDisabled={climbIndex <= 0}
              nextDisabled={climbIndex < 0 || climbIndex >= sortedClimbs.length - 1}
              onPrevious={() => handleNavigateClimb(-1)}
              onNext={() => handleNavigateClimb(1)}
              compact
            />
          </View>

          {climbProfile && (
            <View className="flex-1 mx-3 mb-2">
              <View
                className="flex-1 rounded-lg overflow-hidden"
                onLayout={(e) => setGraphHeight(Math.round(e.nativeEvent.layout.height))}
              >
                {graphHeight > 0 && (
                  <ElevationProfile
                    points={climbProfile.points}
                    units={units}
                    width={graphWidth}
                    height={graphHeight}
                    showLegend={false}
                    showScrollOverview={expandedUsesOneKmScroll}
                    fitToWidth={!expandedUsesOneKmScroll}
                    distanceOffsetMeters={climbProfile.offsetMeters}
                    xAxisLabelOffsetMeters={0}
                    xTickIntervalMeters={expandedUsesOneKmScroll ? 1000 : undefined}
                    axisStyle="climb"
                    minPixelsPerKm={expandedUsesOneKmScroll ? 28 : 2}
                    currentDistanceMeters={climbProfileCurrentDistanceMeters}
                    pois={climbProfilePOIs}
                    onPOIPress={setSelectedPOI}
                    gradientSegments={climbProfile.gradientSegments}
                    lineStrokeColor={colors.textPrimary}
                    lineStrokeWidth={3.5}
                  />
                )}
              </View>
            </View>
          )}
        </View>
        {statsColumn}
      </View>
    );
  }

  return (
    <View className="flex-1">
      {/* Header: name + difficulty */}
      <View className="flex-row items-center px-3 pt-1">
        <View className="flex-1 mr-2">
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
            <Mountain size={isExpanded ? 13 : 14} color={diffColor} />
            <Text
              className={cn("ml-1 font-barlow-medium", isExpanded ? "text-[13px]" : "text-[13px]")}
              style={{ color: diffColor }}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.82}
            >
              {isExpanded
                ? `${CLIMB_DIFFICULTY_LABELS[difficulty]} · ${Math.round(climb.difficultyScore)}`
                : `${CLIMB_DIFFICULTY_LABELS[difficulty]} · +${formatElevation(
                    climb.totalAscentMeters,
                    units,
                  )} · ${roundOne(climb.averageGradientPercent)}% avg`}
            </Text>
          </View>
        </View>

        <ClimbStepControl
          previousDisabled={climbIndex <= 0}
          nextDisabled={climbIndex < 0 || climbIndex >= sortedClimbs.length - 1}
          onPrevious={() => handleNavigateClimb(-1)}
          onNext={() => handleNavigateClimb(1)}
          compact={!isExpanded}
        />
      </View>

      {/* Elevation profile */}
      {climbProfile && (
        <View
          className={cn(isExpanded ? "mx-3" : "mx-2")}
          style={[{ flex: isExpanded ? 1.35 : 1 }, !isExpanded ? { paddingBottom: 4 } : undefined]}
        >
          <View
            className="flex-1 rounded-lg overflow-hidden"
            onLayout={(e) => setGraphHeight(Math.round(e.nativeEvent.layout.height))}
          >
            {graphHeight > 0 && (
              <ElevationProfile
                points={climbProfile.points}
                units={units}
                width={contentWidth - (isExpanded ? 24 : 16)}
                height={graphHeight}
                showLegend={false}
                showScrollOverview={expandedUsesOneKmScroll}
                fitToWidth={!expandedUsesOneKmScroll}
                distanceOffsetMeters={climbProfile.offsetMeters}
                xAxisLabelOffsetMeters={0}
                xTickIntervalMeters={expandedUsesOneKmScroll ? 1000 : undefined}
                axisStyle="climb"
                minPixelsPerKm={expandedUsesOneKmScroll ? 28 : 2}
                currentDistanceMeters={climbProfileCurrentDistanceMeters}
                pois={climbProfilePOIs}
                onPOIPress={setSelectedPOI}
                gradientSegments={climbProfile.gradientSegments}
                lineStrokeColor={colors.textPrimary}
                lineStrokeWidth={3.5}
              />
            )}
          </View>
        </View>
      )}

      {isExpanded && statsRow}

      {/* Expanded: scrollable climb list */}
      {isExpanded && (
        <View className="border-t border-border mt-1" style={{ flex: 0.85 }}>
          <FlatList
            ref={climbListRef}
            data={sortedClimbs}
            keyExtractor={(item) => item.id}
            renderItem={renderClimbItem}
            extraData={climb?.id}
            getItemLayout={(_, index) => ({
              length: CLIMB_LIST_ROW_HEIGHT,
              offset: CLIMB_LIST_ROW_HEIGHT * index,
              index,
            })}
            onScrollToIndexFailed={(info) => {
              climbListRef.current?.scrollToOffset({
                offset: Math.max(0, info.averageItemLength * info.index),
                animated: true,
              });
            }}
            contentContainerStyle={{ paddingBottom: 8 }}
          />
        </View>
      )}
    </View>
  );
}

function ClimbStepControl({
  previousDisabled,
  nextDisabled,
  onPrevious,
  onNext,
  compact = false,
}: {
  previousDisabled: boolean;
  nextDisabled: boolean;
  onPrevious: () => void;
  onNext: () => void;
  compact?: boolean;
}) {
  const height = 48;
  const buttonWidth = 42;
  const iconSize = compact ? 20 : 22;

  return (
    <View className="flex-row items-center gap-2" style={{ height }}>
      <ClimbStepButton
        icon={ChevronLeft}
        disabled={previousDisabled}
        onPress={onPrevious}
        label="Previous climb"
        width={buttonWidth}
        iconSize={iconSize}
      />
      <ClimbStepButton
        icon={ChevronRight}
        disabled={nextDisabled}
        onPress={onNext}
        label="Next climb"
        width={buttonWidth}
        iconSize={iconSize}
      />
    </View>
  );
}

function ClimbStepButton({
  icon: Icon,
  disabled,
  onPress,
  label,
  width,
  iconSize,
}: {
  icon: React.ComponentType<{ color?: string; size?: number; strokeWidth?: number }>;
  disabled: boolean;
  onPress: () => void;
  label: string;
  width: number;
  iconSize: number;
}) {
  const colors = useThemeColors();
  return (
    <TouchableOpacity
      className="items-center justify-center rounded-lg border"
      style={{
        width,
        height: 42,
        opacity: disabled ? 0.34 : 1,
        backgroundColor: colors.surface,
        borderColor: colors.border,
      }}
      disabled={disabled}
      onPress={onPress}
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      activeOpacity={0.68}
    >
      <Icon
        size={iconSize}
        color={disabled ? colors.textTertiary : colors.textSecondary}
        strokeWidth={2.35}
      />
    </TouchableOpacity>
  );
}

function MetricCell({ label, value, detail }: { label: string; value: string; detail?: string }) {
  const colors = useThemeColors();
  return (
    <View className="flex-1 min-w-0 justify-center pr-2">
      <View className="flex-row items-baseline">
        <Text
          className="text-[11px] text-muted-foreground font-barlow-medium mr-1"
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.82}
        >
          {label}
        </Text>
        <Text
          className="text-[17px] font-barlow-sc-semibold text-foreground flex-shrink"
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.72}
        >
          {value}
        </Text>
      </View>
      {detail && (
        <Text
          className="text-[10px] font-barlow-medium"
          style={{ color: colors.textSecondary }}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.74}
        >
          {detail}
        </Text>
      )}
    </View>
  );
}

function CompactStatCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <View className="h-[44px] justify-center rounded-lg bg-muted px-3">
      <Text
        className="text-[10px] text-muted-foreground font-barlow-medium leading-3"
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.82}
      >
        {label}
      </Text>
      <Text
        className="text-[17px] font-barlow-sc-semibold text-foreground leading-5"
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
      >
        {value}
      </Text>
      {detail && (
        <Text
          className="text-[9px] text-muted-foreground font-barlow-medium leading-3"
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.72}
        >
          {detail}
        </Text>
      )}
    </View>
  );
}

function roundOne(value: number): number {
  return Math.round(value * 10) / 10;
}
