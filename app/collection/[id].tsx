import React, { useEffect, useState, useMemo, useCallback, useRef } from "react";
import {
  View,
  useWindowDimensions,
  ActivityIndicator,
  Alert,
} from "react-native";
import { NestableScrollContainer } from "react-native-draggable-flatlist";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { Camera, MapView as MapboxMapView } from "@rnmapbox/maps";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { useThemeColors } from "@/theme";
import { useCollectionStore } from "@/store/collectionStore";
import { useRouteStore } from "@/store/routeStore";
import { useSettingsStore } from "@/store/settingsStore";
import type { Collection, CollectionSegmentWithRoute, StitchedCollection } from "@/types";
import { useMapStyle } from "@/hooks/useMapStyle";
import { formatDistance, formatElevation } from "@/utils/formatters";
import { computeBounds } from "@/utils/geo";
import { stitchCollection } from "@/services/stitchingService";
import ElevationProfile from "@/components/elevation/ElevationProfile";
import RouteLayer from "@/components/map/RouteLayer";
import StatBox from "@/components/common/StatBox";
import SegmentList from "@/components/collection/SegmentList";
import AddSegmentSheet from "@/components/collection/AddSegmentSheet";
import CollectionOfflineSection from "@/components/collection/CollectionOfflineSection";

