import React, { useMemo, useCallback, useRef, useEffect } from "react";
import { View, FlatList, TouchableOpacity } from "react-native";
import Animated, {
  useAnimatedStyle,
  withTiming,
  Easing,
} from "react-native-reanimated";
import { Text } from "@/components/ui/text";
import { X } from "lucide-react-native";
import { useThemeColors } from "@/theme";
import { useClimbStore } from "@/store/climbStore";
import { useRouteStore } from "@/store/routeStore";
import { usePanelStore } from "@/store/panelStore";
import ClimbListItem from "./ClimbListItem";
import type { Climb, StitchedSegmentInfo } from "@/types";

interface ClimbListViewProps {
  routeIds: string[];
  segments: StitchedSegmentInfo[] | null;
}

export default function ClimbListView({ routeIds, segments }: ClimbListViewProps) {
  const colors = useThemeColors();
  const showClimbList = useClimbStore((s) => s.showClimbList);
  const setShowClimbList = useClimbStore((s) => s.setShowClimbList);
  const setSelectedClimb = useClimbStore((s) => s.setSelectedClimb);
  const getClimbsForDisplay = useClimbStore((s) => s.getClimbsForDisplay);
  const allClimbs = useClimbStore((s) => s.climbs);
  const snappedPosition = useRouteStore((s) => s.snappedPosition);

  const currentDist = snappedPosition?.distanceAlongRouteMeters ?? null;

  const displayedClimbs = useMemo(
    () => getClimbsForDisplay(routeIds, segments),
    [routeIds, segments, allClimbs, getClimbsForDisplay],
  );

  // Show all climbs, sorted by distance
  const sortedClimbs = useMemo(
    () => [...displayedClimbs].sort((a, b) => a.startDistanceMeters - b.startDistanceMeters),
    [displayedClimbs],
  );

  // Index of the first upcoming climb (for auto-scroll)
  const firstUpcomingIdx = useMemo(() => {
    if (currentDist == null) return 0;
    const idx = sortedClimbs.findIndex((c) => c.endDistanceMeters > currentDist);
    return Math.max(0, idx);
  }, [sortedClimbs, currentDist]);

  const listRef = useRef<FlatList<Climb>>(null);

  // Auto-scroll to first upcoming climb when list opens
  useEffect(() => {
    if (showClimbList && firstUpcomingIdx > 0 && sortedClimbs.length > 0) {
      // Small delay to let the animation start
      setTimeout(() => {
        listRef.current?.scrollToIndex({
          index: Math.max(0, firstUpcomingIdx - 1), // show one past climb for context
          animated: false,
          viewPosition: 0,
        });
      }, 50);
    }
  }, [showClimbList]);

  const setPanelTab = usePanelStore((s) => s.setPanelTab);

  const handlePress = useCallback(
    (climb: Climb) => {
      setSelectedClimb(climb);
      setShowClimbList(false);
      setPanelTab("climbs");
    },
    [setSelectedClimb, setShowClimbList, setPanelTab],
  );

  const renderItem = useCallback(
    ({ item }: { item: Climb }) => (
      <ClimbListItem
        climb={item}
        currentDistAlongRoute={currentDist}
        isPast={currentDist != null && item.endDistanceMeters < currentDist}
        onPress={handlePress}
      />
    ),
    [currentDist, handlePress],
  );

  const keyExtractor = useCallback((item: Climb) => item.id, []);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateY: withTiming(showClimbList ? 0 : 2000, {
          duration: 300,
          easing: Easing.out(Easing.cubic),
        }),
      },
    ],
  }));

  if (!showClimbList) return null;

  return (
    <Animated.View
      className="absolute inset-0 z-30"
      style={[{ top: 48, backgroundColor: colors.background }, animatedStyle]}
    >
      <View className="flex-row items-center px-4 py-3 border-b border-border">
        <Text className="flex-1 text-[20px] font-barlow-semibold text-foreground">
          Climbs
        </Text>
        <Text className="text-[14px] text-muted-foreground font-barlow mr-3">
          {sortedClimbs.length}
        </Text>
        <TouchableOpacity
          className="w-[48px] h-[48px] items-center justify-center -mr-2"
          onPress={() => setShowClimbList(false)}
          accessibilityLabel="Close climb list"
        >
          <X size={22} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      <FlatList
        ref={listRef}
        data={sortedClimbs}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        contentContainerStyle={{ paddingBottom: 100 }}
        onScrollToIndexFailed={() => {}}
      />
    </Animated.View>
  );
}
