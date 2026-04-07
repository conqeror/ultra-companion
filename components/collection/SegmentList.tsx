import React, { useState, useEffect, useMemo, useCallback } from "react";
import { View, TouchableOpacity } from "react-native";
import {
  NestableDraggableFlatList,
  ScaleDecorator,
  RenderItemParams,
} from "react-native-draggable-flatlist";
import { Text } from "@/components/ui/text";
import { GripVertical, X, ChevronRight } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { useThemeColors } from "@/theme";
import { useRouter } from "expo-router";
import { useSettingsStore } from "@/store/settingsStore";
import { useEtaStore } from "@/store/etaStore";
import { computeRouteETA } from "@/services/etaCalculator";
import { formatDistance, formatElevation, formatDuration } from "@/utils/formatters";
import type { CollectionSegmentWithRoute, RoutePoint } from "@/types";

/** A position slot: one or more variants grouped together */
interface PositionGroup {
  key: string;
  position: number;
  variants: CollectionSegmentWithRoute[];
}

interface SegmentListProps {
  segmentsWithRoutes: CollectionSegmentWithRoute[];
  pointsByRouteId: Record<string, RoutePoint[]>;
  onSelectVariant: (routeId: string) => void;
  onReorder: (orderedPositions: { routeId: string; position: number }[]) => Promise<void>;
  onRemove: (routeId: string) => void;
}

function groupByPosition(segments: CollectionSegmentWithRoute[]): PositionGroup[] {
  const map = new Map<number, CollectionSegmentWithRoute[]>();
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

function useSegmentTime(points: RoutePoint[] | undefined): number | null {
  const powerConfig = useEtaStore((s) => s.powerConfig);
  return useMemo(() => {
    if (!points || points.length < 2) return null;
    const cumulative = computeRouteETA(points, powerConfig);
    return cumulative[cumulative.length - 1];
  }, [points, powerConfig]);
}

/** Single segment row — shows name, stats, and riding time */
function SegmentRow({
  sw,
  isSelected,
  hasVariants,
  posIdx,
  points,
  drag,
  onSelect,
  onRemove,
}: {
  sw: CollectionSegmentWithRoute;
  isSelected: boolean;
  hasVariants: boolean;
  posIdx: number;
  points: RoutePoint[] | undefined;
  drag?: () => void;
  onSelect: () => void;
  onRemove: () => void;
}) {
  const colors = useThemeColors();
  const units = useSettingsStore((s) => s.units);
  const router = useRouter();
  const ridingTime = useSegmentTime(points);

  return (
    <View
      className={cn(
        "flex-row items-center py-3 px-3 rounded-lg",
        isSelected ? "bg-muted" : "bg-transparent",
      )}
    >
      {/* Left: drag handle or radio button */}
      {isSelected && drag ? (
        <TouchableOpacity
          onLongPress={drag}
          delayLongPress={150}
          className="w-[48px] h-[48px] items-center justify-center -ml-2"
        >
          <GripVertical size={20} color={colors.textTertiary} />
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          className="w-[48px] h-[48px] items-center justify-center -ml-2"
          onPress={onSelect}
          disabled={isSelected || !hasVariants}
        >
          <View
            className="w-[18px] h-[18px] rounded-full border-2 items-center justify-center"
            style={{ borderColor: isSelected ? colors.accent : colors.textTertiary }}
          >
            {isSelected && (
              <View
                className="w-[10px] h-[10px] rounded-full"
                style={{ backgroundColor: colors.accent }}
              />
            )}
          </View>
        </TouchableOpacity>
      )}

      {/* Center: segment info — tap to open route detail */}
      <TouchableOpacity
        className="flex-1 mr-2"
        onPress={() => router.push(`/route/${sw.route.id}`)}
        activeOpacity={0.7}
      >
        <Text
          className={cn(
            "text-[15px] font-barlow-medium",
            isSelected ? "text-foreground" : "text-muted-foreground",
          )}
          numberOfLines={1}
        >
          {!hasVariants && `${posIdx + 1}. `}{sw.route.name}
        </Text>
        <Text className="text-[12px] text-muted-foreground font-barlow-sc-medium mt-0.5">
          {formatDistance(sw.route.totalDistanceMeters, units)}
          {"  ·  "}
          ↑ {formatElevation(sw.route.totalAscentMeters, units)}
          {ridingTime != null && (
            <>{"  ·  "}{formatDuration(ridingTime)}</>
          )}
        </Text>
      </TouchableOpacity>

      {/* Right: chevron + remove */}
      <TouchableOpacity
        className="w-[36px] h-[48px] items-center justify-center"
        onPress={() => router.push(`/route/${sw.route.id}`)}
      >
        <ChevronRight size={18} color={colors.textTertiary} />
      </TouchableOpacity>
      {(isSelected || hasVariants) && (
        <TouchableOpacity
          className="w-[48px] h-[48px] items-center justify-center"
          onPress={onRemove}
          hitSlop={4}
        >
          <X size={16} color={colors.destructive} />
        </TouchableOpacity>
      )}
    </View>
  );
}

export default function SegmentList({
  segmentsWithRoutes,
  pointsByRouteId,
  onSelectVariant,
  onReorder,
  onRemove,
}: SegmentListProps) {
  const colors = useThemeColors();

  // Local order state for drag reordering
  const serverGroups = useMemo(() => groupByPosition(segmentsWithRoutes), [segmentsWithRoutes]);
  const [localGroups, setLocalGroups] = useState<PositionGroup[]>(serverGroups);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setLocalGroups(serverGroups);
  }, [serverGroups]);

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
    ({ item: group, drag, isActive: isDragging }: RenderItemParams<PositionGroup>) => {
      const posIdx = localGroups.indexOf(group);
      const hasVariants = group.variants.length > 1;

      return (
        <ScaleDecorator>
          <View
            className="mb-2"
            style={isDragging ? { backgroundColor: colors.surfaceRaised, borderRadius: 12, opacity: 0.9 } : undefined}
          >
            {hasVariants && (
              <Text className="text-[11px] text-muted-foreground font-barlow-semibold uppercase tracking-wide ml-1 mb-1">
                {posIdx + 1}. Choose variant
              </Text>
            )}

            {hasVariants ? (
              <View
                className="rounded-xl overflow-hidden border border-border"
              >
                {group.variants.map((sw, vIdx) => {
                  const isSelected = sw.segment.isSelected;
                  return (
                    <View key={sw.route.id}>
                      {vIdx > 0 && (
                        <View className="mx-3" style={{ height: 1, backgroundColor: colors.border }} />
                      )}
                      <SegmentRow
                        sw={sw}
                        isSelected={isSelected}
                        hasVariants
                        posIdx={posIdx}
                        points={pointsByRouteId[sw.route.id]}
                        onSelect={() => onSelectVariant(sw.route.id)}
                        onRemove={() => onRemove(sw.route.id)}
                      />
                    </View>
                  );
                })}
              </View>
            ) : (
              group.variants.map((sw) => (
                <SegmentRow
                  key={sw.route.id}
                  sw={sw}
                  isSelected={sw.segment.isSelected}
                  hasVariants={false}
                  posIdx={posIdx}
                  points={pointsByRouteId[sw.route.id]}
                  drag={drag}
                  onSelect={() => {}}
                  onRemove={() => onRemove(sw.route.id)}
                />
              ))
            )}
          </View>
        </ScaleDecorator>
      );
    },
    [localGroups, colors, pointsByRouteId, onSelectVariant, onRemove],
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
