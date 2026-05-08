import React, { useEffect, useMemo, useState } from "react";
import { View, TouchableOpacity } from "react-native";
import type { LayoutChangeEvent } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { Text } from "@/components/ui/text";
import { useThemeColors } from "@/theme";
import { usePoiStore } from "@/store/poiStore";
import { POI_CATEGORIES } from "@/constants";
import { POI_ICON_MAP } from "@/constants/poiIcons";
import { hasAnyPOICategoryCounts, type POICategoryCountMap } from "@/utils/poiListModels";
import { SlidersHorizontal } from "lucide-react-native";
import type { POICategory } from "@/types";

interface POIFilterBarProps {
  categoryCounts: POICategoryCountMap;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
}

interface POIFilterSummaryProps {
  categoryCounts: POICategoryCountMap;
  showAllWhenInactive?: boolean;
}

const CATEGORY_GROUPS: Array<{
  label: string;
  categories: POICategory[];
  iconCategory: POICategory;
}> = [
  { label: "Water", categories: ["water"], iconCategory: "water" },
  { label: "Groceries", categories: ["groceries"], iconCategory: "groceries" },
  { label: "Gas", categories: ["gas_station"], iconCategory: "gas_station" },
  { label: "Bakery", categories: ["bakery"], iconCategory: "bakery" },
  { label: "WC", categories: ["toilet_shower"], iconCategory: "toilet_shower" },
  { label: "Shelter", categories: ["shelter", "camp_site"], iconCategory: "shelter" },
  {
    label: "Repair",
    categories: ["bike_shop", "repair_station", "pump_air"],
    iconCategory: "bike_shop",
  },
  { label: "Pharmacy", categories: ["pharmacy"], iconCategory: "pharmacy" },
  { label: "Other", categories: ["other"], iconCategory: "other" },
];

const FILTER_ANIMATION_MS = 220;
const FILTER_ANIMATION_CONFIG = {
  duration: FILTER_ANIMATION_MS,
  easing: Easing.out(Easing.cubic),
};
const ABSOLUTE_FILL_TOP = {
  position: "absolute" as const,
  left: 0,
  right: 0,
  top: 0,
};
const MEASURE_LAYER_STYLE = {
  ...ABSOLUTE_FILL_TOP,
  opacity: 0,
};

function usePOIFilterModels(categoryCounts: POICategoryCountMap) {
  const enabledCategories = usePoiStore((s) => s.enabledCategories);
  const enabledSet = useMemo(() => new Set(enabledCategories), [enabledCategories]);
  const isCategoryFilterActive = enabledCategories.length < POI_CATEGORIES.length;
  const scopedCount = useMemo(
    () => Object.values(categoryCounts).reduce((sum, count) => sum + (count ?? 0), 0),
    [categoryCounts],
  );

  const groups = useMemo(
    () =>
      CATEGORY_GROUPS.map((group) => {
        const count = group.categories.reduce(
          (sum, category) => sum + (categoryCounts[category] ?? 0),
          0,
        );
        const isEnabled = group.categories.some((category) => enabledSet.has(category));
        return {
          label: group.label,
          categories: group.categories,
          iconCategory: group.iconCategory,
          count,
          isEnabled,
        };
      }).filter((group) => group.count > 0 || group.isEnabled),
    [categoryCounts, enabledSet],
  );

  const allCategoriesSelected = !isCategoryFilterActive;
  const selectedGroups = useMemo(
    () => groups.filter((group) => isCategoryFilterActive && group.isEnabled),
    [groups, isCategoryFilterActive],
  );
  const selectedCategoryCount = useMemo(
    () => selectedGroups.reduce((sum, group) => sum + group.count, 0),
    [selectedGroups],
  );

  return {
    allCategoriesSelected,
    enabledCategories,
    enabledSet,
    groups,
    isCategoryFilterActive,
    scopedCount,
    selectedCategoryCount,
    selectedGroups,
  };
}

