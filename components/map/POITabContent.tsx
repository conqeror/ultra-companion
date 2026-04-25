import React, { useMemo, useState, useCallback } from "react";
import {
  View,
  FlatList,
  ScrollView,
  TouchableOpacity,
  TextInput as RNTextInput,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "@/components/ui/text";
import { Star, MapPin, Clock, ChevronLeft, Phone, Search } from "lucide-react-native";
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
import { getOpeningHoursStatus, isOpenAt, getDaySchedules } from "@/services/openingHoursParser";
import { stitchPOIs } from "@/services/stitchingService";
import { toDisplayPOIForSegments, toDisplayPOIs } from "@/services/displayDistance";
import { getETAToDistance as resolveETAToDistance } from "@/services/etaCalculator";
import POIFilterBar from "@/components/map/POIFilterBar";
import POIListItem from "@/components/poi/POIListItem";
import type { ActiveRouteData, DisplayPOI, POI, StitchedSegmentInfo } from "@/types";

interface POITabContentProps {
  activeData: ActiveRouteData | null;
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
  const cumulativeTime = useEtaStore((s) => s.cumulativeTime);
  const isExpanded = usePanelStore((s) => s.isExpanded);

  const [searchQuery, setSearchQuery] = useState("");

  const routeIds = useMemo(() => activeData?.routeIds ?? [], [activeData?.routeIds]);
  const routePoints = activeData?.points ?? null;
  const segments = activeData?.segments ?? null;
  const currentDist = snappedPosition?.distanceAlongRouteMeters ?? null;
  const currentIdx = snappedPosition?.pointIndex ?? null;

  const starredUpcoming = useMemo(() => {
    if (routeIds.length === 0) return [];
    const poisByRoute: Record<string, POI[]> = {};
    for (const routeId of routeIds) {
      poisByRoute[routeId] = getStarredPOIs(routeId);
    }
    const displayed = segments
      ? stitchPOIs(segments, poisByRoute)
      : routeIds.flatMap((routeId) => toDisplayPOIs(poisByRoute[routeId] ?? []));
    const allStarred: (DisplayPOI & { ridingTimeSeconds: number | null })[] = [];
    for (const poi of displayed) {
      const effectiveDist = poi.effectiveDistanceMeters;
      let ridingTime: number | null = null;
      if (
        currentIdx != null &&
        cumulativeTime &&
        routePoints &&
        currentDist != null &&
        effectiveDist > currentDist
      ) {
        const eta = resolveETAToDistance(cumulativeTime, routePoints, currentIdx, effectiveDist);
        if (eta && eta.ridingTimeSeconds > 0) ridingTime = eta.ridingTimeSeconds;
      }
      allStarred.push({ ...poi, ridingTimeSeconds: ridingTime });
    }
    allStarred.sort((a, b) => a.effectiveDistanceMeters - b.effectiveDistanceMeters);
    if (currentDist == null) return allStarred;
    return allStarred.filter(
      (p) => p.effectiveDistanceMeters >= currentDist - POI_BEHIND_THRESHOLD_M,
    );
    // starredPOIIds is a reactivity trigger: getStarredPOIs reads from store via get() and is not itself reactive
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    routeIds,
    segments,
    getStarredPOIs,
    starredPOIIds,
    currentDist,
    currentIdx,
    cumulativeTime,
    routePoints,
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
      return stitchPOIs(segments, poisByRoute);
    }
    return routeIds.length > 0 ? toDisplayPOIs(getVisiblePOIs(routeIds[0])) : [];
    // allPois/enabledCategories/starredPOIIds are reactivity triggers: getVisiblePOIs reads store via get() and is not itself reactive
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isExpanded, routeIds, segments, allPois, enabledCategories, starredPOIIds]);

  const sortedAllPOIs = useMemo(() => {
    if (currentDist == null) {
      return [...visiblePOIs].sort((a, b) => a.effectiveDistanceMeters - b.effectiveDistanceMeters);
    }
    return visiblePOIs
      .filter((p) => p.effectiveDistanceMeters >= currentDist - POI_BEHIND_THRESHOLD_M)
      .sort((a, b) => a.effectiveDistanceMeters - b.effectiveDistanceMeters);
  }, [visiblePOIs, currentDist]);

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

  // Show inline detail when a POI is selected
  if (selectedPOI) {
    return (
      <InlinePOIDetail poi={selectedPOI} segments={segments} onBack={() => setSelectedPOI(null)} />
    );
  }

  // Empty state — no POI data at all
  if (totalPOICount === 0) {
    return (
      <View className="flex-1 items-center justify-center">
        <MapPin size={24} color={colors.textTertiary} />
        <Text className="text-[13px] text-muted-foreground font-barlow-medium mt-2">
          No POIs on this route
        </Text>
        <Text className="text-[11px] text-muted-foreground mt-1">
          Fetch POI data from the route detail screen
        </Text>
      </View>
    );
  }

  // --- Expanded mode: full POI list with search + filters ---
  if (isExpanded) {
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
        </View>

        {/* Category filters */}
        <View style={{ borderBottomWidth: 1, borderBottomColor: colors.borderSubtle }}>
          <POIFilterBar routeIds={routeIds} />
        </View>

        {/* Full POI list */}
        <FlatList
          data={filteredPOIs}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <POIListItem poi={item} currentDistAlongRoute={currentDist} onPress={handlePOIPress} />
          )}
          contentContainerStyle={{ paddingBottom: 8 }}
          showsVerticalScrollIndicator={false}
        />
      </View>
    );
  }

  // --- Compact mode: starred POIs only ---
  return (
    <View className="flex-1">
      {starredUpcoming.length > 0 ? (
        <>
          <View className="flex-row items-center justify-between px-3 py-1.5">
            <Text className="text-[11px] font-barlow-semibold text-muted-foreground">
              {starredUpcoming.length} starred ahead
            </Text>
          </View>
          <FlatList
            data={starredUpcoming}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <CompactPOIRow
                poi={item}
                currentDist={currentDist}
                ridingTimeSeconds={item.ridingTimeSeconds}
                onPress={() => setSelectedPOI(item)}
              />
            )}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: safeBottom }}
          />
        </>
      ) : (
        <View className="flex-1 items-center justify-center">
          <Star size={20} color={colors.textTertiary} />
          <Text className="text-[12px] text-muted-foreground font-barlow-medium mt-2">
            No starred POIs ahead
          </Text>
        </View>
      )}
    </View>
  );
}

