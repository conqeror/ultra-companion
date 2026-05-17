import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import StatBox from "@/components/common/StatBox";
import { useThemeColors } from "@/theme";
import { useCollectionStore } from "@/store/collectionStore";
import { useSettingsStore } from "@/store/settingsStore";
import { stitchCollection } from "@/services/stitchingService";
import { formatDistance, formatElevation } from "@/utils/formatters";
import type { Collection, CollectionSegmentWithRoute, StitchedCollection } from "@/types";

function formatPlannedStart(plannedStartMs: number | null): string {
  if (plannedStartMs == null) return "Not set";
  return new Date(plannedStartMs).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
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
