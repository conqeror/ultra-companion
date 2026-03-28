import React, { useMemo } from "react";
import { View, ScrollView, TouchableOpacity } from "react-native";
import { Text } from "@/components/ui/text";
import {
  Droplets,
  ShoppingCart,
  Fuel,
  Wrench,
  Banknote,
  Cross,
  ShowerHead,
  Clock,
} from "lucide-react-native";
import { cn } from "@/lib/cn";
import { useThemeColors } from "@/theme";
import { usePoiStore } from "@/store/poiStore";
import { POI_CATEGORIES } from "@/constants";
import type { POI, POICategory } from "@/types";

const ICON_MAP: Record<string, React.ComponentType<any>> = {
  Droplets,
  ShoppingCart,
  Fuel,
  Wrench,
  Banknote,
  Cross,
  ShowerHead,
};

interface POIFilterBarProps {
  routeIds: string[];
}

/** Inline horizontal filter chip row — meant to be embedded in panels/lists, not floating on the map */
export default function POIFilterBar({ routeIds }: POIFilterBarProps) {
  const colors = useThemeColors();
  const allPois = usePoiStore((s) => s.pois);
  const pois = useMemo(() => {
    const combined: POI[] = [];
    for (const id of routeIds) {
      const p = allPois[id];
      if (p) combined.push(...p);
    }
    return combined.length > 0 ? combined : undefined;
  }, [routeIds, allPois]);
  const enabledCategories = usePoiStore((s) => s.enabledCategories);
  const toggleCategory = usePoiStore((s) => s.toggleCategory);
  const showOpenOnly = usePoiStore((s) => s.showOpenOnly);
  const toggleShowOpenOnly = usePoiStore((s) => s.toggleShowOpenOnly);

  const enabledSet = useMemo(
    () => new Set(enabledCategories),
    [enabledCategories],
  );

  const categoryCounts = useMemo(() => {
    if (!pois) return {};
    const counts: Partial<Record<POICategory, number>> = {};
    for (const poi of pois) {
      counts[poi.category] = (counts[poi.category] ?? 0) + 1;
    }
    return counts;
  }, [pois]);

  if (!pois || pois.length === 0) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: 12, gap: 8, paddingVertical: 8 }}
    >
      {/* Open Now filter */}
      <TouchableOpacity
        className={cn(
          "flex-row items-center px-3 min-h-[48px] rounded-full",
          showOpenOnly
            ? "bg-muted border border-border"
            : "border border-transparent",
        )}
        onPress={toggleShowOpenOnly}
        accessibilityLabel={showOpenOnly ? "Show all POIs" : "Show only open POIs"}
      >
        <Clock
          size={13}
          color={showOpenOnly ? colors.positive : colors.textTertiary}
        />
        <Text
          className={cn(
            "ml-1 text-[12px] font-barlow-medium",
            showOpenOnly ? "text-foreground" : "text-muted-foreground",
          )}
        >
          Open now
        </Text>
      </TouchableOpacity>

      {POI_CATEGORIES.map((cat) => {
        const isEnabled = enabledSet.has(cat.key);
        const count = categoryCounts[cat.key] ?? 0;
        const IconComp = ICON_MAP[cat.iconName];

        return (
          <TouchableOpacity
            key={cat.key}
            className={cn(
              "flex-row items-center px-3 min-h-[48px] rounded-full",
              isEnabled
                ? "bg-muted border border-border"
                : "border border-transparent",
            )}
            onPress={() => toggleCategory(cat.key)}
            accessibilityLabel={`${isEnabled ? "Hide" : "Show"} ${cat.label}`}
          >
            {IconComp && (
              <IconComp
                size={13}
                color={isEnabled ? cat.color : colors.textTertiary}
              />
            )}
            <Text
              className={cn(
                "ml-1 text-[12px] font-barlow-medium",
                isEnabled ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {cat.label}
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
