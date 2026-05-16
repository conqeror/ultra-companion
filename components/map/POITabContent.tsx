import React, { useDeferredValue, useEffect, useMemo, useRef, useState, useCallback } from "react";
import { FlashList, type FlashListRef, type ListRenderItem } from "@shopify/flash-list";
import {
  View,
  ScrollView,
  TouchableOpacity,
  TextInput as RNTextInput,
  Alert,
  Linking,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useShallow } from "zustand/react/shallow";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import {
  Star,
  MapPin,
  Clock,
  ChevronLeft,
  Phone,
  Search,
  Plus,
  ExternalLink,
} from "lucide-react-native";
import { useThemeColors } from "@/theme";
import { useSettingsStore } from "@/store/settingsStore";
import { useRouteStore } from "@/store/routeStore";
import { usePoiStore } from "@/store/poiStore";
import { usePanelStore } from "@/store/panelStore";
import { useEtaStore } from "@/store/etaStore";
import { POI_CATEGORIES, POI_BEHIND_THRESHOLD_M } from "@/constants";
import { POI_ICON_MAP } from "@/constants/poiIcons";
import { ohStatusColorKey } from "@/constants/poiHelpers";
import { formatDistance, formatDuration, formatETA } from "@/utils/formatters";
import {
  getDayScheduleForDate,
  getOpeningHoursStatus,
  isOpenAt,
} from "@/services/openingHoursParser";
import {
  departureTimeAfterPlannedStop,
  getPlannedStopDurationMinutes,
  plannedStopsFromPOIs,
} from "@/services/plannedStops";
import { toDisplayPOIForSegments } from "@/services/displayDistance";
import { displayPOIsForActiveRoute } from "@/services/activePOIs";
import { useActiveRouteTiming } from "@/hooks/useActiveRouteTiming";
import { resolveActiveRouteProgress } from "@/utils/routeProgress";
import { bucketDistanceForDerivedWork } from "@/utils/distanceBuckets";
import {
  createRidingHorizonWindow,
  ridingHorizonMetersForMode,
  ridingHorizonScopeLabelForMode,
} from "@/utils/ridingHorizon";
import { measureSync } from "@/utils/perfMarks";
import { pickRouteRecords } from "@/utils/routeScopedRecords";
import {
  buildCompactPOIRowModels,
  buildPOICategoryCounts,
  buildPOICategoryCountsFromPOIs,
  buildPOIListRowModels,
  buildVisiblePOIsForActiveRoute,
  type CompactPOIRowModel,
  type POIListRowModel,
} from "@/utils/poiListModels";
import POIFilterBar, { POISelectedFilterSummary } from "@/components/map/POIFilterBar";
import POIListItem from "@/components/poi/POIListItem";
import AddSavedPOISheet from "@/components/poi/AddSavedPOISheet";
import type { ActiveRouteData, DisplayPOI, POI, StitchedSegmentInfo } from "@/types";
import { getPOINotes, isGoogleDerivedPOI, type SavedPOITarget } from "@/services/savedPOIService";
import {
  buildPhoneUrl,
  getPoiAddress,
  getPoiExtraDetailFields,
  getPoiMapUrl,
  getPoiPhone,
  getPoiWebsiteUrl,
} from "@/utils/poiActions";

interface POITabContentProps {
  activeData: ActiveRouteData | null;
}

const EXPANDED_POI_CONTENT_STYLE = { paddingBottom: 8 };
const ALL_POI_CATEGORY_KEYS = POI_CATEGORIES.map((category) => category.key);

function poiKeyExtractor(item: { id: string }): string {
  return item.id;
}

