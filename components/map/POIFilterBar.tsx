import React, { useMemo } from "react";
import { ScrollView, TouchableOpacity } from "react-native";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/cn";
import { useThemeColors } from "@/theme";
import { usePoiStore } from "@/store/poiStore";
import { POI_CATEGORIES } from "@/constants";
import { POI_ICON_MAP } from "@/constants/poiIcons";
import { hasAnyPOICategoryCounts, type POICategoryCountMap } from "@/utils/poiListModels";
import type { POICategory } from "@/types";

interface POIFilterBarProps {
  categoryCounts: POICategoryCountMap;
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

/** Inline horizontal filter chip row — meant to be embedded in panels/lists, not floating on the map */
function POIFilterBar({ categoryCounts }: POIFilterBarProps) {
  const colors = useThemeColors();
  const enabledCategories = usePoiStore((s) => s.enabledCategories);
  const setEnabledCategories = usePoiStore((s) => s.setEnabledCategories);
  const setAllCategories = usePoiStore((s) => s.setAllCategories);

  const enabledSet = useMemo(() => new Set(enabledCategories), [enabledCategories]);
  const isCategoryFilterActive = enabledCategories.length < POI_CATEGORIES.length;

  if (!hasAnyPOICategoryCounts(categoryCounts)) return null;

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

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: 12, gap: 8, paddingVertical: 8 }}
    >
      {CATEGORY_GROUPS.map((group) => {
        const isEnabled =
          isCategoryFilterActive && group.categories.some((category) => enabledSet.has(category));
        const count = group.categories.reduce(
          (sum, category) => sum + (categoryCounts[category] ?? 0),
          0,
        );
        const meta = POI_CATEGORIES.find((cat) => cat.key === group.iconCategory);
        const IconComp = meta ? POI_ICON_MAP[meta.iconName] : null;

        return (
          <TouchableOpacity
            key={group.label}
            className={cn(
              "flex-row items-center px-3 min-h-[48px] rounded-full",
              isEnabled ? "bg-muted border border-border" : "border border-transparent",
            )}
            onPress={() => handleToggleGroup(group.categories)}
            accessibilityLabel={getGroupAccessibilityLabel(group.label, isEnabled)}
          >
            {IconComp && (
              <IconComp size={13} color={isEnabled && meta ? meta.color : colors.textTertiary} />
            )}
            <Text
              className={cn(
                "ml-1 text-[12px] font-barlow-medium",
                isEnabled ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {group.label}
            </Text>
            {count > 0 && (
              <Text
                className={cn(
                  "ml-0.5 text-[10px] font-barlow-sc-medium",
                  isEnabled ? "text-muted-foreground" : "text-muted-foreground/50",
                )}
              >
                {count}
              </Text>
            )}
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

export default React.memo(POIFilterBar);