function CompactPOIRow({
  poi,
  currentDist,
  ridingTimeSeconds,
  onPress,
}: {
  poi: DisplayPOI;
  currentDist: number | null;
  ridingTimeSeconds: number | null;
  onPress: () => void;
}) {
  const colors = useThemeColors();
  const units = useSettingsStore((s) => s.units);

  const catMeta = POI_CATEGORIES.find((c) => c.key === poi.category);
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
      onPress={onPress}
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
}

function InlinePOIDetail({
  poi,
  segments,
  onBack,
}: {
  poi: DisplayPOI;
  segments: StitchedSegmentInfo[] | null;
  onBack: () => void;
}) {
  const colors = useThemeColors();
  const units = useSettingsStore((s) => s.units);
  const snappedPosition = useRouteStore((s) => s.snappedPosition);
  const toggleStarred = usePoiStore((s) => s.toggleStarred);
  const isStarred = usePoiStore((s) => s.starredPOIIds.has(poi.id));
  const getETAToPOI = useEtaStore((s) => s.getETAToPOI);

  const catMeta = POI_CATEGORIES.find((c) => c.key === poi.category);
  const IconComp = catMeta ? POI_ICON_MAP[catMeta.iconName] : null;
  const displayPOI = useMemo(() => toDisplayPOIForSegments(poi, segments), [poi, segments]);

  const distAhead = useMemo(() => {
    if (!snappedPosition || !displayPOI) return null;
    return displayPOI.effectiveDistanceMeters - snappedPosition.distanceAlongRouteMeters;
  }, [displayPOI, snappedPosition]);

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

      {poi.source === "google" && (
        <Text className="text-[10px] text-muted-foreground font-barlow mt-3">
          Powered by Google
        </Text>
      )}
    </ScrollView>
  );
}
