import React, { useEffect, useState, useMemo, useCallback, useRef } from "react";
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
import { buildCollectionSegmentProfileBoundaries } from "@/utils/collectionSegmentDisplay";
import { measureSync } from "@/utils/perfMarks";
import { yieldToUI } from "@/utils/yieldToUI";

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return fallback;
}

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

interface CollectionDetailData {
  collection: Collection | null;
  segmentsWithRoutes: CollectionSegmentWithRoute[];
  stitched: StitchedCollection | null;
}

export default function CollectionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { width: screenWidth } = useWindowDimensions();
  const colors = useThemeColors();

  const [detailData, setDetailData] = useState<CollectionDetailData>({
    collection: null,
    segmentsWithRoutes: [],
    stitched: null,
  });
  const { collection, segmentsWithRoutes, stitched } = detailData;
  const [initialLoadStage, setInitialLoadStage] = useState<string | null>("Loading collection…");
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [showAddSheet, setShowAddSheet] = useState(false);
  const [patchBaseSelection, setPatchBaseSelection] = useState<PatchBaseSelection | null>(null);
  const [showAddPOI, setShowAddPOI] = useState(false);
  const [showStartSheet, setShowStartSheet] = useState(false);
  const [startDraftDate, setStartDraftDate] = useState(() => new Date());
  const loadGenerationRef = useRef(0);
  const busyOperationRef = useRef(false);

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

  const loadData = useCallback(
    async (showInitialStages = false) => {
      const generation = ++loadGenerationRef.current;
      const isCurrent = () => loadGenerationRef.current === generation;
      if (!id) {
        if (showInitialStages && isCurrent()) setInitialLoadStage(null);
        return;
      }

      const setStage = (stage: string) => {
        if (showInitialStages && isCurrent()) setInitialLoadStage(stage);
      };

      try {
        setStage("Loading collection…");
        const { getAllCollections, getRoutePoints } = await import("@/db/database");
        const collectionData = (await getAllCollections()).find((candidate) => candidate.id === id);
        if (!isCurrent()) return;
        if (!collectionData) {
          setDetailData({ collection: null, segmentsWithRoutes: [], stitched: null });
          return;
        }

        setStage("Loading segments…");
        const segs = await getCollectionSegmentsWithRoutes(id);
        if (!isCurrent()) return;

        if (segs.length === 0) {
          setDetailData({ collection: collectionData, segmentsWithRoutes: segs, stitched: null });
          return;
        }

        setStage("Building collection route…");
        const nextStitched = await stitchCollection(id);
        if (!isCurrent()) return;

        setStage("Loading route variants…");
        // Selected raw arrays are retained by stitching and reused directly for
        // segment metrics. Only missing/unselected variant geometry is loaded here.
        const stitchedSourceRouteIds = new Set(getStitchedSourceRouteIds(nextStitched.segments));
        const missingRouteIds = segs
          .filter((sw) => !sw.segment.isSelected && !nextStitched.pointsByRouteId[sw.route.id])
          .map((sw) => sw.route.id);
        for (const routeId of stitchedSourceRouteIds) {
          if (!nextStitched.pointsByRouteId[routeId] && !missingRouteIds.includes(routeId)) {
            missingRouteIds.push(routeId);
          }
        }
        const missingPoints = await Promise.all(
          missingRouteIds.map((routeId) => getRoutePoints(routeId)),
        );
        if (!isCurrent()) return;
        for (let index = 0; index < missingRouteIds.length; index++) {
          nextStitched.pointsByRouteId[missingRouteIds[index]] = missingPoints[index];
        }
        setDetailData({
          collection: collectionData,
          segmentsWithRoutes: segs,
          stitched: nextStitched,
        });
      } catch (error) {
        if (isCurrent()) throw error;
      } finally {
        if (showInitialStages && isCurrent()) setInitialLoadStage(null);
      }
    },
    [id, getCollectionSegmentsWithRoutes],
  );

  useEffect(() => {
    let cancelled = false;
    const generationRef = loadGenerationRef;
    const loadPromise = loadData(true);
    const generation = generationRef.current;
    void loadPromise.catch((error: unknown) => {
      if (cancelled || generationRef.current !== generation) return;
      setDetailData({ collection: null, segmentsWithRoutes: [], stitched: null });
      Alert.alert(
        "Collection Load Failed",
        getErrorMessage(error, "Could not load this collection."),
      );
    });
    return () => {
      cancelled = true;
      generationRef.current++;
    };
  }, [loadData]);

  const runBusyOperation = useCallback(
    async <T,>(
      label: string,
      operation: () => Promise<T>,
      errorTitle = "Collection Update Failed",
      fallbackMessage = "Could not update this collection.",
    ): Promise<T | undefined> => {
      if (busyOperationRef.current) return undefined;
      busyOperationRef.current = true;
      setBusyLabel(label);
      try {
        await yieldToUI();
        return await operation();
      } catch (error: unknown) {
        Alert.alert(errorTitle, getErrorMessage(error, fallbackMessage));
        return undefined;
      } finally {
        busyOperationRef.current = false;
        setBusyLabel(null);
      }
    },
    [],
  );

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
      await runBusyOperation(
        "Adding segment…",
        async () => {
          await addSegment(id, routeId);
          await loadData();
        },
        "Add Segment Failed",
        "Could not add this segment.",
      );
    },
    [id, addSegment, loadData, runBusyOperation],
  );

  const handleAddPatchVariant = useCallback(
    async (routeId: string, baseRouteId: string, position: number) => {
      if (!id) return;
      setShowAddSheet(false);
      setPatchBaseSelection(null);
      const patchCheck = await runBusyOperation(
        "Checking patch variant…",
        async () => {
          const { getRouteWithPoints } = await import("@/db/database");
          const [baseRoute, patchRoute] = await Promise.all([
            getRouteWithPoints(baseRouteId),
            getRouteWithPoints(routeId),
          ]);
          const proposal =
            baseRoute && patchRoute
              ? measureSync("collection.proposePatchVariant", () =>
                  proposePatchVariantFromPoints(
                    baseRoute.id,
                    patchRoute.id,
                    baseRoute.points,
                    patchRoute.points,
                  ),
                )
              : null;
          return { baseRoute, patchRoute, proposal };
        },
        "Patch Variant Failed",
        "Could not load both route geometries.",
      );
      if (!patchCheck) return;
      const { baseRoute, patchRoute, proposal } = patchCheck;
      if (!baseRoute || !patchRoute) {
        Alert.alert("Patch Variant Failed", "Could not load both route geometries.");
        return;
      }
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
        )}-${formatDistance(proposal.replaceEndDistanceMeters, units)} of ${baseRoute.name}.${warning}`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Add Variant",
            onPress: () => {
              void runBusyOperation(
                "Adding patch variant…",
                async () => {
                  await addPatchVariant(
                    id,
                    routeId,
                    baseRouteId,
                    position,
                    proposal.replaceStartDistanceMeters,
                    proposal.replaceEndDistanceMeters,
                  );
                  await loadData();
                },
                "Patch Variant Failed",
                "Could not add this patch variant.",
              );
            },
          },
        ],
      );
    },
    [id, addPatchVariant, loadData, runBusyOperation, units],
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
          onPress: () => {
            void runBusyOperation(
              "Removing segment…",
              async () => {
                await removeSegment(id, routeId);
                await loadData();
              },
              "Remove Segment Failed",
              "Could not remove this segment.",
            );
          },
        },
      ]);
    },
    [id, removeSegment, loadData, runBusyOperation],
  );

  const handleSelectVariant = useCallback(
    async (routeId: string) => {
      if (!id) return;
      await runBusyOperation(
        "Switching variant…",
        async () => {
          await selectVariant(id, routeId);
          await loadData();
        },
        "Switch Variant Failed",
        "Could not switch to this route variant.",
      );
    },
    [id, selectVariant, loadData, runBusyOperation],
  );

  const handleReorder = useCallback(
    async (positions: { routeId: string; position: number }[]) => {
      if (!id) return;
      await runBusyOperation(
        "Saving segment order…",
        async () => {
          const { updateSegmentPositions } = await import("@/db/database");
          await updateSegmentPositions(id, positions);
          await loadData();
        },
        "Reorder Failed",
        "Could not save the segment order.",
      );
    },
    [id, loadData, runBusyOperation],
  );

  const handleSetActive = useCallback(async () => {
    if (!id) return;
    await runBusyOperation(
      "Activating collection…",
      async () => {
        await setActiveCollection(id);
        setDetailData((current) => {
          if (current.collection?.id !== id) return current;
          return {
            ...current,
            collection: { ...current.collection, isActive: true },
          };
        });
      },
      "Activation Failed",
      "Could not activate this collection.",
    );
  }, [id, runBusyOperation, setActiveCollection]);

  const openStartSheet = useCallback(() => {
    setStartDraftDate(new Date(collection?.plannedStartMs ?? Date.now()));
    setShowStartSheet(true);
  }, [collection?.plannedStartMs]);

  const handleSavePlannedStart = useCallback(async () => {
    if (!id) return;
    const plannedStartMs = startDraftDate.getTime();
    await runBusyOperation(
      "Saving race start…",
      async () => {
        await updateCollectionPlannedStart(id, plannedStartMs);
        setDetailData((current) => {
          if (current.collection?.id !== id) return current;
          return {
            ...current,
            collection: { ...current.collection, plannedStartMs },
          };
        });
        setShowStartSheet(false);
      },
      "Save Failed",
      "Could not save the race start.",
    );
  }, [id, runBusyOperation, startDraftDate, updateCollectionPlannedStart]);

  const handleClearPlannedStart = useCallback(async () => {
    if (!id) return;
    await runBusyOperation(
      "Clearing race start…",
      async () => {
        await updateCollectionPlannedStart(id, null);
        setDetailData((current) => {
          if (current.collection?.id !== id) return current;
          return {
            ...current,
            collection: { ...current.collection, plannedStartMs: null },
          };
        });
        setShowStartSheet(false);
      },
      "Clear Failed",
      "Could not clear the race start.",
    );
  }, [id, runBusyOperation, updateCollectionPlannedStart]);

  const handleDelete = useCallback(() => {
    if (!id || !collection) return;
    Alert.alert("Delete Collection", `Delete "${collection.name}"? Routes will not be deleted.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          void runBusyOperation(
            "Deleting collection…",
            async () => {
              await deleteCollection(id);
              router.back();
            },
            "Delete Failed",
            "Could not delete this collection.",
          );
        },
      },
    ]);
  }, [id, collection, deleteCollection, router, runBusyOperation]);

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
      await yieldToUI();
      const gpx = measureSync("gpx.serializeCollection", () =>
        serializeCollectionToGPX(collection.name, stitched, {
          poisAsWaypoints: collectionPOIs,
        }),
      );
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

  const segmentBoundaries = useMemo(() => {
    return buildCollectionSegmentProfileBoundaries(stitched?.segments);
  }, [stitched?.segments]);

  if (initialLoadStage) {
    return (
      <View
        className="flex-1 items-center justify-center bg-background px-6"
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={initialLoadStage}
      >
        <ActivityIndicator size="large" color={colors.accent} />
        <Text className="mt-3 text-center text-[15px] font-barlow-medium text-muted-foreground">
          {initialLoadStage}
        </Text>
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
            pointsByRouteId={stitched?.pointsByRouteId}
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
        onRequestClose={() => {
          if (!busyLabel) setShowStartSheet(false);
        }}
      >
        <Pressable
          className="flex-1 justify-end bg-black/40"
          onPress={() => {
            if (!busyLabel) setShowStartSheet(false);
          }}
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
            {busyLabel && (
              <View
                className="mt-3 flex-row items-center gap-2 rounded-lg bg-muted px-3 py-2"
                accessible
                accessibilityRole="progressbar"
                accessibilityLabel={busyLabel}
              >
                <ActivityIndicator size="small" color={colors.accent} />
                <Text className="text-[13px] font-barlow-medium text-foreground">{busyLabel}</Text>
              </View>
            )}
            <View className="mt-4 flex-row gap-2">
              <Button
                variant="secondary"
                label="Clear"
                onPress={handleClearPlannedStart}
                disabled={busyLabel != null}
                className="h-12 flex-1"
              />
              <Button
                variant="secondary"
                label="Cancel"
                onPress={() => setShowStartSheet(false)}
                disabled={busyLabel != null}
                className="h-12 flex-1"
              />
              <Button
                label="Save"
                onPress={handleSavePlannedStart}
                disabled={busyLabel != null}
                className="h-12 flex-1"
              />
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {busyLabel && (
        <View
          className="absolute inset-0 items-center justify-center z-40 bg-background/70 px-6"
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel={busyLabel}
        >
          <ActivityIndicator size="large" color={colors.accent} />
          <Text className="mt-3 text-center text-[15px] font-barlow-semibold text-foreground">
            {busyLabel}
          </Text>
        </View>
      )}
    </>
  );
}
