import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { View, TouchableOpacity } from "react-native";
import {
  NestableDraggableFlatList,
  ScaleDecorator,
  RenderItemParams,
} from "react-native-draggable-flatlist";
import { Text } from "@/components/ui/text";
import { GripVertical, X, ChevronRight, Plus } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { useThemeColors } from "@/theme";
import { useRouter } from "expo-router";
import { useSettingsStore } from "@/store/settingsStore";
import { useEtaStore } from "@/store/etaStore";
import { computeRouteTotalETA } from "@/services/etaCalculator";
import { buildPatchVariantRoutePoints, routeEndDistance } from "@/services/stitchingService";
import { formatDistance, formatElevation, formatDuration } from "@/utils/formatters";
import { computeSliceAscentFromDistance } from "@/utils/geo";
import type {
  CollectionSegmentWithRoute,
  PowerModelConfig,
  RoutePoint,
  StitchedSegmentInfo,
  UnitSystem,
} from "@/types";

/** A position slot: one or more variants grouped together */
interface PositionGroup {
  key: string;
  position: number;
  variants: CollectionSegmentWithRoute[];
}

interface SegmentTimeCacheEntry {
  points: RoutePoint[];
  configKey: string;
  ridingTime: number | null;
}

interface SegmentMetrics {
  distanceMeters: number;
  ascentMeters: number;
  ridingTime: number | null;
  points: RoutePoint[] | null;
}

interface VariantDiff {
  distanceMeters: number;
  ascentMeters: number;
  ridingTime: number | null;
}

function powerConfigCacheKey(config: PowerModelConfig): string {
  return [
    config.powerWatts,
    config.totalMassKg,
    config.cda,
    config.crr,
    config.airDensity,
    config.maxDescentSpeedKmh,
    config.drivetrainEfficiency,
  ].join(":");
}

function buildPatchVariantPoints(
  sw: CollectionSegmentWithRoute,
  pointsByRouteId: Record<string, RoutePoint[]>,
): RoutePoint[] | null {
  const { baseRouteId, replaceStartDistanceMeters, replaceEndDistanceMeters } = sw.segment;
  if (
    sw.segment.variantKind !== "patch" ||
    !baseRouteId ||
    replaceStartDistanceMeters == null ||
    replaceEndDistanceMeters == null
  ) {
    return null;
  }

  const basePoints = pointsByRouteId[baseRouteId];
  const patchPoints = pointsByRouteId[sw.route.id];
  if (!basePoints || !patchPoints || basePoints.length < 2 || patchPoints.length < 2) return null;

  const out = buildPatchVariantRoutePoints(
    basePoints,
    patchPoints,
    replaceStartDistanceMeters,
    replaceEndDistanceMeters,
  );
  return out.length >= 2 ? out : null;
}

function getSegmentMetricPoints(
  sw: CollectionSegmentWithRoute,
  pointsByRouteId: Record<string, RoutePoint[]>,
  resolvedPointsByRouteId: Record<string, RoutePoint[]>,
): RoutePoint[] | null {
  const resolved = resolvedPointsByRouteId[sw.route.id];
  if (resolved?.length >= 2) return resolved;
  if (sw.segment.variantKind === "patch") return buildPatchVariantPoints(sw, pointsByRouteId);
  return pointsByRouteId[sw.route.id] ?? null;
}

function getSegmentDistanceMeters(sw: CollectionSegmentWithRoute, points: RoutePoint[] | null) {
  if (points?.length) return routeEndDistance(points);
  const { replaceStartDistanceMeters, replaceEndDistanceMeters } = sw.segment;
  if (
    sw.segment.variantKind === "patch" &&
    sw.baseRoute &&
    replaceStartDistanceMeters != null &&
    replaceEndDistanceMeters != null
  ) {
    return (
      replaceStartDistanceMeters +
      sw.route.totalDistanceMeters +
      Math.max(0, sw.baseRoute.totalDistanceMeters - replaceEndDistanceMeters)
    );
  }
  return sw.route.totalDistanceMeters;
}

function getSegmentAscentMeters(
  sw: CollectionSegmentWithRoute,
  pointsByRouteId: Record<string, RoutePoint[]>,
) {
  const { baseRouteId, replaceStartDistanceMeters, replaceEndDistanceMeters } = sw.segment;
  if (
    sw.segment.variantKind === "patch" &&
    baseRouteId &&
    replaceStartDistanceMeters != null &&
    replaceEndDistanceMeters != null
  ) {
    const basePoints = pointsByRouteId[baseRouteId];
    if (basePoints?.length) {
      const baseEnd = routeEndDistance(basePoints);
      return (
        computeSliceAscentFromDistance(basePoints, 0, replaceStartDistanceMeters) +
        sw.route.totalAscentMeters +
        computeSliceAscentFromDistance(basePoints, replaceEndDistanceMeters, baseEnd)
      );
    }
  }
  return sw.route.totalAscentMeters;
}

function formatSignedDistanceDelta(deltaMeters: number, units: UnitSystem) {
  if (Math.abs(deltaMeters) < 1) return "±0 m";
  return `${deltaMeters > 0 ? "+" : "-"}${formatDistance(Math.abs(deltaMeters), units)}`;
}