export default function CollectionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { width: screenWidth } = useWindowDimensions();
  const cameraRef = useRef<Camera>(null);
  const colors = useThemeColors();
  const mapStyle = useMapStyle();

  const [collection, setCollection] = useState<Collection | null>(null);
  const [segmentsWithRoutes, setSegmentsWithRoutes] = useState<CollectionSegmentWithRoute[]>([]);
  const [stitched, setStitched] = useState<StitchedCollection | null>(null);
  const [loading, setLoading] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [showAddSheet, setShowAddSheet] = useState(false);

  const collections = useCollectionStore((s) => s.collections);
  const getCollectionSegmentsWithRoutes = useCollectionStore((s) => s.getCollectionSegmentsWithRoutes);
  const addSegment = useCollectionStore((s) => s.addSegment);
  const removeSegment = useCollectionStore((s) => s.removeSegment);
  const selectVariant = useCollectionStore((s) => s.selectVariant);
  const setActiveCollection = useCollectionStore((s) => s.setActiveCollection);
  const deleteCollection = useCollectionStore((s) => s.deleteCollection);
  const visibleRoutePoints = useRouteStore((s) => s.visibleRoutePoints);
  const units = useSettingsStore((s) => s.units);

  const loadData = useCallback(async () => {
    if (!id) return;
    const collectionData = collections.find((c) => c.id === id);
    setCollection(collectionData ?? null);

    const segs = await getCollectionSegmentsWithRoutes(id);
    setSegmentsWithRoutes(segs);

    if (segs.length > 0) {
      try {
        const s = await stitchCollection(id);
        // Also load points for unselected variants (for ETA display)
        const { getRoutePoints } = await import("@/db/database");
        const unselectedRouteIds = segs
          .filter((sw) => !sw.segment.isSelected && !s.pointsByRouteId[sw.route.id])
          .map((sw) => sw.route.id);
        const unselectedPoints = await Promise.all(
          unselectedRouteIds.map((rid) => getRoutePoints(rid)),
        );
        for (let i = 0; i < unselectedRouteIds.length; i++) {
          s.pointsByRouteId[unselectedRouteIds[i]] = unselectedPoints[i];
        }
        setStitched(s);
        // Inject per-segment points for mini map RouteLayer rendering
        const { useRouteStore } = await import("@/store/routeStore");
        const currentPoints = { ...useRouteStore.getState().visibleRoutePoints };
        for (const [routeId, points] of Object.entries(s.pointsByRouteId)) {
          currentPoints[routeId] = points;
        }
        useRouteStore.setState({ visibleRoutePoints: currentPoints });
      } catch {
        setStitched(null);
      }
    } else {
      setStitched(null);
    }
    setLoading(false);
  }, [id, collections, getCollectionSegmentsWithRoutes]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const bounds = useMemo(() => {
    if (!stitched?.points.length) return null;
    return computeBounds(stitched.points);
  }, [stitched]);

  // Fit mini map camera when bounds change (defaultSettings only applies on mount)
  useEffect(() => {
    if (!bounds) return;
    cameraRef.current?.setCamera({
      bounds: {
        ne: bounds.ne,
        sw: bounds.sw,
        paddingLeft: 40,
        paddingRight: 40,
        paddingTop: 40,
        paddingBottom: 40,
      },
      animationDuration: 300,
    });
  }, [bounds]);

  // Get route points for each selected segment (for mini map RouteLayer)
  const selectedSegmentRoutes = useMemo(() => {
    return segmentsWithRoutes
      .filter((sw) => sw.segment.isSelected)
      .map((sw) => sw.route);
  }, [segmentsWithRoutes]);

  const existingRouteIds = useMemo(
    () => new Set(segmentsWithRoutes.map((sw) => sw.route.id)),
    [segmentsWithRoutes],
  );

  const handleAddSegment = useCallback(async (routeId: string) => {
    if (!id) return;
    setShowAddSheet(false);
    setIsBusy(true);
    await addSegment(id, routeId);
    await loadData();
    setIsBusy(false);
  }, [id, addSegment, loadData]);

  const handleRemoveSegment = useCallback(async (routeId: string) => {
    if (!id) return;
    Alert.alert(
      "Remove Segment",
      "Remove this segment from the collection?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            setIsBusy(true);
            await removeSegment(id, routeId);
            await loadData();
            setIsBusy(false);
          },
        },
      ],
    );
  }, [id, removeSegment, loadData]);

  const handleSelectVariant = useCallback(async (routeId: string) => {
    if (!id) return;
    setIsBusy(true);
    await selectVariant(id, routeId);
    await loadData();
    setIsBusy(false);
  }, [id, selectVariant, loadData]);

  const handleReorder = useCallback(async (positions: { routeId: string; position: number }[]) => {
    if (!id) return;
    setIsBusy(true);
    const { updateSegmentPositions } = await import("@/db/database");
    await updateSegmentPositions(id, positions);
    await loadData();
    setIsBusy(false);
  }, [id, loadData]);

  const handleSetActive = useCallback(async () => {
    if (!id) return;
    setIsBusy(true);
    await setActiveCollection(id);
    setIsBusy(false);
  }, [id, setActiveCollection]);

  const handleDelete = useCallback(() => {
    if (!id || !collection) return;
    Alert.alert(
      "Delete Collection",
      `Delete "${collection.name}"? Routes will not be deleted.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            await deleteCollection(id);
            router.back();
          },
        },
      ],
    );
  }, [id, collection, deleteCollection, router]);

  // Segment boundaries for elevation profile
  const segmentBoundaries = useMemo(() => {
    if (!stitched?.segments || stitched.segments.length <= 1) return undefined;
    return stitched.segments.slice(1).map((seg) => ({
      distanceMeters: seg.distanceOffsetMeters,
      label: seg.routeName,
    }));
  }, [stitched]);

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

  const chartWidth = screenWidth - 32;
  const chartHeight = 220;

  return (
    <>
      <Stack.Screen options={{ title: collection.name }} />
      <NestableScrollContainer
        className="flex-1 bg-background"
        contentContainerStyle={{ paddingBottom: 48 }}
      >
        {/* Mini map */}
        {selectedSegmentRoutes.length > 0 && (
          <View className="h-[250px] mx-4 mt-4 rounded-xl overflow-hidden">
            <MapboxMapView
              style={{ flex: 1 }}
              {...mapStyle.props}
              compassEnabled={false}
              scaleBarEnabled={false}
              rotateEnabled={false}
              scrollEnabled={true}
              zoomEnabled={true}
            >
              <Camera
                ref={cameraRef}
                defaultSettings={
                  bounds
                    ? {
                        bounds: {
                          ne: bounds.ne,
                          sw: bounds.sw,
                          paddingLeft: 40,
                          paddingRight: 40,
                          paddingTop: 40,
                          paddingBottom: 40,
                        },
                      }
                    : undefined
                }
              />
              {selectedSegmentRoutes.map((route) => {
                const points = visibleRoutePoints[route.id];
                if (!points) return null;
                return (
                  <RouteLayer
                    key={`${route.id}-${mapStyle.styleKey}`}
                    route={{ ...route, isActive: true }}
                    points={points}
                  />
                );
              })}
            </MapboxMapView>
          </View>
        )}

        {/* Stats */}
        {stitched && (
          <View className="flex-row px-4 mt-3 mb-3 gap-3">
            <StatBox
              label="Distance"
              value={formatDistance(stitched.totalDistanceMeters, units)}
            />
            <StatBox
              label="Ascent"
              value={"↑ " + formatElevation(stitched.totalAscentMeters, units)}
            />
            <StatBox
              label="Descent"
              value={"↓ " + formatElevation(stitched.totalDescentMeters, units)}
            />
          </View>
        )}

        {/* Segments */}
        <Text className="text-[22px] font-barlow-semibold text-foreground px-4 mt-2 mb-3">
          Segments
        </Text>
        <View className="px-4">
          <SegmentList
            segmentsWithRoutes={segmentsWithRoutes}
            pointsByRouteId={stitched?.pointsByRouteId ?? {}}
            onSelectVariant={handleSelectVariant}
            onReorder={handleReorder}
            onRemove={handleRemoveSegment}
          />
        </View>

        <View className="px-4 mt-3">
          <Button
            variant="secondary"
            onPress={() => setShowAddSheet(true)}
            label="Add Segment"
          />
        </View>

        {/* Elevation Profile */}
        {stitched && stitched.points.length > 0 && (
          <>
            <Text className="text-[22px] font-barlow-semibold text-foreground px-4 mt-4 mb-3">
              Elevation Profile
            </Text>
            <View className="mx-4 rounded-xl overflow-hidden bg-surface">
              <ElevationProfile
                points={stitched.points}
                units={units}
                width={chartWidth}
                height={chartHeight}
                segmentBoundaries={segmentBoundaries}
              />
            </View>
          </>
        )}

        {/* Offline */}
        {stitched && stitched.segments.length > 0 && (
          <CollectionOfflineSection stitched={stitched} />
        )}

        {/* Actions */}
        <View className="px-4 mt-6 gap-3">
          <Button
            onPress={handleSetActive}
            disabled={collection.isActive || segmentsWithRoutes.length === 0}
            label={collection.isActive ? "Active" : "Set Active"}
          />
          <Button
            variant="destructive"
            onPress={handleDelete}
            label="Delete Collection"
          />
        </View>
      </NestableScrollContainer>

      <AddSegmentSheet
        visible={showAddSheet}
        onClose={() => setShowAddSheet(false)}
        onAdd={handleAddSegment}
        existingRouteIds={existingRouteIds}
      />

      {isBusy && (
        <View className="absolute inset-0 items-center justify-center z-40 bg-background/60">
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      )}
    </>
  );
}
