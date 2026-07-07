import React, { useEffect, useState, useMemo, useCallback } from "react";
import {
  View,
  useWindowDimensions,
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
} from "react-native";
import { NestableScrollContainer } from "react-native-draggable-flatlist";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { DateTimePicker } from "@expo/ui/datetimepicker";
import { CalendarClock, Share2 } from "lucide-react-native";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { useThemeColors } from "@/theme";
import { useCollectionStore } from "@/store/collectionStore";
import { useSettingsStore } from "@/store/settingsStore";
import { useClimbStore } from "@/store/climbStore";
import { usePoiStore } from "@/store/poiStore";
import type {
  Collection,
  CollectionSegmentWithRoute,
  POI,
  Route,
  RoutePoint,
  StitchedCollection,
} from "@/types";
import { formatDistance, formatElevation } from "@/utils/formatters";
import {
  getStitchedSourceRouteIds,
  isPatchVariantProposalPoorMatch,
  proposePatchVariantFromPoints,
  sliceRoutePointsByDistance,
  stitchCollection,
  stitchPOIs,
} from "@/services/stitchingService";
import ElevationProfile from "@/components/elevation/ElevationProfile";
import RoutePreviewMap, { type RoutePreviewMapLayer } from "@/components/map/RoutePreviewMap";
import StatBox from "@/components/common/StatBox";
import SegmentList from "@/components/collection/SegmentList";
import AddSegmentSheet from "@/components/collection/AddSegmentSheet";
import CollectionOfflineSection from "@/components/collection/CollectionOfflineSection";
import AddSavedPOISheet from "@/components/poi/AddSavedPOISheet";
import type { SavedPOITarget } from "@/services/savedPOIService";
import { serializeCollectionToGPX } from "@/services/gpxSerializer";
import { shareGPXFile } from "@/utils/gpxExportShare";

