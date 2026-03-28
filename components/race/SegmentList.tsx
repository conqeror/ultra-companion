import React, { useState, useEffect, useMemo, useCallback } from "react";
import { View, TouchableOpacity, StyleSheet } from "react-native";
import {
  NestableDraggableFlatList,
  ScaleDecorator,
  RenderItemParams,
} from "react-native-draggable-flatlist";
import { Text } from "@/components/ui/text";
import { GripVertical, X } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { useThemeColors } from "@/theme";
import { useSettingsStore } from "@/store/settingsStore";
import { formatDistance, formatElevation } from "@/utils/formatters";
import { ACTIVE_ROUTE_COLOR } from "@/constants";
import type { RaceSegmentWithRoute } from "@/types";

/** A position slot: one or more variants grouped together */
interface PositionGroup {
  key: string;
  position: number;
  variants: RaceSegmentWithRoute[];
}

interface SegmentListProps {
  segmentsWithRoutes: RaceSegmentWithRoute[];
  onSelectVariant: (routeId: string) => void;
  onReorder: (orderedPositions: { routeId: string; position: number }[]) => Promise<void>;
  onRemove: (routeId: string) => void;
}

function groupByPosition(segments: RaceSegmentWithRoute[]): PositionGroup[] {
  const map = new Map<number, RaceSegmentWithRoute[]>();
  for (const sw of segments) {
    const pos = sw.segment.position;
    if (!map.has(pos)) map.set(pos, []);
    map.get(pos)!.push(sw);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a - b)
    .map(([pos, variants]) => ({
      key: `pos-${pos}`,
      position: pos,
      variants,
    }));
}

export default function SegmentList({
  segmentsWithRoutes,
  onSelectVariant,
  onReorder,
  onRemove,
}: SegmentListProps) {
  const colors = useThemeColors();
  const units = useSettingsStore((s) => s.units);

  // Local order state for drag reordering
  const serverGroups = useMemo(() => groupByPosition(segmentsWithRoutes), [segmentsWithRoutes]);
  const [localGroups, setLocalGroups] = useState<PositionGroup[]>(serverGroups);
  const [isSaving, setIsSaving] = useState(false);

  // Sync local state when server data changes (after save, add, remove)
  useEffect(() => {
    setLocalGroups(serverGroups);
  }, [serverGroups]);

  // Detect if local order differs from server
  const hasOrderChanged = useMemo(() => {
    if (localGroups.length !== serverGroups.length) return false;
    return localGroups.some((g, i) => g.position !== serverGroups[i]?.position);
  }, [localGroups, serverGroups]);

  const handleSaveOrder = useCallback(async () => {
    setIsSaving(true);
    const updates: { routeId: string; position: number }[] = [];
    localGroups.forEach((group, newPos) => {
      for (const sw of group.variants) {
        updates.push({ routeId: sw.route.id, position: newPos });
      }
    });
    await onReorder(updates);
    setIsSaving(false);
  }, [localGroups, onReorder]);

  const handleDragEnd = useCallback(({ data }: { data: PositionGroup[] }) => {
    setLocalGroups(data);
  }, []);

  const renderItem = useCallback(
    ({ item: group, drag, isActive }: RenderItemParams<PositionGroup>) => {
      const posIdx = localGroups.indexOf(group);
      const hasVariants = group.variants.length > 1;

      return (
        <ScaleDecorator>
          <View
            className={cn("mb-2", isActive && "opacity-80")}
            style={isActive ? { backgroundColor: colors.surfaceRaised, borderRadius: 12 } : undefined}
          >
            {group.variants.map((sw) => {
              const { segment, route } = sw;
              const isSelected = segment.isSelected;

              return (
                <View
                  key={route.id}
                  className={cn(
                    "flex-row items-center py-3 px-3 rounded-lg mb-1",
                    isSelected ? "bg-muted" : "bg-transparent",
                  )}
                >
                  {/* Drag handle (only on selected variant) */}
                  {isSelected ? (
                    <TouchableOpacity
                      onLongPress={drag}
                      delayLongPress={150}
                      className="w-[48px] h-[48px] items-center justify-center -ml-2"
                    >
                      <GripVertical size={20} color={colors.textTertiary} />
                    </TouchableOpacity>
                  ) : (
                    <View className="w-8 items-center mr-2">
                      <View
                        className="w-3 h-3 rounded-full border-2"
                        style={{
                          borderColor: colors.textTertiary,
                          backgroundColor: "transparent",
                        }}
                      />
                    </View>
                  )}

                  {/* Segment info */}
                  <TouchableOpacity
                    className="flex-1 mr-2"
                    onPress={() => {
                      if (hasVariants && !isSelected) {
                        onSelectVariant(route.id);
                      }
                    }}
                    activeOpacity={hasVariants && !isSelected ? 0.7 : 1}
                  >
                    <Text
                      className={cn(
                        "text-[15px] font-barlow-medium",
                        isSelected ? "text-foreground" : "text-muted-foreground",
                      )}
                      numberOfLines={1}
                    >
                      {isSelected && `${posIdx + 1}. `}{route.name}
                    </Text>
                    <Text className="text-[12px] text-muted-foreground font-barlow-sc-medium mt-0.5">
                      {formatDistance(route.totalDistanceMeters, units)}
                      {"  ·  "}
                      ↑ {formatElevation(route.totalAscentMeters, units)}
                    </Text>
                  </TouchableOpacity>

                  {/* Remove button */}
                  {isSelected && (
                    <TouchableOpacity
                      className="w-[48px] h-[48px] items-center justify-center"
                      onPress={() => onRemove(route.id)}
                      hitSlop={4}
                    >
                      <X size={16} color={colors.destructive} />
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}

            {hasVariants && (
              <View className="flex-row items-center ml-12 mb-1">
                <Text className="text-[11px] text-muted-foreground font-barlow-medium">
                  {group.variants.length} variants
                </Text>
              </View>
            )}
          </View>
        </ScaleDecorator>
      );
    },
    [localGroups, colors, units, onSelectVariant, onRemove],
  );

  if (localGroups.length === 0) {
    return (
      <View className="items-center py-6">
        <Text className="text-[15px] text-muted-foreground">
          No segments added yet
        </Text>
      </View>
    );
  }

  return (
    <View>
      <NestableDraggableFlatList
        data={localGroups}
        keyExtractor={(item) => item.key}
        renderItem={renderItem}
        onDragEnd={handleDragEnd}
      />
      {hasOrderChanged && (
        <Button
          className="mt-2"
          onPress={handleSaveOrder}
          disabled={isSaving}
          label={isSaving ? "Saving..." : "Save Order"}
        />
      )}
    </View>
  );
}