export default function POITabContent({ activeData }: POITabContentProps) {
  const colors = useThemeColors();
  const { bottom: safeBottom } = useSafeAreaInsets();
  const units = useSettingsStore((s) => s.units);
  const snappedPosition = useRouteStore((s) => s.snappedPosition);
  const starredPOIIds = usePoiStore((s) => s.starredPOIIds);
  const selectedPOI = usePoiStore((s) => s.selectedPOI);
  const setSelectedPOI = usePoiStore((s) => s.setSelectedPOI);
  const enabledCategories = usePoiStore((s) => s.enabledCategories);
  const cumulativeTime = useEtaStore((s) => s.cumulativeTime);
  const isExpanded = usePanelStore((s) => s.isExpanded);
  const panelMode = usePanelStore((s) => s.panelMode);
  const consumeDetailReturnTab = usePanelStore((s) => s.consumeDetailReturnTab);

  const [searchQuery, setSearchQuery] = useState("");
  const [showAddPOI, setShowAddPOI] = useState(false);
  const [poiFiltersExpanded, setPOIFiltersExpanded] = useState(true);
  const [loadedSavedPOITargets, setLoadedSavedPOITargets] = useState<SavedPOITarget[] | null>(null);
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const expandedListRef = useRef<FlashListRef<POIListRowModel> | null>(null);

  const routeIds = useMemo(() => activeData?.routeIds ?? [], [activeData?.routeIds]);
  const routePoints = activeData?.points ?? null;
  const segments = activeData?.segments ?? null;
  const activeTotalDistance = activeData?.totalDistanceMeters;
  const routePois = usePoiStore(useShallow((s) => pickRouteRecords(s.pois, routeIds)));
  const timing = useActiveRouteTiming(activeData);
  const activeRouteProgress = useMemo(
    () =>
      resolveActiveRouteProgress(activeData, snappedPosition, {
        plannedStartMs: timing.plannedStartMs,
      }),
    [activeData, snappedPosition, timing.plannedStartMs],
  );
  const currentDist = activeRouteProgress?.distanceAlongRouteMeters ?? null;
  const derivedCurrentDist = bucketDistanceForDerivedWork(currentDist);
  const ridingHorizonMeters = ridingHorizonMetersForMode(panelMode);
  const horizonWindow = useMemo(
    () =>
      createRidingHorizonWindow(derivedCurrentDist, ridingHorizonMeters, {
        behindMeters: POI_BEHIND_THRESHOLD_M,
        totalDistanceMeters: activeTotalDistance,
      }),
    [derivedCurrentDist, ridingHorizonMeters, activeTotalDistance],
  );
  const horizonScopeLabel = ridingHorizonScopeLabelForMode(panelMode);

  const savedPOITargets = useMemo<SavedPOITarget[]>(() => {
    if (!activeData) return [];
    if (activeData.segments) {
      return activeData.segments
        .map((seg) => ({
          routeId: seg.routeId,
          routeName: seg.routeName,
          points: activeData.pointsByRouteId[seg.routeId] ?? [],
        }))
        .filter((target) => target.points.length > 0);
    }
    const routeId = activeData.routeIds[0];
    if (!routeId) return [];
    return [{ routeId, routeName: activeData.name, points: activeData.points }];
  }, [activeData]);
  const effectiveSavedPOITargets = loadedSavedPOITargets ?? savedPOITargets;

  useEffect(() => {
    setLoadedSavedPOITargets(null);
  }, [activeData?.id]);

  const routeCategoryCounts = useMemo(
    () => buildPOICategoryCounts(routePois, routeIds),
    [routePois, routeIds],
  );
  const totalPOICount = useMemo(
    () => Object.values(routeCategoryCounts).reduce((sum, count) => sum + (count ?? 0), 0),
    [routeCategoryCounts],
  );

  const activeDisplayPOIs = useMemo(
    () =>
      measureSync("poi.activeDisplayPOIs", () =>
        displayPOIsForActiveRoute(routeIds, segments, routePois),
      ),
    [routeIds, segments, routePois],
  );
  const plannedStops = useMemo(() => plannedStopsFromPOIs(activeDisplayPOIs), [activeDisplayPOIs]);

  const scopedPOIsForFilters = useMemo(
    () =>
      measureSync("poi.filterScope", () =>
        buildVisiblePOIsForActiveRoute({
          routeIds,
          segments,
          poisByRoute: routePois,
          horizonWindow,
          enabledCategories: ALL_POI_CATEGORY_KEYS,
          starredPOIIds,
        }),
      ),
    [routeIds, segments, routePois, horizonWindow, starredPOIIds],
  );
  const categoryCounts = useMemo(
    () => buildPOICategoryCountsFromPOIs(scopedPOIsForFilters),
    [scopedPOIsForFilters],
  );

  const visiblePOIs = useMemo(
    () =>
      measureSync("poi.visibleFiltered", () =>
        buildVisiblePOIsForActiveRoute({
          routeIds,
          segments,
          poisByRoute: routePois,
          horizonWindow,
          enabledCategories,
          starredPOIIds,
        }),
      ),
    [routeIds, segments, routePois, horizonWindow, enabledCategories, starredPOIIds],
  );

  const compactPOIModels = useMemo(
    () =>
      measureSync("poi.compactRows", () =>
        buildCompactPOIRowModels({
          pois: visiblePOIs,
          currentDistanceMeters: derivedCurrentDist,
          routePoints,
          cumulativeTime,
          plannedStops,
          etaStartTimeMs: timing.futureStartMs,
          starredPOIIds,
          units,
        }),
      ),
    [
      visiblePOIs,
      derivedCurrentDist,
      routePoints,
      cumulativeTime,
      plannedStops,
      timing.futureStartMs,
      starredPOIIds,
      units,
    ],
  );

  // --- Expanded: full POI list with search + filters ---
  const filteredPOIModels = useMemo(
    () =>
      measureSync("poi.expandedRows", () =>
        buildPOIListRowModels({
          pois: visiblePOIs,
          currentDistanceMeters: derivedCurrentDist,
          routePoints,
          cumulativeTime,
          plannedStops,
          etaStartTimeMs: timing.futureStartMs,
          starredPOIIds,
          units,
          searchQuery: deferredSearchQuery,
        }),
      ),
    [
      visiblePOIs,
      derivedCurrentDist,
      routePoints,
      cumulativeTime,
      plannedStops,
      timing.futureStartMs,
      starredPOIIds,
      units,
      deferredSearchQuery,
    ],
  );

  const handlePOIPress = useCallback(
    (poi: DisplayPOI) => {
      setSelectedPOI(poi);
    },
    [setSelectedPOI],
  );

  const handleBackFromDetail = useCallback(() => {
    const returnTab = consumeDetailReturnTab();
    setSelectedPOI(null);
    if (returnTab) usePanelStore.getState().setPanelTab(returnTab);
  }, [consumeDetailReturnTab, setSelectedPOI]);

  const openAddPOISheet = useCallback(async () => {
    if (!activeData) {
      Alert.alert("No Active Route", "Set an active route or collection before saving a POI.");
      return;
    }

    setSelectedPOI(null);

    if (!activeData?.segments || savedPOITargets.length > 0) {
      setLoadedSavedPOITargets(null);
      setShowAddPOI(true);
      return;
    }

    const { getRoutePoints } = await import("@/db/database");
    const targets = await Promise.all(
      activeData.segments.map(async (seg) => ({
        routeId: seg.routeId,
        routeName: seg.routeName,
        points: await getRoutePoints(seg.routeId),
      })),
    );
    setLoadedSavedPOITargets(targets.filter((target) => target.points.length > 0));
    setShowAddPOI(true);
  }, [activeData, savedPOITargets.length, setSelectedPOI]);

  const handleOpenAddPOI = useCallback(() => {
    openAddPOISheet();
  }, [openAddPOISheet]);

  const handleCloseAddPOI = useCallback(() => {
    setShowAddPOI(false);
  }, []);

  const handleSavedPOI = useCallback(
    (poi: POI) => {
      const displayPOI = toDisplayPOIForSegments(poi, segments);
      if (displayPOI) setSelectedPOI(displayPOI);
    },
    [segments, setSelectedPOI],
  );

  const renderExpandedPOI = useCallback<ListRenderItem<POIListRowModel>>(
    ({ item }) => <POIListItem model={item} onPress={handlePOIPress} />,
    [handlePOIPress],
  );

  const renderCompactPOI = useCallback<ListRenderItem<CompactPOIRowModel>>(
    ({ item }) => <POIListItem model={item} onPress={handlePOIPress} />,
    [handlePOIPress],
  );

  const handleExpandedListScrollBegin = useCallback(() => {
    setPOIFiltersExpanded(false);
  }, []);

  useEffect(() => {
    if (!isExpanded) return;
    expandedListRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, [activeData?.id, deferredSearchQuery, enabledCategories, isExpanded, panelMode]);

  useEffect(() => {
    if (isExpanded) setPOIFiltersExpanded(true);
  }, [activeData?.id, isExpanded]);

  // Show inline detail when a POI is selected
  if (selectedPOI) {
    return (
      <InlinePOIDetail
        poi={selectedPOI}
        segments={segments}
        currentDist={currentDist}
        onBack={handleBackFromDetail}
      />
    );
  }

  // Empty state — no POI data at all
  if (totalPOICount === 0) {
    return (
      <>
        <View className="flex-1 items-center justify-center px-4">
          <MapPin size={24} color={colors.textTertiary} />
          <Text className="text-[13px] text-muted-foreground font-barlow-medium mt-2">
            No POIs on this route
          </Text>
          <View className="mt-3 w-full max-w-[220px]">
            <Button
              variant="secondary"
              onPress={handleOpenAddPOI}
              disabled={!activeData}
              label="Add POI"
            />
          </View>
        </View>
        <AddSavedPOISheet
          visible={showAddPOI}
          targets={effectiveSavedPOITargets}
          onClose={handleCloseAddPOI}
          onSaved={handleSavedPOI}
        />
      </>
    );
  }

  // --- Expanded mode: full POI list with search + filters ---
  if (isExpanded) {
    const emptyTitle = searchQuery.trim()
      ? "No POIs match this search"
      : !horizonWindow
        ? "No POIs match active filters"
        : `No POIs in ${horizonScopeLabel}`;
    const emptyDetail = !horizonWindow
      ? "Category filters may still be hiding route POIs."
      : "Switch the riding horizon to FULL to inspect POIs outside this range.";

    return (
      <View className="flex-1">
        {/* Search */}
        <View
          className="px-3 py-1.5"
          style={{ borderBottomWidth: 1, borderBottomColor: colors.borderSubtle }}
        >
          <View className="flex-row items-center gap-2">
            <View
              className="flex-1 min-h-[48px] flex-row items-center rounded-xl bg-muted px-3"
              style={{ borderWidth: 1, borderColor: colors.border }}
            >
              <Search size={20} color={colors.textSecondary} />
              <RNTextInput
                className="flex-1 ml-2 min-h-[48px] text-[18px] font-barlow-medium text-foreground"
                placeholder="Search POIs"
                placeholderTextColor={colors.textSecondary}
                value={searchQuery}
                onChangeText={setSearchQuery}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
                clearButtonMode="while-editing"
                accessibilityLabel="Search POIs"
              />
            </View>
            <TouchableOpacity
              className="w-[48px] h-[48px] items-center justify-center rounded-xl"
              style={{ backgroundColor: colors.accentSubtle }}
              onPress={handleOpenAddPOI}
              disabled={!activeData}
              accessibilityLabel="Add POI"
              accessibilityRole="button"
            >
              <Plus size={24} color={activeData ? colors.accent : colors.textTertiary} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Category filters */}
        <View style={{ borderBottomWidth: 1, borderBottomColor: colors.borderSubtle }}>
          <POIFilterBar
            categoryCounts={categoryCounts}
            expanded={poiFiltersExpanded}
            onExpandedChange={setPOIFiltersExpanded}
          />
        </View>

        {/* POI list */}
        <FlashList
          ref={expandedListRef}
          data={filteredPOIModels}
          keyExtractor={poiKeyExtractor}
          renderItem={renderExpandedPOI}
          getItemType={() => "poi"}
          contentContainerStyle={EXPANDED_POI_CONTENT_STYLE}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          onScrollBeginDrag={handleExpandedListScrollBegin}
          ListEmptyComponent={
            <View className="items-center justify-center px-5 py-10">
              <MapPin size={24} color={colors.textTertiary} />
              <Text className="text-[13px] text-muted-foreground font-barlow-medium mt-2 text-center">
                {emptyTitle}
              </Text>
              <Text className="text-[11px] text-muted-foreground mt-1 text-center">
                {emptyDetail}
              </Text>
            </View>
          }
        />
        <AddSavedPOISheet
          visible={showAddPOI}
          targets={effectiveSavedPOITargets}
          onClose={handleCloseAddPOI}
          onSaved={handleSavedPOI}
        />
      </View>
    );
  }

  // --- Compact mode: POI browser preview ---
  return (
    <>
      <View className="flex-1">
        {compactPOIModels.length > 0 ? (
          <>
            <View className="pt-1.5">
              <POISelectedFilterSummary categoryCounts={categoryCounts} showAllWhenInactive />
            </View>
            <FlashList
              data={compactPOIModels}
              keyExtractor={poiKeyExtractor}
              renderItem={renderCompactPOI}
              getItemType={() => "compact-poi"}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: safeBottom }}
            />
          </>
        ) : (
          <View className="flex-1 items-center justify-center">
            <Star size={20} color={colors.textTertiary} />
            <Text className="text-[12px] text-muted-foreground font-barlow-medium mt-2">
              No POIs in {horizonScopeLabel}
            </Text>
            {horizonWindow && (
              <Text className="text-[11px] text-muted-foreground mt-1 text-center px-5">
                Switch the riding horizon to FULL to include places outside this range.
              </Text>
            )}
          </View>
        )}
      </View>
      <AddSavedPOISheet
        visible={showAddPOI}
        targets={effectiveSavedPOITargets}
        onClose={handleCloseAddPOI}
        onSaved={handleSavedPOI}
      />
    </>
  );
}

