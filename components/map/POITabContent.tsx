import React, { useEffect, useMemo, useState, useCallback } from "react";
import {
  View,
  FlatList,
  ScrollView,
  TouchableOpacity,
  TextInput as RNTextInput,
  Alert,
  Linking,
  type ListRenderItem,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
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
import { getCategoryMeta, ohStatusColorKey } from "@/constants/poiHelpers";
import { formatDistance, formatDuration, formatETA } from "@/utils/formatters";
import { getOpeningHoursStatus, isOpenAt, getDaySchedules } from "@/services/openingHoursParser";
import { stitchPOIs } from "@/services/stitchingService";
import { toDisplayPOIForSegments, toDisplayPOIs } from "@/services/displayDistance";
import { getETAToDistanceFromDistance as resolveETAToDistance } from "@/services/etaCalculator";
import { resolveActiveRouteProgress } from "@/utils/routeProgress";
import {
  createRidingHorizonWindow,
  isDistanceInWindow,
  ridingHorizonMetersForMode,
  ridingHorizonScopeLabelForMode,
} from "@/utils/ridingHorizon";
import POIFilterBar from "@/components/map/POIFilterBar";
import POIListItem from "@/components/poi/POIListItem";
import AddSavedPOISheet from "@/components/poi/AddSavedPOISheet";
import type { ActiveRouteData, DisplayPOI, POI, StitchedSegmentInfo } from "@/types";
import {
  getGoogleMapsUrlForPOI,
  getPOINotes,
  isGoogleDerivedPOI,
  type SavedPOITarget,
} from "@/services/savedPOIService";

interface POITabContentProps {
  activeData: ActiveRouteData | null;
}

type StarredDisplayPOI = DisplayPOI & { ridingTimeSeconds: number | null };

const EXPANDED_POI_INITIAL_RENDER_COUNT = 10;
const COMPACT_POI_INITIAL_RENDER_COUNT = 6;
const POI_LIST_MAX_BATCH = 8;
const POI_LIST_WINDOW_SIZE = 5;
const POI_LIST_BATCHING_PERIOD_MS = 50;
const EXPANDED_POI_CONTENT_STYLE = { paddingBottom: 8 };

function poiKeyExtractor(item: Pick<DisplayPOI, "id">): string {
  return item.id;
}

export default function POITabContent({ activeData }: POITabContentProps) {
  const colors = useThemeColors();
  const { bottom: safeBottom } = useSafeAreaInsets();
  const snappedPosition = useRouteStore((s) => s.snappedPosition);
  const getStarredPOIs = usePoiStore((s) => s.getStarredPOIs);
  const starredPOIIds = usePoiStore((s) => s.starredPOIIds);
  const selectedPOI = usePoiStore((s) => s.selectedPOI);
  const setSelectedPOI = usePoiStore((s) => s.setSelectedPOI);
  const getVisiblePOIs = usePoiStore((s) => s.getVisiblePOIs);
  const allPois = usePoiStore((s) => s.pois);
  const enabledCategories = usePoiStore((s) => s.enabledCategories);
  const showOpenOnly = usePoiStore((s) => s.showOpenOnly);
  const cumulativeTime = useEtaStore((s) => s.cumulativeTime);
  const isExpanded = usePanelStore((s) => s.isExpanded);
  const panelMode = usePanelStore((s) => s.panelMode);

  const [searchQuery, setSearchQuery] = useState("");
  const [showAddPOI, setShowAddPOI] = useState(false);
  const [loadedSavedPOITargets, setLoadedSavedPOITargets] = useState<SavedPOITarget[] | null>(null);

  const routeIds = useMemo(() => activeData?.routeIds ?? [], [activeData?.routeIds]);
  const routePoints = activeData?.points ?? null;
  const segments = activeData?.segments ?? null;
  const activeTotalDistance = activeData?.totalDistanceMeters;
  const activeRouteProgress = useMemo(
    () => resolveActiveRouteProgress(activeData, snappedPosition),
    [activeData, snappedPosition],
  );
  const currentDist = activeRouteProgress?.distanceAlongRouteMeters ?? null;
  const ridingHorizonMeters = ridingHorizonMetersForMode(panelMode);
  const horizonWindow = useMemo(
    () =>
      createRidingHorizonWindow(currentDist, ridingHorizonMeters, {
        behindMeters: POI_BEHIND_THRESHOLD_M,
        totalDistanceMeters: activeTotalDistance,
      }),
    [currentDist, ridingHorizonMeters, activeTotalDistance],
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

  const starredUpcoming = useMemo(() => {
    if (routeIds.length === 0) return [];
    const poisByRoute: Record<string, POI[]> = {};
    for (const routeId of routeIds) {
      poisByRoute[routeId] = getStarredPOIs(routeId);
    }
    const displayed = segments
      ? stitchPOIs(segments, poisByRoute, horizonWindow)
      : routeIds.flatMap((routeId) =>
          toDisplayPOIs(
            (poisByRoute[routeId] ?? []).filter((poi) =>
              isDistanceInWindow(poi.distanceAlongRouteMeters, horizonWindow),
            ),
          ),
        );
    const allStarred: StarredDisplayPOI[] = [];
    for (const poi of displayed) {
      const effectiveDist = poi.effectiveDistanceMeters;
      let ridingTime: number | null = null;
      if (cumulativeTime && routePoints && currentDist != null && effectiveDist > currentDist) {
        const eta = resolveETAToDistance(cumulativeTime, routePoints, currentDist, effectiveDist);
        if (eta && eta.ridingTimeSeconds > 0) ridingTime = eta.ridingTimeSeconds;
      }
      allStarred.push({ ...poi, ridingTimeSeconds: ridingTime });
    }
    allStarred.sort((a, b) => a.effectiveDistanceMeters - b.effectiveDistanceMeters);
    return allStarred;
    // starredPOIIds is a reactivity trigger: getStarredPOIs reads from store via get() and is not itself reactive
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    routeIds,
    segments,
    getStarredPOIs,
    starredPOIIds,
    currentDist,
    cumulativeTime,
    routePoints,
    horizonWindow,
  ]);

  const totalPOICount = usePoiStore((s) => {
    let count = 0;
    for (const routeId of routeIds) {
      count += s.pois[routeId]?.length ?? 0;
    }
    return count;
  });

  // --- Expanded: full POI list with search + filters ---
  const visiblePOIs = useMemo(() => {
    if (!isExpanded) return [];
    if (segments) {
      const poisByRoute: Record<string, POI[]> = {};
      for (const routeId of routeIds) {
        poisByRoute[routeId] = getVisiblePOIs(routeId);
      }
      return stitchPOIs(segments, poisByRoute, horizonWindow);
    }
    return routeIds.flatMap((routeId) =>
      toDisplayPOIs(
        getVisiblePOIs(routeId).filter((poi) =>
          isDistanceInWindow(poi.distanceAlongRouteMeters, horizonWindow),
        ),
      ),
    );
    // allPois/enabledCategories/starredPOIIds are reactivity triggers: getVisiblePOIs reads store via get() and is not itself reactive
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isExpanded,
    routeIds,
    segments,
    allPois,
    enabledCategories,
    starredPOIIds,
    showOpenOnly,
    horizonWindow,
  ]);

  const sortedAllPOIs = useMemo(() => {
    return [...visiblePOIs].sort((a, b) => a.effectiveDistanceMeters - b.effectiveDistanceMeters);
  }, [visiblePOIs]);

  const filteredPOIs = useMemo(() => {
    if (!searchQuery.trim()) return sortedAllPOIs;
    const q = searchQuery.trim().toLowerCase();
    return sortedAllPOIs.filter((p) => p.name?.toLowerCase().includes(q));
  }, [sortedAllPOIs, searchQuery]);

  const handlePOIPress = useCallback(
    (poi: DisplayPOI) => {
      setSelectedPOI(poi);
    },
    [setSelectedPOI],
  );

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

  const renderExpandedPOI = useCallback<ListRenderItem<DisplayPOI>>(
    ({ item }) => (
      <POIListItem poi={item} currentDistAlongRoute={currentDist} onPress={handlePOIPress} />
    ),
    [currentDist, handlePOIPress],
  );

  const renderCompactPOI = useCallback<ListRenderItem<StarredDisplayPOI>>(
    ({ item }) => (
      <CompactPOIRow
        poi={item}
        currentDist={currentDist}
        ridingTimeSeconds={item.ridingTimeSeconds}
        onPress={handlePOIPress}
      />
    ),
    [currentDist, handlePOIPress],
  );

  // Show inline detail when a POI is selected
  if (selectedPOI) {
    return (
      <InlinePOIDetail
        poi={selectedPOI}
        segments={segments}
        currentDist={currentDist}
        onBack={() => setSelectedPOI(null)}
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
    const scopeLabel = horizonScopeLabel;
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
          className="flex-row items-center px-4 py-2"
          style={{ borderBottomWidth: 1, borderBottomColor: colors.borderSubtle }}
        >
          <Search size={16} color={colors.textTertiary} />
          <RNTextInput
            className="flex-1 ml-2 text-[15px] font-barlow text-foreground"
            placeholder="Search by name..."
            placeholderTextColor={colors.textTertiary}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCorrect={false}
            returnKeyType="search"
            clearButtonMode="while-editing"
            accessibilityLabel="Search POIs"
          />
          <TouchableOpacity
            className="w-[48px] h-[48px] items-center justify-center ml-2"
            onPress={handleOpenAddPOI}
            disabled={!activeData}
            accessibilityLabel="Add POI"
          >
            <Plus size={20} color={colors.accent} />
          </TouchableOpacity>
        </View>

        {/* Category filters */}
        <View style={{ borderBottomWidth: 1, borderBottomColor: colors.borderSubtle }}>
          <POIFilterBar routeIds={routeIds} />
        </View>

        <View
          className="flex-row items-center justify-between px-3"
          style={{
            height: 52,
            borderBottomWidth: 1,
            borderBottomColor: colors.borderSubtle,
          }}
        >
          <Text className="text-[11px] font-barlow-semibold text-muted-foreground">
            {filteredPOIs.length} POIs · {scopeLabel}
          </Text>
        </View>

        {/* POI list */}
        <FlatList
          data={filteredPOIs}
          keyExtractor={poiKeyExtractor}
          renderItem={renderExpandedPOI}
          contentContainerStyle={EXPANDED_POI_CONTENT_STYLE}
          showsVerticalScrollIndicator={false}
          initialNumToRender={EXPANDED_POI_INITIAL_RENDER_COUNT}
          maxToRenderPerBatch={POI_LIST_MAX_BATCH}
          updateCellsBatchingPeriod={POI_LIST_BATCHING_PERIOD_MS}
          windowSize={POI_LIST_WINDOW_SIZE}
          removeClippedSubviews
          keyboardShouldPersistTaps="handled"
          extraData={`${currentDist ?? "none"}:${panelMode}`}
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

  // --- Compact mode: starred POIs only ---
  return (
    <>
      <View className="flex-1">
        {starredUpcoming.length > 0 ? (
          <>
            <View className="flex-row items-center justify-between px-3 py-1.5">
              <Text className="text-[11px] font-barlow-semibold text-muted-foreground">
                {starredUpcoming.length} starred · {horizonScopeLabel}
              </Text>
            </View>
            <FlatList
              data={starredUpcoming}
              keyExtractor={poiKeyExtractor}
              renderItem={renderCompactPOI}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: safeBottom }}
              initialNumToRender={COMPACT_POI_INITIAL_RENDER_COUNT}
              maxToRenderPerBatch={POI_LIST_MAX_BATCH}
              updateCellsBatchingPeriod={POI_LIST_BATCHING_PERIOD_MS}
              windowSize={POI_LIST_WINDOW_SIZE}
              removeClippedSubviews
              extraData={currentDist}
            />
          </>
        ) : (
          <View className="flex-1 items-center justify-center">
            <Star size={20} color={colors.textTertiary} />
            <Text className="text-[12px] text-muted-foreground font-barlow-medium mt-2">
              No starred POIs in {horizonScopeLabel}
            </Text>
            {horizonWindow && (
              <Text className="text-[11px] text-muted-foreground mt-1 text-center px-5">
                Switch the riding horizon to FULL to include starred places outside this range.
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

const CompactPOIRow = React.memo(function CompactPOIRow({
  poi,
  currentDist,
  ridingTimeSeconds,
  onPress,
}: {
  poi: DisplayPOI;
  currentDist: number | null;
  ridingTimeSeconds: number | null;
  onPress: (poi: DisplayPOI) => void;
}) {
  const colors = useThemeColors();
  const units = useSettingsStore((s) => s.units);

  const catMeta = getCategoryMeta(poi.category);
  const IconComp = catMeta ? POI_ICON_MAP[catMeta.iconName] : null;
  const distAhead = currentDist != null ? poi.effectiveDistanceMeters - currentDist : null;

  const ohStatus = useMemo(() => {
    const tag = poi.tags?.opening_hours;
    return tag ? getOpeningHoursStatus(tag) : null;
  }, [poi.tags?.opening_hours]);

  const ohColor = useMemo(() => {
    const key = ohStatusColorKey(ohStatus);
    return key ? colors[key] : undefined;
  }, [ohStatus, colors]);

  return (
    <TouchableOpacity
      className="flex-row items-center px-3 py-2"
      onPress={() => onPress(poi)}
      accessibilityLabel={poi.name ?? catMeta?.label ?? "POI"}
    >
      <View
        className="w-[28px] h-[28px] rounded-full items-center justify-center"
        style={{ backgroundColor: (catMeta?.color ?? colors.textTertiary) + "1A" }}
      >
        {IconComp && <IconComp size={15} color={catMeta?.color ?? colors.textPrimary} />}
      </View>

      <View className="flex-1 ml-2.5">
        <Text className="text-[14px] font-barlow-medium text-foreground" numberOfLines={1}>
          {poi.name ?? catMeta?.label ?? "Unnamed"}
        </Text>
        {ohStatus && (
          <View className="flex-row items-center mt-1">
            <View className="w-[5px] h-[5px] rounded-full" style={{ backgroundColor: ohColor }} />
            <Text className="ml-1 text-[11px] font-barlow-medium" style={{ color: ohColor }}>
              {ohStatus.label}
              {ohStatus.detail ? ` · ${ohStatus.detail}` : ""}
            </Text>
          </View>
        )}
      </View>

      <View className="items-end ml-2">
        {distAhead != null && (
          <Text className="text-[14px] font-barlow-sc-semibold text-foreground">
            {distAhead >= 0
              ? formatDistance(distAhead, units)
              : `-${formatDistance(Math.abs(distAhead), units)}`}
          </Text>
        )}
        {ridingTimeSeconds != null && (
          <Text className="text-[10px] text-muted-foreground font-barlow-sc-medium">
            ~{formatDuration(ridingTimeSeconds)}
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );
});

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

  const catMeta = POI_CATEGORIES.find((c) => c.key === poi.category);
  const IconComp = catMeta ? POI_ICON_MAP[catMeta.iconName] : null;
  const displayPOI = useMemo(() => toDisplayPOIForSegments(poi, segments), [poi, segments]);

  const distAhead = useMemo(() => {
    if (currentDist == null || !displayPOI) return null;
    return displayPOI.effectiveDistanceMeters - currentDist;
  }, [displayPOI, currentDist]);

  const etaResult = useMemo(
    () => (displayPOI ? getETAToPOI(displayPOI) : null),
    [displayPOI, getETAToPOI],
  );

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

  const daySchedules = useMemo(
    () => (openingHoursRaw ? getDaySchedules(openingHoursRaw) : null),
    [openingHoursRaw],
  );

  const etaOpenStatus = useMemo(() => {
    if (!etaResult || !openingHoursRaw) return null;
    return isOpenAt(openingHoursRaw, etaResult.eta);
  }, [etaResult, openingHoursRaw]);

  const address = useMemo(() => {
    const t = poi.tags;
    if (t.formatted_address) return t.formatted_address;
    const parts: string[] = [];
    if (t["addr:street"]) {
      const num = t["addr:housenumber"] ? ` ${t["addr:housenumber"]}` : "";
      parts.push(`${t["addr:street"]}${num}`);
    }
    if (t["addr:city"]) parts.push(t["addr:city"]);
    return parts.length > 0 ? parts.join(", ") : null;
  }, [poi]);

  const phone = poi.tags?.phone ?? poi.tags?.["contact:phone"] ?? null;
  const notes = getPOINotes(poi);
  const googleMapsUrl = useMemo(() => getGoogleMapsUrlForPOI(poi), [poi]);

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

  const handleOpenGoogleMaps = useCallback(() => {
    if (!googleMapsUrl) return;
    Linking.openURL(googleMapsUrl).catch(() => {
      Alert.alert("Open Failed", "Could not open Google Maps.");
    });
  }, [googleMapsUrl]);

  return (
    <ScrollView className="flex-1 px-3 pt-1">
      {/* Header: back + name + star */}
      <View className="flex-row items-center">
        <TouchableOpacity
          className="w-[32px] h-[32px] items-center justify-center"
          hitSlop={8}
          onPress={onBack}
          accessibilityLabel="Back to POI list"
        >
          <ChevronLeft size={20} color={colors.textSecondary} />
        </TouchableOpacity>
        <View className="flex-1 mx-1">
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
          className="w-[32px] h-[32px] items-center justify-center"
          hitSlop={8}
          onPress={() => toggleStarred(poi.id)}
          accessibilityLabel={isStarred ? "Unstar POI" : "Star POI"}
        >
          <Star
            size={18}
            color={isStarred ? colors.warning : colors.textTertiary}
            fill={isStarred ? colors.warning : "none"}
          />
        </TouchableOpacity>
      </View>

      {/* Distance + ETA */}
      <View className="flex-row items-center mt-2">
        <MapPin size={13} color={colors.textSecondary} />
        <Text className="ml-1.5 text-[13px] text-muted-foreground font-barlow">
          {Math.round(poi.distanceFromRouteMeters)} m off route
        </Text>
        {distAhead != null && (
          <Text className="ml-2 text-[13px] font-barlow-sc-semibold text-foreground">
            {distAhead >= 0
              ? `${formatDistance(distAhead, units)} ahead`
              : `${formatDistance(Math.abs(distAhead), units)} behind`}
          </Text>
        )}
      </View>

      {etaResult && etaResult.ridingTimeSeconds > 0 && (
        <View className="flex-row items-center mt-1">
          <Clock size={13} color={colors.accent} />
          <Text className="ml-1.5 text-[13px] font-barlow-sc-semibold text-foreground">
            ~{formatDuration(etaResult.ridingTimeSeconds)}
          </Text>
          <Text className="ml-1.5 text-[13px] font-barlow-medium text-muted-foreground">
            ETA {formatETA(etaResult.eta)}
          </Text>
        </View>
      )}

      {etaOpenStatus !== null && (
        <Text
          className="text-[12px] font-barlow ml-5 mt-1"
          style={{ color: etaOpenStatus ? colors.positive : colors.destructive }}
        >
          {etaOpenStatus ? "Open when you arrive" : "Closed at ETA"}
        </Text>
      )}

      {/* Opening hours */}
      {ohText && (
        <View className="flex-row items-center mt-2">
          <Clock size={13} color={ohColor} />
          <Text className="ml-1.5 text-[13px] font-barlow" style={{ color: ohColor }}>
            {ohText}
          </Text>
        </View>
      )}

      {daySchedules && ohStatus?.detail !== "24/7" && (
        <View className="ml-5 mt-1">
          {daySchedules.map((ds) => (
            <View key={ds.label} className="flex-row items-center">
              <Text className="text-[12px] text-muted-foreground font-barlow-medium w-[60px]">
                {ds.label}
              </Text>
              <Text className="text-[12px] text-muted-foreground font-barlow-sc-medium">
                {ds.hours}
              </Text>
            </View>
          ))}
        </View>
      )}

      {address && (
        <View className="flex-row items-center mt-2">
          <MapPin size={13} color={colors.textSecondary} />
          <Text className="ml-1.5 text-[13px] text-muted-foreground font-barlow">{address}</Text>
        </View>
      )}

      {phone && (
        <View className="flex-row items-center mt-2">
          <Phone size={13} color={colors.textSecondary} />
          <Text className="ml-1.5 text-[13px] text-muted-foreground font-barlow">{phone}</Text>
        </View>
      )}

      {notes ? (
        <View className="mt-3">
          <Text className="text-[12px] font-barlow-semibold text-muted-foreground mb-1">Notes</Text>
          <Text className="text-[13px] text-foreground font-barlow">{notes}</Text>
        </View>
      ) : null}

      {googleMapsUrl && (
        <TouchableOpacity
          className="flex-row items-center min-h-[48px] mt-2"
          onPress={handleOpenGoogleMaps}
          accessibilityLabel="Open in Google Maps"
        >
          <ExternalLink size={14} color={colors.accent} />
          <Text className="ml-2 text-[14px] font-barlow-medium text-primary">
            Open in Google Maps
          </Text>
        </TouchableOpacity>
      )}

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