function formatPlannedStart(plannedStartMs: number | null): string {
  if (plannedStartMs == null) return "Not set";
  const date = new Date(plannedStartMs);
  return date.toLocaleString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface PatchBaseSelection {
  routeId: string;
  routeName: string;
  position: number;
}

interface VariantRouteOverlay {
  route: Route;
  points: RoutePoint[];
}

export default function CollectionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { width: screenWidth } = useWindowDimensions();
  const colors = useThemeColors();

  const [collection, setCollection] = useState<Collection | null>(null);
  const [segmentsWithRoutes, setSegmentsWithRoutes] = useState<CollectionSegmentWithRoute[]>([]);
  const [stitched, setStitched] = useState<StitchedCollection | null>(null);
  const [loading, setLoading] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [showAddSheet, setShowAddSheet] = useState(false);
  const [patchBaseSelection, setPatchBaseSelection] = useState<PatchBaseSelection | null>(null);
  const [showAddPOI, setShowAddPOI] = useState(false);
  const [showStartSheet, setShowStartSheet] = useState(false);
  const [startDraftDate, setStartDraftDate] = useState(() => new Date());

  const collections = useCollectionStore((s) => s.collections);
  const getCollectionSegmentsWithRoutes = useCollectionStore(
    (s) => s.getCollectionSegmentsWithRoutes,
  );
  const addSegment = useCollectionStore((s) => s.addSegment);
  const addPatchVariant = useCollectionStore((s) => s.addPatchVariant);
  const removeSegment = useCollectionStore((s) => s.removeSegment);
  const selectVariant = useCollectionStore((s) => s.selectVariant);
  const setActiveCollection = useCollectionStore((s) => s.setActiveCollection);
  const updateCollectionPlannedStart = useCollectionStore((s) => s.updateCollectionPlannedStart);
  const deleteCollection = useCollectionStore((s) => s.deleteCollection);
  const units = useSettingsStore((s) => s.units);
  const loadPOIs = usePoiStore((s) => s.loadPOIs);
  const poisByRouteId = usePoiStore((s) => s.pois);
  const starredPOIIds = usePoiStore((s) => s.starredPOIIds);
  const setSelectedPOI = usePoiStore((s) => s.setSelectedPOI);

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
        const stitchedSourceRouteIds = new Set(getStitchedSourceRouteIds(s.segments));
        const unselectedRouteIds = segs
          .filter((sw) => !sw.segment.isSelected && !s.pointsByRouteId[sw.route.id])
          .map((sw) => sw.route.id);
        for (const routeId of stitchedSourceRouteIds) {
          if (!s.pointsByRouteId[routeId] && !unselectedRouteIds.includes(routeId)) {
            unselectedRouteIds.push(routeId);
          }
        }
        const unselectedPoints = await Promise.all(
          unselectedRouteIds.map((rid) => getRoutePoints(rid)),
        );
        for (let i = 0; i < unselectedRouteIds.length; i++) {
          s.pointsByRouteId[unselectedRouteIds[i]] = unselectedPoints[i];
        }
        setStitched(s);
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

  const screenOptions = useMemo(
    () => ({ title: collection?.name ?? "Collection" }),
    [collection?.name],
  );

  const variantRouteOverlays = useMemo<VariantRouteOverlay[]>(() => {
    if (!stitched) return [];
    const selectedByPosition = new Map<number, CollectionSegmentWithRoute>();
    for (const sw of segmentsWithRoutes) {
      if (sw.segment.isSelected) selectedByPosition.set(sw.segment.position, sw);
    }
    return segmentsWithRoutes
      .filter((sw) => !sw.segment.isSelected)
      .map((sw) => {
        const rawPoints = stitched.pointsByRouteId[sw.route.id] ?? null;
        const selectedVariant = selectedByPosition.get(sw.segment.position);
        const points =
          rawPoints &&
          sw.segment.variantKind === "full" &&
          selectedVariant?.segment.variantKind === "patch" &&
          selectedVariant.segment.baseRouteId === sw.route.id &&
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
            ...sw.route,
            id: `variant-${sw.route.id}`,
            isActive: false,
            isVisible: true,
          },
          points,
        };
      })
      .filter((overlay): overlay is VariantRouteOverlay => overlay != null);
  }, [segmentsWithRoutes, stitched]);

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

  const resolvedSegmentPointsByRouteId = useMemo(() => {
    const out: Record<string, RoutePoint[]> = {};
    if (!stitched) return out;
    for (const segment of stitched.segments) {
      const points = stitched.points
        .slice(segment.startPointIndex, segment.endPointIndex + 1)
        .map((point, idx) =>
          Object.assign({}, point, {
            idx,
            distanceFromStartMeters: point.distanceFromStartMeters - segment.distanceOffsetMeters,
          }),
        );
      out[segment.routeId] = points;
    }
    return out;
  }, [stitched]);

  const existingRouteIds = useMemo(
    () => new Set(segmentsWithRoutes.map((sw) => sw.route.id)),
    [segmentsWithRoutes],
  );

  const handleCloseAddSheet = useCallback(() => {
    setShowAddSheet(false);
    setPatchBaseSelection(null);
  }, []);

  const handleOpenAddSegment = useCallback(() => {
    setPatchBaseSelection(null);
    setShowAddSheet(true);
  }, []);

  const handleOpenPatchVariant = useCallback(
    (baseRouteId: string, position: number) => {
      const base = segmentsWithRoutes.find(
        (sw) => sw.route.id === baseRouteId && sw.segment.variantKind === "full",
      );
      if (!base) {
        Alert.alert("Patch Variant Failed", "Could not find the base segment for this position.");
        return;
      }
      setPatchBaseSelection({ routeId: baseRouteId, routeName: base.route.name, position });
      setShowAddSheet(true);
    },
    [segmentsWithRoutes],
  );

  const handleAddSegment = useCallback(
    async (routeId: string) => {
      if (!id) return;
      setShowAddSheet(false);
      setPatchBaseSelection(null);
      setIsBusy(true);
      await addSegment(id, routeId);
      await loadData();
      setIsBusy(false);
    },
    [id, addSegment, loadData],
  );

  const handleAddPatchVariant = useCallback(
    async (routeId: string, baseRouteId: string, position: number) => {
      if (!id) return;
      setShowAddSheet(false);
      setPatchBaseSelection(null);
      setIsBusy(true);
      try {
        const { getRouteWithPoints } = await import("@/db/database");
        const [baseRoute, patchRoute] = await Promise.all([
          getRouteWithPoints(baseRouteId),
          getRouteWithPoints(routeId),
        ]);
        if (!baseRoute || !patchRoute) {
          Alert.alert("Patch Variant Failed", "Could not load both route geometries.");
          return;
        }

        const proposal = proposePatchVariantFromPoints(
          baseRoute.id,
          patchRoute.id,
          baseRoute.points,
          patchRoute.points,
        );
        if (!proposal) {
          Alert.alert("Patch Variant Failed", "Could not match this route onto the base segment.");
          return;
        }
        if (proposal.isReversed) {
          Alert.alert(
            "Patch Variant Reversed",
            "This route snaps onto the base segment in the opposite direction. Reverse the route before adding it as a patch variant.",
          );
          return;
        }

        const warning = isPatchVariantProposalPoorMatch(proposal)
          ? "\n\nReview carefully: one or both endpoints are far from the base route."
          : "";
        Alert.alert(
          "Add Patch Variant?",
          `${patchRoute.name} will replace ${formatDistance(
            proposal.replaceStartDistanceMeters,
            units,
          )}-${formatDistance(proposal.replaceEndDistanceMeters, units)} of ${
            baseRoute.name
          }.${warning}`,
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Add Variant",
              onPress: async () => {
                setIsBusy(true);
                await addPatchVariant(
                  id,
                  routeId,
                  baseRouteId,
                  position,
                  proposal.replaceStartDistanceMeters,
                  proposal.replaceEndDistanceMeters,
                );
                await loadData();
                setIsBusy(false);
              },
            },
          ],
        );
      } finally {
        setIsBusy(false);
      }
    },
    [id, addPatchVariant, loadData, units],
  );

  const handleAddRouteFromSheet = useCallback(
    async (routeId: string) => {
      if (patchBaseSelection) {
        await handleAddPatchVariant(
          routeId,
          patchBaseSelection.routeId,
          patchBaseSelection.position,
        );
        return;
      }
      await handleAddSegment(routeId);
    },
    [handleAddPatchVariant, handleAddSegment, patchBaseSelection],
  );

  const handleRemoveSegment = useCallback(
    async (routeId: string) => {
      if (!id) return;
      Alert.alert("Remove Segment", "Remove this segment from the collection?", [
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
      ]);
    },
    [id, removeSegment, loadData],
  );

  const handleSelectVariant = useCallback(
    async (routeId: string) => {
      if (!id) return;
      setIsBusy(true);
      await selectVariant(id, routeId);
      await loadData();
      setIsBusy(false);
    },
    [id, selectVariant, loadData],
  );

  const handleReorder = useCallback(
    async (positions: { routeId: string; position: number }[]) => {
      if (!id) return;
      setIsBusy(true);
      const { updateSegmentPositions } = await import("@/db/database");
      await updateSegmentPositions(id, positions);
      await loadData();
      setIsBusy(false);
    },
    [id, loadData],
  );

  const handleSetActive = useCallback(async () => {
    if (!id) return;
    setIsBusy(true);
    await setActiveCollection(id);
    setIsBusy(false);
  }, [id, setActiveCollection]);

  const openStartSheet = useCallback(() => {
    setStartDraftDate(new Date(collection?.plannedStartMs ?? Date.now()));
    setShowStartSheet(true);
  }, [collection?.plannedStartMs]);

  const handleSavePlannedStart = useCallback(async () => {
    if (!id) return;
    const plannedStartMs = startDraftDate.getTime();
    setIsBusy(true);
    try {
      await updateCollectionPlannedStart(id, plannedStartMs);
      setCollection((current) => (current?.id === id ? { ...current, plannedStartMs } : current));
      setShowStartSheet(false);
    } finally {
      setIsBusy(false);
    }
  }, [id, startDraftDate, updateCollectionPlannedStart]);

  const handleClearPlannedStart = useCallback(async () => {
    if (!id) return;
    setIsBusy(true);
    try {
      await updateCollectionPlannedStart(id, null);
      setCollection((current) =>
        current?.id === id ? { ...current, plannedStartMs: null } : current,
      );
      setShowStartSheet(false);
    } finally {
      setIsBusy(false);
    }
  }, [id, updateCollectionPlannedStart]);

  const handleDelete = useCallback(() => {
    if (!id || !collection) return;
    Alert.alert("Delete Collection", `Delete "${collection.name}"? Routes will not be deleted.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          await deleteCollection(id);
          router.back();
        },
      },
    ]);
  }, [id, collection, deleteCollection, router]);

  // Load climbs for all segments
  const loadClimbs = useClimbStore((s) => s.loadClimbs);
  const getClimbsForDisplay = useClimbStore((s) => s.getClimbsForDisplay);
  const allClimbs = useClimbStore((s) => s.climbs);

  useEffect(() => {
    if (stitched) {
      for (const routeId of getStitchedSourceRouteIds(stitched.segments)) {
        loadClimbs(routeId);
        loadPOIs(routeId);
      }
    }
  }, [stitched, loadClimbs, loadPOIs]);

  const collectionClimbs = useMemo(() => {
    if (!stitched) return [];
    const routeIds = getStitchedSourceRouteIds(stitched.segments);
    return getClimbsForDisplay(routeIds, stitched.segments);
    // allClimbs is a reactivity trigger: getClimbsForDisplay reads store via get() and is not itself reactive
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stitched, getClimbsForDisplay, allClimbs]);

  const collectionPOIs = useMemo(() => {
    if (!stitched) return [];
    const poisByRoute: Record<string, POI[]> = {};
    for (const routeId of getStitchedSourceRouteIds(stitched.segments)) {
      poisByRoute[routeId] = (poisByRouteId[routeId] ?? []).filter((poi) =>
        starredPOIIds.has(poi.id),
      );
    }
    return stitchPOIs(stitched.segments, poisByRoute);
  }, [stitched, poisByRouteId, starredPOIIds]);

  const handleExportGPX = useCallback(async () => {
    if (!collection || !stitched) return;
    setIsExporting(true);
    try {
      const gpx = serializeCollectionToGPX(collection.name, stitched, {
        poisAsWaypoints: collectionPOIs,
      });
      await shareGPXFile(gpx, collection.name);
    } catch {
      Alert.alert("Export Failed", "Could not export this collection as GPX.");
    } finally {
      setIsExporting(false);
    }
  }, [collection, stitched, collectionPOIs]);

  const savedPOITargets = useMemo<SavedPOITarget[]>(() => {
    if (!stitched) return [];
    return stitched.sourceSpans
      .map((span) => {
        const points = sliceRoutePointsByDistance(
          stitched.pointsByRouteId[span.routeId] ?? [],
          span.rawStartDistanceMeters,
          span.rawEndDistanceMeters,
        );
        return {
          routeId: span.routeId,
          routeName: span.routeName,
          points,
        };
      })
      .filter((target) => target.points.length > 0);
  }, [stitched]);

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
      <Stack.Screen options={screenOptions} />
      <NestableScrollContainer
        className="flex-1 bg-background"
        contentContainerStyle={{ paddingBottom: 48 }}
      >
        {/* Mini map */}
        {previewLayers.length > 0 && (
          <View className="mx-4 mt-4 rounded-xl overflow-hidden" style={{ height: 250 }}>
            <RoutePreviewMap layers={previewLayers} />
          </View>
        )}

        {/* Stats */}
        {stitched && (
          <View className="flex-row px-4 mt-3 mb-3 gap-3">
            <StatBox label="Distance" value={formatDistance(stitched.totalDistanceMeters, units)} />
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

        <View className="mx-4 mb-3 rounded-lg border border-border bg-card px-3 py-3">
          <View className="flex-row items-center">
            <View className="h-10 w-10 rounded-full bg-muted items-center justify-center mr-3">
              <CalendarClock size={20} color={colors.accent} />
            </View>
            <View className="flex-1 min-w-0">
              <Text className="text-[12px] font-barlow-medium text-muted-foreground">
                Race Start
              </Text>
              <Text className="text-[17px] font-barlow-semibold text-foreground" numberOfLines={1}>
                {formatPlannedStart(collection.plannedStartMs)}
              </Text>
            </View>
            <Button
              variant="secondary"
              onPress={openStartSheet}
              label={collection.plannedStartMs == null ? "Set" : "Edit"}
              className="h-12 px-4"
            />
          </View>
        </View>

        {/* Segments */}
        <Text className="text-[22px] font-barlow-semibold text-foreground px-4 mt-2 mb-3">
          Segments
        </Text>
        <View className="px-4">
          <SegmentList
            segmentsWithRoutes={segmentsWithRoutes}
            pointsByRouteId={stitched?.pointsByRouteId ?? {}}
            resolvedPointsByRouteId={resolvedSegmentPointsByRouteId}
            stitchedSegments={stitched?.segments}
            onSelectVariant={handleSelectVariant}
            onAddPatchVariant={handleOpenPatchVariant}
            onReorder={handleReorder}
            onRemove={handleRemoveSegment}
          />
        </View>

        <View className="px-4 mt-3">
          <Button variant="secondary" onPress={handleOpenAddSegment} label="Add Segment" />
        </View>

        {stitched && stitched.segments.length > 0 && (
          <View className="px-4 mt-3 gap-3">
            <Button variant="secondary" onPress={() => setShowAddPOI(true)} label="Add POI" />
            <Button variant="secondary" onPress={handleExportGPX} disabled={isExporting}>
              <Share2 size={18} color={colors.accent} />
              <Text className="ml-2 text-primary font-barlow-semibold text-[15px]">
                {isExporting ? "Exporting..." : "Export GPX"}
              </Text>
            </Button>
          </View>
        )}

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
                climbs={collectionClimbs}
                pois={collectionPOIs}
                onPOIPress={setSelectedPOI}
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
          <Button variant="destructive" onPress={handleDelete} label="Delete Collection" />
        </View>
      </NestableScrollContainer>

      <AddSegmentSheet
        visible={showAddSheet}
        title={patchBaseSelection ? "Add Patch Variant" : "Add Segment"}
        subtitle={patchBaseSelection ? `Base: ${patchBaseSelection.routeName}` : undefined}
        onClose={handleCloseAddSheet}
        onAdd={handleAddRouteFromSheet}
        existingRouteIds={existingRouteIds}
      />

      <AddSavedPOISheet
        visible={showAddPOI}
        targets={savedPOITargets}
        onClose={() => setShowAddPOI(false)}
      />

      <Modal
        visible={showStartSheet}
        transparent
        animationType="fade"
        onRequestClose={() => setShowStartSheet(false)}
      >
        <Pressable
          className="flex-1 justify-end bg-black/40"
          onPress={() => setShowStartSheet(false)}
        >
          <Pressable className="rounded-t-2xl bg-surface px-4 pt-4 pb-8">
            <View className="items-center pb-3">
              <View
                className="rounded-full"
                style={{
                  width: 32,
                  height: 4,
                  backgroundColor: colors.textTertiary,
                  opacity: 0.5,
                }}
              />
            </View>
            <Text className="text-[22px] font-barlow-semibold text-foreground">Race Start</Text>
            <Text className="mt-1 text-[13px] font-barlow-medium text-muted-foreground">
              Local start date and time.
            </Text>
            <View className="mt-3 overflow-hidden rounded-lg border border-border bg-card">
              <DateTimePicker
                value={startDraftDate}
                mode="datetime"
                display="spinner"
                presentation="inline"
                accentColor={colors.accent}
                onValueChange={(_event, date) => setStartDraftDate(date)}
                style={{ minHeight: Platform.OS === "android" ? 320 : 216 }}
              />
            </View>
            <Text className="mt-2 text-[13px] font-barlow-medium text-muted-foreground">
              {formatPlannedStart(startDraftDate.getTime())}
            </Text>
            <View className="mt-4 flex-row gap-2">
              <Button
                variant="secondary"
                label="Clear"
                onPress={handleClearPlannedStart}
                className="h-12 flex-1"
              />
              <Button
                variant="secondary"
                label="Cancel"
                onPress={() => setShowStartSheet(false)}
                className="h-12 flex-1"
              />
              <Button label="Save" onPress={handleSavePlannedStart} className="h-12 flex-1" />
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {isBusy && (
        <View className="absolute inset-0 items-center justify-center z-40 bg-background/60">
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      )}
    </>
  );
}