export function POISelectedFilterSummary({
  categoryCounts,
  showAllWhenInactive = false,
}: POIFilterSummaryProps) {
  const colors = useThemeColors();
  const { groups, isCategoryFilterActive, selectedGroups } = usePOIFilterModels(categoryCounts);
  const summaryGroups = isCategoryFilterActive ? selectedGroups : showAllWhenInactive ? groups : [];

  if (summaryGroups.length === 0) return null;

  return (
    <View className="px-3 pb-1.5">
      <View className="flex-row flex-wrap gap-1.5">
        {summaryGroups.map((group) => {
          const meta = POI_CATEGORIES.find((cat) => cat.key === group.iconCategory);
          const IconComp = meta ? POI_ICON_MAP[meta.iconName] : null;

          return (
            <View
              key={group.label}
              className="min-h-[28px] flex-row items-center rounded-lg px-2"
              style={{ backgroundColor: colors.accentSubtle }}
              accessibilityLabel={`${group.label} filter, ${group.count} POIs`}
            >
              {IconComp && <IconComp size={13} color={meta?.color ?? colors.accent} />}
              <Text className="ml-1 text-[12px] font-barlow-semibold text-foreground">
                {group.label}
              </Text>
              <Text className="ml-1 text-[11px] font-barlow-sc-semibold text-muted-foreground">
                {group.count}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function POIFilterBar({ categoryCounts, expanded, onExpandedChange }: POIFilterBarProps) {
  const colors = useThemeColors();
  const setEnabledCategories = usePoiStore((s) => s.setEnabledCategories);
  const setAllCategories = usePoiStore((s) => s.setAllCategories);
  const {
    allCategoriesSelected,
    enabledCategories,
    enabledSet,
    groups,
    isCategoryFilterActive,
    scopedCount,
    selectedCategoryCount,
    selectedGroups,
  } = usePOIFilterModels(categoryCounts);

  const handleToggleGroup = (categories: POICategory[]) => {
    if (!isCategoryFilterActive) {
      setEnabledCategories(categories);
      return;
    }

    const isGroupActive = categories.some((category) => enabledSet.has(category));
    if (isGroupActive) {
      const target = new Set(categories);
      const next = enabledCategories.filter((category) => !target.has(category));
      if (next.length === 0) setAllCategories(true);
      else setEnabledCategories(next);
      return;
    }

    setEnabledCategories([...new Set([...enabledCategories, ...categories])]);
  };

  const getGroupAccessibilityLabel = (label: string, isActive: boolean) => {
    if (!isCategoryFilterActive) return `Show ${label} POIs`;
    if (isActive) return `Clear ${label} filter`;
    return `Add ${label} filter`;
  };

  const collapsedLabel = allCategoriesSelected
    ? "All categories"
    : `${selectedGroups.length} categories`;
  const collapsedCount = allCategoriesSelected ? scopedCount : selectedCategoryCount;
  const [collapsedMeasuredHeight, setCollapsedMeasuredHeight] = useState(0);
  const [expandedMeasuredHeight, setExpandedMeasuredHeight] = useState(0);
  const [hasInitializedAnimation, setHasInitializedAnimation] = useState(false);
  const filterHeight = useSharedValue(0);
  const transitionProgress = useSharedValue(expanded ? 1 : 0);
  const isAnimationReady = collapsedMeasuredHeight > 0 && expandedMeasuredHeight > 0;
  const targetHeight = expanded ? expandedMeasuredHeight : collapsedMeasuredHeight;

  const handleCollapsedLayout = (event: LayoutChangeEvent) => {
    const height = Math.ceil(event.nativeEvent.layout.height);
    setCollapsedMeasuredHeight((current) => (current === height ? current : height));
  };

  const handleExpandedLayout = (event: LayoutChangeEvent) => {
    const height = Math.ceil(event.nativeEvent.layout.height);
    setExpandedMeasuredHeight((current) => (current === height ? current : height));
  };

  useEffect(() => {
    if (!isAnimationReady) return;

    if (!hasInitializedAnimation) {
      filterHeight.value = targetHeight;
      transitionProgress.value = expanded ? 1 : 0;
      setHasInitializedAnimation(true);
      return;
    }

    filterHeight.value = withTiming(targetHeight, FILTER_ANIMATION_CONFIG);
    transitionProgress.value = withTiming(expanded ? 1 : 0, FILTER_ANIMATION_CONFIG);
  }, [
    expanded,
    filterHeight,
    hasInitializedAnimation,
    isAnimationReady,
    targetHeight,
    transitionProgress,
  ]);

  const containerAnimatedStyle = useAnimatedStyle(() => ({
    height: filterHeight.value,
  }));

  const collapsedAnimatedStyle = useAnimatedStyle(() => ({
    opacity: 1 - transitionProgress.value,
    transform: [{ translateY: -6 * transitionProgress.value }],
  }));

  const expandedAnimatedStyle = useAnimatedStyle(() => ({
    opacity: transitionProgress.value,
    transform: [{ translateY: 6 * (1 - transitionProgress.value) }],
  }));

  if (!hasAnyPOICategoryCounts(categoryCounts)) return null;

  const renderCollapsedContent = () => {
    if (!allCategoriesSelected && selectedGroups.length > 0) {
      return (
        <View className="px-3 py-2">
          <TouchableOpacity
            className="min-h-[48px] flex-row items-center rounded-xl border px-2"
            style={{ backgroundColor: colors.surface, borderColor: colors.border }}
            onPress={() => onExpandedChange(true)}
            accessibilityRole="button"
            accessibilityLabel={`Show POI category filters, ${collapsedLabel}, ${collapsedCount} POIs`}
            accessibilityState={{ expanded: false }}
          >
            <SlidersHorizontal size={18} color={colors.accent} />
            <View className="ml-2 flex-1 flex-row flex-wrap gap-1.5">
              {selectedGroups.map((group) => {
                const meta = POI_CATEGORIES.find((cat) => cat.key === group.iconCategory);
                const IconComp = meta ? POI_ICON_MAP[meta.iconName] : null;

                return (
                  <View
                    key={group.label}
                    className="min-h-[30px] flex-row items-center rounded-lg px-2"
                    style={{ backgroundColor: colors.accentSubtle }}
                  >
                    {IconComp && <IconComp size={14} color={meta?.color ?? colors.accent} />}
                    <Text className="ml-1 text-[12px] font-barlow-semibold text-foreground">
                      {group.label}
                    </Text>
                    <Text className="ml-1 text-[11px] font-barlow-sc-semibold text-muted-foreground">
                      {group.count}
                    </Text>
                  </View>
                );
              })}
            </View>
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <View className="px-3 py-2">
        <TouchableOpacity
          className="min-h-[48px] flex-row items-center rounded-xl border px-3"
          style={{ backgroundColor: colors.surface, borderColor: colors.border }}
          onPress={() => onExpandedChange(true)}
          accessibilityRole="button"
          accessibilityLabel="Show POI category filters"
          accessibilityState={{ expanded: false }}
        >
          <SlidersHorizontal
            size={18}
            color={allCategoriesSelected ? colors.textSecondary : colors.accent}
          />
          <Text className="ml-2 flex-1 text-[15px] font-barlow-semibold text-foreground">
            {collapsedLabel}
          </Text>
          <Text className="text-[14px] font-barlow-sc-semibold text-muted-foreground">
            {collapsedCount}
          </Text>
        </TouchableOpacity>
      </View>
    );
  };

  const renderExpandedContent = () => (
    <View className="px-3 py-2">
      <View className="flex-row flex-wrap gap-2">
        <TouchableOpacity
          className="min-h-[48px] flex-row items-center rounded-xl border px-3"
          style={{
            backgroundColor: allCategoriesSelected ? colors.accentSubtle : colors.surface,
            borderColor: allCategoriesSelected ? colors.accent : colors.border,
          }}
          onPress={() => setAllCategories(true)}
          accessibilityRole="button"
          accessibilityLabel={`Show all POI categories, ${scopedCount} POIs`}
          accessibilityState={{ selected: allCategoriesSelected }}
        >
          <SlidersHorizontal
            size={18}
            color={allCategoriesSelected ? colors.accent : colors.textSecondary}
          />
          <Text className="ml-2 text-[15px] font-barlow-semibold text-foreground">All</Text>
          <Text className="ml-1.5 text-[14px] font-barlow-sc-semibold text-muted-foreground">
            {scopedCount}
          </Text>
        </TouchableOpacity>

        {groups.map((group) => {
          const isSelected = isCategoryFilterActive && group.isEnabled;
          const meta = POI_CATEGORIES.find((cat) => cat.key === group.iconCategory);
          const IconComp = meta ? POI_ICON_MAP[meta.iconName] : null;

          return (
            <TouchableOpacity
              key={group.label}
              className="min-h-[48px] flex-row items-center rounded-xl border px-3"
              style={{
                backgroundColor: isSelected ? colors.accentSubtle : colors.surface,
                borderColor: isSelected ? colors.accent : colors.border,
              }}
              onPress={() => handleToggleGroup(group.categories)}
              accessibilityRole="button"
              accessibilityLabel={getGroupAccessibilityLabel(group.label, isSelected)}
              accessibilityState={{ selected: isSelected }}
            >
              {IconComp && (
                <IconComp
                  size={18}
                  color={isSelected ? (meta?.color ?? colors.accent) : colors.textSecondary}
                />
              )}
              <Text className="ml-2 text-[15px] font-barlow-semibold text-foreground">
                {group.label}
              </Text>
              <Text className="ml-1.5 text-[14px] font-barlow-sc-semibold text-muted-foreground">
                {group.count}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );

  const renderMeasurementLayer = () => (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={MEASURE_LAYER_STYLE}
    >
      <View onLayout={handleCollapsedLayout}>{renderCollapsedContent()}</View>
      <View onLayout={handleExpandedLayout}>{renderExpandedContent()}</View>
    </View>
  );

  if (!isAnimationReady || !hasInitializedAnimation) {
    return (
      <View>
        {expanded ? renderExpandedContent() : renderCollapsedContent()}
        {renderMeasurementLayer()}
      </View>
    );
  }

  return (
    <View>
      <Animated.View style={[{ overflow: "hidden" }, containerAnimatedStyle]}>
        <Animated.View
          pointerEvents={expanded ? "none" : "auto"}
          accessibilityElementsHidden={expanded}
          importantForAccessibility={expanded ? "no-hide-descendants" : "auto"}
          style={[ABSOLUTE_FILL_TOP, collapsedAnimatedStyle]}
        >
          {renderCollapsedContent()}
        </Animated.View>
        <Animated.View
          pointerEvents={expanded ? "auto" : "none"}
          accessibilityElementsHidden={!expanded}
          importantForAccessibility={expanded ? "auto" : "no-hide-descendants"}
          style={[ABSOLUTE_FILL_TOP, expandedAnimatedStyle]}
        >
          {renderExpandedContent()}
        </Animated.View>
      </Animated.View>
      {renderMeasurementLayer()}
    </View>
  );
}

export default React.memo(POIFilterBar);