function formatSignedElevationDelta(deltaMeters: number, units: UnitSystem) {
  if (Math.abs(deltaMeters) < 1) return "±0 m";
  return `${deltaMeters > 0 ? "+" : "-"}${formatElevation(Math.abs(deltaMeters), units)}`;
}

function formatSignedDurationDelta(deltaSeconds: number | null) {
  if (deltaSeconds == null) return null;
  if (Math.abs(deltaSeconds) < 30) return "±0m";
  return `${deltaSeconds > 0 ? "+" : "-"}${formatDuration(Math.abs(deltaSeconds))}`;
}

interface SegmentListProps {
  segmentsWithRoutes: CollectionSegmentWithRoute[];
  pointsByRouteId: Record<string, RoutePoint[]>;
  resolvedPointsByRouteId?: Record<string, RoutePoint[]>;
  stitchedSegments?: StitchedSegmentInfo[];
  onSelectVariant: (routeId: string) => void;
  onAddPatchVariant: (baseRouteId: string, position: number) => void;
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

/** Single segment row — shows name, stats, and riding time */
function SegmentRow({
  sw,
  isSelected,
  hasVariants,
  posIdx,
  ridingTime,
  stitchedInfo,
  variantDiff,
  drag,
  onSelect,
  onRemove,
}: {
  sw: CollectionSegmentWithRoute;
  isSelected: boolean;
  hasVariants: boolean;
  posIdx: number;
  ridingTime: number | null;
  stitchedInfo?: StitchedSegmentInfo;
  variantDiff?: VariantDiff;
  drag?: () => void;
  onSelect: () => void;
  onRemove: () => void;
}) {
  const colors = useThemeColors();
  const units = useSettingsStore((s) => s.units);
  const router = useRouter();
  const displayDistanceMeters = stitchedInfo?.segmentDistanceMeters ?? sw.route.totalDistanceMeters;
  const displayAscentMeters = stitchedInfo?.segmentAscentMeters ?? sw.route.totalAscentMeters;
  const etaDiff = variantDiff ? formatSignedDurationDelta(variantDiff.ridingTime) : null;
  const variantDiffText = variantDiff
    ? [
        etaDiff ? `ETA ${etaDiff}` : null,
        `Dist ${formatSignedDistanceDelta(variantDiff.distanceMeters, units)}`,
        `Gain ${formatSignedElevationDelta(variantDiff.ascentMeters, units)}`,
      ]
        .filter(Boolean)
        .join("  ·  ")
    : null;
  const patchContext =
    sw.segment.variantKind === "patch" &&
    sw.segment.replaceStartDistanceMeters != null &&
    sw.segment.replaceEndDistanceMeters != null
      ? `replaces ${formatDistance(sw.segment.replaceStartDistanceMeters, units)}-${formatDistance(
          sw.segment.replaceEndDistanceMeters,
          units,
        )}${sw.baseRoute ? ` of ${sw.baseRoute.name}` : ""}`
      : null;

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
          {!hasVariants && `${posIdx + 1}. `}
          {sw.route.name}
        </Text>
        {hasVariants && variantDiffText ? (
          <Text className="text-[12px] text-muted-foreground font-barlow-sc-medium mt-0.5">
            {variantDiffText}
          </Text>
        ) : (
          <Text className="text-[12px] text-muted-foreground font-barlow-sc-medium mt-0.5">
            {formatDistance(displayDistanceMeters, units)}
            {"  ·  "}↑ {formatElevation(displayAscentMeters, units)}
            {ridingTime != null && (
              <>
                {"  ·  "}
                {formatDuration(ridingTime)}
              </>
            )}
          </Text>
        )}
        {patchContext && (
          <Text
            className="text-[12px] text-muted-foreground font-barlow-medium mt-0.5"
            numberOfLines={1}
          >
            {patchContext}
          </Text>
        )}
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
  resolvedPointsByRouteId = {},
  stitchedSegments = [],
  onSelectVariant,
  onAddPatchVariant,
  onReorder,
  onRemove,
}: SegmentListProps) {
  const colors = useThemeColors();
  const powerConfig = useEtaStore((s) => s.powerConfig);
  const segmentTimeCacheRef = useRef(new Map<string, SegmentTimeCacheEntry>());

  // Local order state for drag reordering
  const serverGroups = useMemo(() => groupByPosition(segmentsWithRoutes), [segmentsWithRoutes]);
  const [localGroups, setLocalGroups] = useState<PositionGroup[]>(serverGroups);
  const [isSaving, setIsSaving] = useState(false);
  const stitchedInfoByRouteId = useMemo(() => {
    const out: Record<string, StitchedSegmentInfo> = {};
    for (const segment of stitchedSegments) {
      out[segment.routeId] = segment;
    }
    return out;
  }, [stitchedSegments]);

  const powerConfigKey = useMemo(() => powerConfigCacheKey(powerConfig), [powerConfig]);
  const metricsByRouteId = useMemo(() => {
    const cache = segmentTimeCacheRef.current;
    const activeRouteIds = new Set<string>();
    const metrics: Record<string, SegmentMetrics> = {};

    for (const sw of segmentsWithRoutes) {
      const routeId = sw.route.id;
      if (routeId in metrics) continue;
      activeRouteIds.add(routeId);

      const points = getSegmentMetricPoints(sw, pointsByRouteId, resolvedPointsByRouteId);
      const distanceMeters = getSegmentDistanceMeters(sw, points);
      const ascentMeters = getSegmentAscentMeters(sw, pointsByRouteId);
      if (!points || points.length < 2) {
        metrics[routeId] = {
          distanceMeters,
          ascentMeters,
          ridingTime: null,
          points,
        };
        continue;
      }

      const cached = cache.get(routeId);
      if (cached?.points === points && cached.configKey === powerConfigKey) {
        metrics[routeId] = {
          distanceMeters,
          ascentMeters,
          ridingTime: cached.ridingTime,
          points,
        };
        continue;
      }

      const ridingTime = computeRouteTotalETA(points, powerConfig);
      cache.set(routeId, { points, configKey: powerConfigKey, ridingTime });
      metrics[routeId] = {
        distanceMeters,
        ascentMeters,
        ridingTime,
        points,
      };
    }

    for (const routeId of cache.keys()) {
      if (!activeRouteIds.has(routeId)) cache.delete(routeId);
    }

    return metrics;
  }, [segmentsWithRoutes, pointsByRouteId, resolvedPointsByRouteId, powerConfig, powerConfigKey]);

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
      const patchBaseVariant =
        group.variants.find((sw) => sw.segment.variantKind === "full" && sw.segment.isSelected) ??
        group.variants.find((sw) => sw.segment.variantKind === "full");
      const referenceVariant =
        patchBaseVariant ?? group.variants.find((sw) => sw.segment.isSelected) ?? group.variants[0];
      const referenceMetrics = referenceVariant
        ? metricsByRouteId[referenceVariant.route.id]
        : undefined;
      const getVariantDiff = (sw: CollectionSegmentWithRoute): VariantDiff | undefined => {
        const metrics = metricsByRouteId[sw.route.id];
        if (!referenceMetrics || !metrics) return undefined;
        return {
          distanceMeters: metrics.distanceMeters - referenceMetrics.distanceMeters,
          ascentMeters: metrics.ascentMeters - referenceMetrics.ascentMeters,
          ridingTime:
            metrics.ridingTime != null && referenceMetrics.ridingTime != null
              ? metrics.ridingTime - referenceMetrics.ridingTime
              : null,
        };
      };

      return (
        <ScaleDecorator>
          <View
            className="mb-2"
            style={
              isDragging
                ? { backgroundColor: colors.surfaceRaised, borderRadius: 12, opacity: 0.9 }
                : undefined
            }
          >
            {hasVariants && (
              <Text className="text-[11px] text-muted-foreground font-barlow-semibold uppercase tracking-wide ml-1 mb-1">
                {posIdx + 1}. Choose variant
              </Text>
            )}

            {hasVariants ? (
              <View className="rounded-xl overflow-hidden border border-border">
                {group.variants.map((sw, vIdx) => {
                  const isSelected = sw.segment.isSelected;
                  return (
                    <View key={sw.route.id}>
                      {vIdx > 0 && (
                        <View
                          className="mx-3"
                          style={{ height: 1, backgroundColor: colors.border }}
                        />
                      )}
                      <SegmentRow
                        sw={sw}
                        isSelected={isSelected}
                        hasVariants
                        posIdx={posIdx}
                        ridingTime={metricsByRouteId[sw.route.id]?.ridingTime ?? null}
                        stitchedInfo={isSelected ? stitchedInfoByRouteId[sw.route.id] : undefined}
                        variantDiff={
                          sw.route.id === referenceVariant?.route.id
                            ? undefined
                            : getVariantDiff(sw)
                        }
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
                  ridingTime={metricsByRouteId[sw.route.id]?.ridingTime ?? null}
                  stitchedInfo={
                    sw.segment.isSelected ? stitchedInfoByRouteId[sw.route.id] : undefined
                  }
                  drag={drag}
                  onSelect={() => {}}
                  onRemove={() => onRemove(sw.route.id)}
                />
              ))
            )}
            {patchBaseVariant && (
              <Button
                variant="secondary"
                className="mt-2 h-12 self-start px-3"
                onPress={() =>
                  onAddPatchVariant(patchBaseVariant.route.id, patchBaseVariant.segment.position)
                }
              >
                <Plus size={16} color={colors.accent} />
                <Text className="ml-2 text-[14px] font-barlow-semibold text-primary">
                  Add Patch Variant
                </Text>
              </Button>
            )}
          </View>
        </ScaleDecorator>
      );
    },
    [
      localGroups,
      colors,
      metricsByRouteId,
      stitchedInfoByRouteId,
      onSelectVariant,
      onAddPatchVariant,
      onRemove,
    ],
  );

  if (localGroups.length === 0) {
    return (
      <View className="items-center py-6">
        <Text className="text-[15px] text-muted-foreground">No segments added yet</Text>
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