function POIDetailStat({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-1 min-h-[58px] justify-center rounded-lg bg-muted px-2">
      <Text className="text-[12px] font-barlow-medium text-muted-foreground" numberOfLines={1}>
        {label}
      </Text>
      <Text
        className="text-[20px] font-barlow-sc-semibold text-foreground"
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.75}
      >
        {value}
      </Text>
    </View>
  );
}

function parsePlannedStopMinutes(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return 0;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed);
}

function PlannedStopMinutesInput({
  valueMinutes,
  onCommit,
}: {
  valueMinutes: number;
  onCommit: (minutes: number) => void;
}) {
  const colors = useThemeColors();
  const [draft, setDraft] = useState(valueMinutes > 0 ? String(valueMinutes) : "");

  useEffect(() => {
    setDraft(valueMinutes > 0 ? String(valueMinutes) : "");
  }, [valueMinutes]);

  const commitDraft = useCallback(() => {
    const minutes = parsePlannedStopMinutes(draft);
    if (minutes == null) {
      Alert.alert("Invalid Stop Time", "Enter a non-negative number of minutes.");
      setDraft(valueMinutes > 0 ? String(valueMinutes) : "");
      return;
    }
    setDraft(minutes > 0 ? String(minutes) : "");
    if (minutes !== valueMinutes) onCommit(minutes);
  }, [draft, onCommit, valueMinutes]);

  return (
    <View className="mt-3">
      <Text className="text-[12px] font-barlow-semibold text-muted-foreground mb-1">
        Planned stop
      </Text>
      <View
        className="min-h-[48px] flex-row items-center rounded-lg border bg-background px-3"
        style={{ borderColor: colors.border }}
      >
        <RNTextInput
          className="flex-1 min-h-[48px] text-[22px] font-barlow-sc-semibold text-foreground"
          value={draft}
          onChangeText={(text) => setDraft(text.replace(/[^0-9]/g, ""))}
          onBlur={commitDraft}
          onSubmitEditing={commitDraft}
          keyboardType="number-pad"
          returnKeyType="done"
          placeholder="0"
          placeholderTextColor={colors.textTertiary}
          accessibilityLabel="Planned stop minutes"
        />
        <Text className="text-[14px] font-barlow-semibold text-muted-foreground ml-2">min</Text>
      </View>
    </View>
  );
}

