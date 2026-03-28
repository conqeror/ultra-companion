import React, { useMemo, useCallback } from "react";
import { View, FlatList, TouchableOpacity } from "react-native";
import Animated, {
  useAnimatedStyle,
  withTiming,
  Easing,
} from "react-native-reanimated";
import { Text } from "@/components/ui/text";
import { X } from "lucide-react-native";
import { useThemeColors } from "@/theme";
import { usePoiStore } from "@/store/poiStore";
import { useRouteStore } from "@/store/routeStore";
import POIFilterBar from "@/components/map/POIFilterBar";
import POIListItem from "./POIListItem";
import { POI_BEHIND_THRESHOLD_M } from "@/constants";
import { stitchPOIs } from "@/services/stitchingService";
import type { POI, StitchedSegmentInfo } from "@/types";

interface POIListViewProps {
  routeIds: string[];
  segments: StitchedSegmentInfo[] | null;
}

export default function POIListView({ routeIds, segments }: POIListViewProps) {
  const colors = useThemeColors();
  const showPOIList = usePoiStore((s) => s.showPOIList);
  const setShowPOIList = usePoiStore((s) => s.setShowPOIList);
  const setSelectedPOI = usePoiStore((s) => s.setSelectedPOI);
  const getVisiblePOIs = usePoiStore((s) => s.getVisiblePOIs);
  const enabledCategories = usePoiStore((s) => s.enabledCategories);
  const starredPOIIds = usePoiStore((s) => s.starredPOIIds);
  const allPois = usePoiStore((s) => s.pois);
  const snappedPosition = useRouteStore((s) => s.snappedPosition);

  const currentDist = snappedPosition?.distanceAlongRouteMeters ?? null;

  const visiblePOIs = useMemo(() => {
    if (segments) {
      // Race mode: get visible POIs per segment, stitch with distance offsets
      const poisByRoute: Record<string, POI[]> = {};
      for (const routeId of routeIds) {
        poisByRoute[routeId] = getVisiblePOIs(routeId);
      }
      return stitchPOIs(segments, poisByRoute);
    }
    // Standalone route
    return routeIds.length > 0 ? getVisiblePOIs(routeIds[0]) : [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeIds, segments, allPois, enabledCategories, starredPOIIds]);

  // Filter to ahead + 1km behind, sort by distance along route (upcoming first)
  const sortedPOIs = useMemo(() => {
    if (currentDist == null) {
      // Not snapped: show all, sorted by distance along route
      return [...visiblePOIs].sort(
        (a, b) => a.distanceAlongRouteMeters - b.distanceAlongRouteMeters,
      );
    }
    return visiblePOIs
      .filter(
        (p) => p.distanceAlongRouteMeters >= currentDist - POI_BEHIND_THRESHOLD_M,
      )
      .sort(
        (a, b) => a.distanceAlongRouteMeters - b.distanceAlongRouteMeters,
      );
  }, [visiblePOIs, currentDist]);

  const handlePress = useCallback(
    (poi: POI) => {
      setSelectedPOI(poi);
      setShowPOIList(false);
    },
    [setSelectedPOI, setShowPOIList],
  );

  const renderItem = useCallback(
    ({ item }: { item: POI }) => (
      <POIListItem
        poi={item}
        currentDistAlongRoute={currentDist}
        onPress={handlePress}
      />
    ),
    [currentDist, handlePress],
  );

  const keyExtractor = useCallback((item: POI) => item.id, []);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateY: withTiming(showPOIList ? 0 : 2000, {
          duration: 300,
          easing: Easing.out(Easing.cubic),
        }),
      },
    ],
  }));

  if (!showPOIList) return null;

  return (
    <Animated.View
      className="absolute inset-0 z-30"
      style={[{ top: 48, backgroundColor: colors.background }, animatedStyle]}
    >
      {/* Header */}
      <View className="flex-row items-center px-4 py-3 border-b border-border">
        <Text className="flex-1 text-[20px] font-barlow-semibold text-foreground">
          Points of Interest
        </Text>
        <Text className="text-[14px] text-muted-foreground font-barlow mr-3">
          {sortedPOIs.length}
        </Text>
        <TouchableOpacity
          className="w-[48px] h-[48px] items-center justify-center -mr-2"
          onPress={() => setShowPOIList(false)}
          accessibilityLabel="Close POI list"
        >
          <X size={22} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {/* Category filters */}
      <View className="border-b border-border">
        <POIFilterBar routeIds={routeIds} />
      </View>

      {/* List */}
      <FlatList
        data={sortedPOIs}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        contentContainerStyle={{ paddingBottom: 100 }}
      />
    </Animated.View>
  );
}
