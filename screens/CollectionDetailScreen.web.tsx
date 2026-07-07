import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import StatBox from "@/components/common/StatBox";
import { useThemeColors } from "@/theme";
import { useCollectionStore } from "@/store/collectionStore";
import { useSettingsStore } from "@/store/settingsStore";
import {
  getStitchedSourceRouteIds,
  sliceRoutePointsByDistance,
  stitchCollection,
} from "@/services/stitchingService";
import { formatDistance, formatElevation } from "@/utils/formatters";
import type {
  Collection,
  CollectionSegmentWithRoute,
  Route,
  RoutePoint,
  StitchedCollection,
} from "@/types";
import RoutePreviewMap, { type RoutePreviewMapLayer } from "@/components/map/RoutePreviewMap";

function formatPlannedStart(plannedStartMs: number | null): string {
  if (plannedStartMs == null) return "Not set";
  return new Date(plannedStartMs).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface VariantRouteOverlay {
  route: Route;
  points: RoutePoint[];
}

export default function CollectionDetailWebScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const colors = useThemeColors();
  const units = useSettingsStore((s) => s.units);
  const loadCollectionMetadata = useCollectionStore((s) => s.loadCollectionMetadata);
  const getCollectionSegmentsWithRoutes = useCollectionStore(
    (s) => s.getCollectionSegmentsWithRoutes,
  );
  const setActiveCollection = useCollectionStore((s) => s.setActiveCollection);
  const [collection, setCollection] = useState<Collection | null>(null);
  const [segments, setSegments] = useState<CollectionSegmentWithRoute[]>([]);
  const [stitched, setStitched] = useState<StitchedCollection | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function loadData() {
      if (!id) return;
      setLoading(true);
      try {
        await loadCollectionMetadata();
        const current = useCollectionStore.getState().collections.find((item) => item.id === id);
        const segmentRows = await getCollectionSegmentsWithRoutes(id);
        let stitchedData: StitchedCollection | null = null;
        try {
          stitchedData = segmentRows.length > 0 ? await stitchCollection(id) : null;
          if (stitchedData) {
            const { getRoutePoints } = await import("@/db/database");
            const stitchedSourceRouteIds = new Set(
              getStitchedSourceRouteIds(stitchedData.segments),
            );
            const unselectedRouteIds = segmentRows
              .filter(
                (segment) =>
                  !segment.segment.isSelected && !stitchedData?.pointsByRouteId[segment.route.id],
              )
              .map((segment) => segment.route.id);
            for (const routeId of stitchedSourceRouteIds) {
              if (!stitchedData.pointsByRouteId[routeId] && !unselectedRouteIds.includes(routeId)) {
                unselectedRouteIds.push(routeId);
              }
            }
            const unselectedPoints = await Promise.all(
              unselectedRouteIds.map((routeId) => getRoutePoints(routeId)),
            );
            for (let i = 0; i < unselectedRouteIds.length; i++) {
              stitchedData.pointsByRouteId[unselectedRouteIds[i]] = unselectedPoints[i];
            }
          }
        } catch {}
        if (!cancelled) {
          setCollection(current ?? null);
          setSegments(segmentRows);
          setStitched(stitchedData);
        }
      } catch (error) {
        console.warn("Failed to load collection detail:", error);
        if (!cancelled) {
          setCollection(null);
          setSegments([]);
          setStitched(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadData();
    return () => {
      cancelled = true;
    };
  }, [id, loadCollectionMetadata, getCollectionSegmentsWithRoutes]);

  const screenOptions = useMemo(
    () => ({ title: collection?.name ?? "Collection" }),
    [collection?.name],
  );

  const selectedSegments = useMemo(
    () => segments.filter((segment) => segment.segment.isSelected),
    [segments],
  );

  const variantRouteOverlays = useMemo<VariantRouteOverlay[]>(() => {
    if (!stitched) return [];
    const selectedByPosition = new Map<number, CollectionSegmentWithRoute>();
    for (const segment of segments) {
      if (segment.segment.isSelected) selectedByPosition.set(segment.segment.position, segment);
    }
    return segments
      .filter((segment) => !segment.segment.isSelected)
      .map((segment) => {
        const rawPoints = stitched.pointsByRouteId[segment.route.id] ?? null;
        const selectedVariant = selectedByPosition.get(segment.segment.position);
        const points =
          rawPoints &&
          segment.segment.variantKind === "full" &&
          selectedVariant?.segment.variantKind === "patch" &&
          selectedVariant.segment.baseRouteId === segment.route.id &&
          selectedVariant.segment.replaceStartDistanceMeters != null &&
          selectedVariant.segment.replaceEndDistanceMeters != null
            ? sliceRoutePointsByDistance(
                rawPoints,
                selectedVariant.segment.replaceStartDistanceMeters,
                selectedVariant.segment.replaceEndDistanceMeters,
              )
            : rawPoints;
        if (!points || points.length < 2) return null;
        return {
          route: {
            ...segment.route,
            id: `variant-${segment.route.id}`,
            isActive: false,
            isVisible: true,
          },
          points,
        };
      })
      .filter((overlay): overlay is VariantRouteOverlay => overlay != null);
  }, [segments, stitched]);

  const selectedRouteLayerId = useMemo(
    () => (collection ? `collection-${collection.id}` : "collection"),
    [collection],
  );

  const previewLayers = useMemo<RoutePreviewMapLayer[]>(() => {
    const layers = variantRouteOverlays.map((overlay) => ({
      id: overlay.route.id,
      cacheKey: overlay.route.id,
      points: overlay.points,
      isActive: false,
    }));
    if (stitched?.points.length) {
      layers.push({
        id: selectedRouteLayerId,
        cacheKey: selectedRouteLayerId,
        points: stitched.points,
        isActive: true,
      });
    }
    return layers;
  }, [selectedRouteLayerId, stitched?.points, variantRouteOverlays]);

  const handleOpenOnMap = useCallback(async () => {
    if (!collection) return;
    await setActiveCollection(collection.id);
    router.replace("/");
  }, [collection, router, setActiveCollection]);

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  if (!collection) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <Text className="text-[17px] text-muted-foreground">Collection not found</Text>
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={screenOptions} />
      <ScrollView className="flex-1 bg-background" contentContainerStyle={{ padding: 16, gap: 16 }}>
        <View className="gap-2">
          <Text className="text-[28px] font-barlow-semibold text-foreground">
            {collection.name}
          </Text>
          <Text className="text-[15px] font-barlow text-muted-foreground">
            Start: {formatPlannedStart(collection.plannedStartMs)}
          </Text>
        </View>

        {previewLayers.length > 0 && (
          <View className="overflow-hidden rounded-xl" style={{ height: 250 }}>
            <RoutePreviewMap layers={previewLayers} />
          </View>
        )}

        <View className="flex-row gap-3">
          <StatBox
            label="Distance"
            value={formatDistance(stitched?.totalDistanceMeters ?? 0, units)}
          />
          <StatBox
            label="Ascent"
            value={formatElevation(stitched?.totalAscentMeters ?? 0, units)}
          />
          <StatBox label="Segments" value={String(selectedSegments.length)} />
        </View>

        <Button className="min-h-[52px]" onPress={handleOpenOnMap}>
          <Text className="font-barlow-semibold text-primary-foreground">Open on map</Text>
        </Button>
      </ScrollView>
    </>
  );
}