function InlinePOIDetail({
  poi,
  segments,
  currentDist,
  onBack,
}: {
  poi: DisplayPOI;
  segments: StitchedSegmentInfo[] | null;
  currentDist: number | null;
  onBack: () => void;
}) {
  const colors = useThemeColors();
  const units = useSettingsStore((s) => s.units);
  const toggleStarred = usePoiStore((s) => s.toggleStarred);
  const isStarred = usePoiStore((s) => s.starredPOIIds.has(poi.id));
  const updatePOINotes = usePoiStore((s) => s.updatePOINotes);
  const deleteCustomPOI = usePoiStore((s) => s.deleteCustomPOI);
  const getETAToPOI = useEtaStore((s) => s.getETAToPOI);
  const updatePlannedStopDuration = usePoiStore((s) => s.updatePlannedStopDuration);

  const catMeta = POI_CATEGORIES.find((c) => c.key === poi.category);
  const IconComp = catMeta ? POI_ICON_MAP[catMeta.iconName] : null;
  const displayPOI = useMemo(() => toDisplayPOIForSegments(poi, segments), [poi, segments]);

  const distAhead = useMemo(() => {
    if (!displayPOI) return null;
    return displayPOI.effectiveDistanceMeters - (currentDist ?? 0);
  }, [displayPOI, currentDist]);

  const etaResult = useMemo(
    () => (displayPOI ? getETAToPOI(displayPOI) : null),
    [displayPOI, getETAToPOI],
  );
  const plannedStopMinutes = getPlannedStopDurationMinutes(poi);
  const plannedDepartureTime = departureTimeAfterPlannedStop(etaResult, plannedStopMinutes);

  const openingHoursRaw = poi.tags?.opening_hours;
  const ohStatus = useMemo(
    () => (openingHoursRaw ? getOpeningHoursStatus(openingHoursRaw) : null),
    [openingHoursRaw],
  );
  const ohColor = useMemo(() => {
    const key = ohStatusColorKey(ohStatus);
    return key ? colors[key] : colors.textSecondary;
  }, [ohStatus, colors]);
  const ohText = useMemo(() => {
    if (!ohStatus) return null;
    if (ohStatus.detail === "24/7") return "Open 24/7";
    return ohStatus.detail ? `${ohStatus.label} · ${ohStatus.detail}` : ohStatus.label;
  }, [ohStatus]);
  const distAheadText =
    distAhead == null
      ? "--"
      : distAhead >= 0
        ? formatDistance(distAhead, units)
        : `-${formatDistance(Math.abs(distAhead), units)}`;
  const distAheadLabel =
    distAhead == null
      ? "distance"
      : currentDist == null
        ? "from start"
        : distAhead >= 0
          ? "ahead"
          : "behind";
  const offRouteText =
    poi.distanceFromRouteMeters > 50 ? `${Math.round(poi.distanceFromRouteMeters)} m` : "on route";
  const plannedStopText = plannedStopMinutes > 0 ? `${plannedStopMinutes}m` : "none";

  const etaOpenStatus = useMemo(() => {
    if (!etaResult || !openingHoursRaw) return null;
    return isOpenAt(openingHoursRaw, etaResult.eta);
  }, [etaResult, openingHoursRaw]);
  const etaDaySchedule = useMemo(
    () =>
      openingHoursRaw ? getDayScheduleForDate(openingHoursRaw, etaResult?.eta ?? new Date()) : null,
    [openingHoursRaw, etaResult],
  );

  const address = useMemo(() => getPoiAddress(poi), [poi]);
  const phone = useMemo(() => getPoiPhone(poi), [poi]);
  const phoneUrl = useMemo(() => (phone ? buildPhoneUrl(phone) : null), [phone]);
  const websiteUrl = useMemo(() => getPoiWebsiteUrl(poi), [poi]);
  const extraDetailFields = useMemo(() => getPoiExtraDetailFields(poi), [poi]);
  const notes = getPOINotes(poi);
  const mapUrl = useMemo(() => getPoiMapUrl(poi), [poi]);

  const handleEditNotes = useCallback(() => {
    Alert.prompt(
      "POI Notes",
      undefined,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Save",
          onPress: (value?: string) => {
            updatePOINotes(poi.routeId, poi.id, value ?? "");
          },
        },
      ],
      "plain-text",
      notes,
    );
  }, [notes, poi.id, poi.routeId, updatePOINotes]);

  const handleDeleteSavedPOI = useCallback(() => {
    Alert.alert("Delete Saved POI", "Remove this saved POI?", [
      { text: "Keep", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          deleteCustomPOI(poi.routeId, poi.id);
        },
      },
    ]);
  }, [deleteCustomPOI, poi.id, poi.routeId]);

  const handleOpenMaps = useCallback(() => {
    Linking.openURL(mapUrl).catch(() => {
      Alert.alert("Open Failed", "Could not open this POI in Maps.");
    });
  }, [mapUrl]);

  const handleCallPhone = useCallback(() => {
    if (!phoneUrl) return;
    Linking.openURL(phoneUrl).catch(() => {
      Alert.alert("Call Failed", "Could not start a call for this POI.");
    });
  }, [phoneUrl]);

  const handleOpenWebsite = useCallback(() => {
    if (!websiteUrl) return;
    Linking.openURL(websiteUrl).catch(() => {
      Alert.alert("Open Failed", "Could not open this POI website.");
    });
  }, [websiteUrl]);

  const handlePlannedStopCommit = useCallback(
    (minutes: number) => {
      updatePlannedStopDuration(poi.routeId, poi.id, minutes);
    },
    [poi.id, poi.routeId, updatePlannedStopDuration],
  );

  return (
    <ScrollView className="flex-1 px-3 pt-1">
      {/* Header: back + name + star */}
      <View className="flex-row items-center">
        <TouchableOpacity
          className="w-[48px] h-[48px] items-center justify-center rounded-full bg-muted"
          onPress={onBack}
          accessibilityLabel="Back to POI list"
        >
          <ChevronLeft size={24} color={colors.textSecondary} />
        </TouchableOpacity>
        <View className="flex-1 mx-2">
          <Text className="text-[16px] font-barlow-semibold text-foreground" numberOfLines={1}>
            {poi.name ?? catMeta?.label ?? "Unnamed"}
          </Text>
          {catMeta && (
            <View className="flex-row items-center mt-1">
              {IconComp && <IconComp size={12} color={catMeta.color} />}
              <Text
                className="ml-1 text-[11px] font-barlow-medium"
                style={{ color: catMeta.color }}
              >
                {catMeta.label}
              </Text>
            </View>
          )}
        </View>
        <TouchableOpacity
          className="w-[48px] h-[48px] items-center justify-center rounded-full bg-muted"
          onPress={() => toggleStarred(poi.id)}
          accessibilityLabel={isStarred ? "Unstar POI" : "Star POI"}
          accessibilityState={{ selected: isStarred }}
        >
          <Star
            size={22}
            color={isStarred ? colors.warning : colors.textTertiary}
            fill={isStarred ? colors.warning : "none"}
          />
        </TouchableOpacity>
      </View>

      {/* Riding decision summary */}
      <View className="flex-row gap-2 mt-3">
        <POIDetailStat label={distAheadLabel} value={distAheadText} />
        <POIDetailStat
          label={
            etaResult && etaResult.ridingTimeSeconds > 0
              ? `ETA ${formatETA(etaResult.eta)}`
              : "riding"
          }
          value={
            etaResult && etaResult.ridingTimeSeconds > 0
              ? `~${formatDuration(etaResult.ridingTimeSeconds)}`
              : "--"
          }
        />
        <POIDetailStat label="off route" value={offRouteText} />
        <POIDetailStat label="stop" value={plannedStopText} />
      </View>

      {plannedStopMinutes > 0 && plannedDepartureTime && (
        <Text className="text-[13px] font-barlow-medium text-muted-foreground mt-2">
          Stop {plannedStopMinutes}m · depart {formatETA(plannedDepartureTime)}
        </Text>
      )}

      <PlannedStopMinutesInput
        valueMinutes={plannedStopMinutes}
        onCommit={handlePlannedStopCommit}
      />

      {etaOpenStatus !== null && (
        <Text
          className="text-[14px] font-barlow-semibold mt-2"
          style={{ color: etaOpenStatus ? colors.positive : colors.destructive }}
        >
          {etaOpenStatus ? "Open when you arrive" : "Closed at ETA"}
        </Text>
      )}

      {/* Opening hours */}
      {ohText && (
        <View className="flex-row items-center mt-3">
          <Clock size={16} color={ohColor} />
          <Text className="ml-1.5 text-[15px] font-barlow-semibold" style={{ color: ohColor }}>
            {ohText}
          </Text>
        </View>
      )}

      {etaDaySchedule && ohStatus?.detail !== "24/7" && (
        <View className="ml-5 mt-1">
          <View className="flex-row items-center">
            <Text className="text-[13px] text-muted-foreground font-barlow-medium w-[72px]">
              {etaDaySchedule.label}
            </Text>
            <Text className="text-[13px] text-muted-foreground font-barlow-sc-medium">
              {etaDaySchedule.hours}
            </Text>
          </View>
        </View>
      )}

      {address && (
        <View className="flex-row items-center mt-2">
          <MapPin size={14} color={colors.textSecondary} />
          <Text className="ml-1.5 text-[14px] text-muted-foreground font-barlow">{address}</Text>
        </View>
      )}

      {phone && !phoneUrl && (
        <View className="flex-row items-center mt-2">
          <Phone size={14} color={colors.textSecondary} />
          <Text className="ml-1.5 text-[14px] text-muted-foreground font-barlow">{phone}</Text>
        </View>
      )}

      {phone && phoneUrl && (
        <TouchableOpacity
          className="flex-row items-center min-h-[48px] mt-1"
          onPress={handleCallPhone}
          accessibilityLabel={`Call ${phone}`}
        >
          <Phone size={13} color={colors.textSecondary} />
          <Text className="ml-1.5 text-[13px] text-primary font-barlow-semibold">{phone}</Text>
        </TouchableOpacity>
      )}

      {websiteUrl && (
        <TouchableOpacity
          className="flex-row items-center min-h-[48px] mt-1"
          onPress={handleOpenWebsite}
          accessibilityLabel="Open POI website"
        >
          <ExternalLink size={14} color={colors.accent} />
          <Text className="ml-2 text-[14px] font-barlow-medium text-primary">Website</Text>
        </TouchableOpacity>
      )}

      {extraDetailFields.map((field) => (
        <View key={`${field.label}:${field.value}`} className="mt-2 flex-row">
          <Text className="w-[84px] text-[12px] font-barlow-semibold text-muted-foreground">
            {field.label}
          </Text>
          <Text className="flex-1 text-[12px] font-barlow-medium text-foreground">
            {field.value}
          </Text>
        </View>
      ))}

      {notes ? (
        <View className="mt-3">
          <Text className="text-[12px] font-barlow-semibold text-muted-foreground mb-1">Notes</Text>
          <Text className="text-[13px] text-foreground font-barlow">{notes}</Text>
        </View>
      ) : null}

      <TouchableOpacity
        className="flex-row items-center min-h-[48px] mt-2"
        onPress={handleOpenMaps}
        accessibilityLabel="Open in Maps"
      >
        <ExternalLink size={14} color={colors.accent} />
        <Text className="ml-2 text-[14px] font-barlow-medium text-primary">Open in Maps</Text>
      </TouchableOpacity>

      {poi.source === "custom" && (
        <View className="mt-1">
          <TouchableOpacity
            className="min-h-[48px] justify-center"
            onPress={handleEditNotes}
            accessibilityLabel="Edit POI notes"
          >
            <Text className="text-[14px] font-barlow-medium text-primary">Edit notes</Text>
          </TouchableOpacity>
          <TouchableOpacity
            className="min-h-[48px] justify-center"
            onPress={handleDeleteSavedPOI}
            accessibilityLabel="Delete saved POI"
          >
            <Text className="text-[14px] font-barlow-medium text-destructive">
              Delete saved POI
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {isGoogleDerivedPOI(poi) && (
        <Text className="text-[10px] text-muted-foreground font-barlow mt-3">
          Powered by Google
        </Text>
      )}
    </ScrollView>
  );
}
