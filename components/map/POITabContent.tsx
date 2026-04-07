import React, { useMemo } from "react";
import { View, FlatList, ScrollView, TouchableOpacity } from "react-native";
import { Text } from "@/components/ui/text";
import { Star, MapPin, Clock, ChevronLeft, Phone } from "lucide-react-native";
import { cn } from "@/lib/cn";
import { useThemeColors } from "@/theme";
import { useSettingsStore } from "@/store/settingsStore";
import { useRouteStore } from "@/store/routeStore";
import { usePoiStore } from "@/store/poiStore";
import { useEtaStore } from "@/store/etaStore";
import { useActiveRouteData } from "@/hooks/useActiveRouteData";
import { POI_CATEGORIES, POI_BEHIND_THRESHOLD_M } from "@/constants";
import { POI_ICON_MAP } from "@/constants/poiIcons";
import { ohStatusColorKey } from "@/constants/poiHelpers";
import { formatDistance, formatDuration, formatETA } from "@/utils/formatters";
import { getOpeningHoursStatus, isOpenAt, getDaySchedules } from "@/services/openingHoursParser";
import type { ActiveRouteData, POI, POICategory } from "@/types";

interface POITabContentProps {
  activeData: ActiveRouteData | null;
}

function CompactFilterBar({ routeIds }: { routeIds: string[] }) {
  const colors = useThemeColors();
  const allPois = usePoiStore((s) => s.pois);
  const enabledCategories = usePoiStore((s) => s.enabledCategories);
  const toggleCategory = usePoiStore((s) => s.toggleCategory);
  const showOpenOnly = usePoiStore((s) => s.showOpenOnly);
  const toggleShowOpenOnly = usePoiStore((s) => s.toggleShowOpenOnly);

  const enabledSet = useMemo(() => new Set(enabledCategories), [enabledCategories]);

  const categoryCounts = useMemo(() => {
    const counts: Partial<Record<POICategory, number>> = {};
    for (const id of routeIds) {
      const pois = allPois[id];
      if (pois) for (const poi of pois) {
        counts[poi.category] = (counts[poi.category] ?? 0) + 1;
      }
    }
    return counts;
  }, [routeIds, allPois]);

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: 8, gap: 4, paddingVertical: 4 }}
    >
      <TouchableOpacity
        className={cn(
          "flex-row items-center px-2.5 h-[28px] rounded-full",
          showOpenOnly ? "bg-muted border border-border" : "border border-transparent",
        )}
        onPress={toggleShowOpenOnly}
      >
        <Clock size={11} color={showOpenOnly ? colors.positive : colors.textTertiary} />
        <Text className={cn("ml-1 text-[11px] font-barlow-medium", showOpenOnly ? "text-foreground" : "text-muted-foreground")}>
          Open
        </Text>
      </TouchableOpacity>

      {POI_CATEGORIES.map((cat) => {
        const isEnabled = enabledSet.has(cat.key);
        const count = categoryCounts[cat.key] ?? 0;
        const IconComp = POI_ICON_MAP[cat.iconName];
        return (
          <TouchableOpacity
            key={cat.key}
            className={cn(
              "flex-row items-center px-2.5 h-[28px] rounded-full",
              isEnabled ? "bg-muted border border-border" : "border border-transparent",
            )}
            onPress={() => toggleCategory(cat.key)}
          >
            {IconComp && <IconComp size={11} color={isEnabled ? cat.color : colors.textTertiary} />}
            <Text className={cn("ml-1 text-[11px] font-barlow-medium", isEnabled ? "text-foreground" : "text-muted-foreground")}>
              {cat.label}
            </Text>
            {count > 0 && (
              <Text className={cn("ml-0.5 text-[9px] font-barlow-sc-medium", isEnabled ? "text-muted-foreground" : "text-muted-foreground/50")}>
                {count}
              </Text>
            )}
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

export default function POITabContent({ activeData }: POITabContentProps) {
  const colors = useThemeColors();
  const units = useSettingsStore((s) => s.units);
  const snappedPosition = useRouteStore((s) => s.snappedPosition);
  const getStarredPOIs = usePoiStore((s) => s.getStarredPOIs);
  const starredPOIIds = usePoiStore((s) => s.starredPOIIds);
  const selectedPOI = usePoiStore((s) => s.selectedPOI);
  const setSelectedPOI = usePoiStore((s) => s.setSelectedPOI);
  const setShowPOIList = usePoiStore((s) => s.setShowPOIList);
  const cumulativeTime = useEtaStore((s) => s.cumulativeTime);

  const routeIds = activeData?.routeIds ?? [];
  const routePoints = activeData?.points ?? null;
  const segments = activeData?.segments ?? null;
  const currentDist = snappedPosition?.distanceAlongRouteMeters ?? null;
  const currentIdx = snappedPosition?.pointIndex ?? null;

  const starredUpcoming = useMemo(() => {
    if (routeIds.length === 0) return [];
    const allStarred: (POI & { effectiveDist: number; ridingTimeSeconds: number | null })[] = [];
    for (const routeId of routeIds) {
      const pois = getStarredPOIs(routeId);
      const offset = segments?.find((s) => s.routeId === routeId)?.distanceOffsetMeters ?? 0;
      for (const poi of pois) {
        const effDist = poi.distanceAlongRouteMeters + offset;
        // Compute riding time from current position to this POI
        let ridingTime: number | null = null;
        if (currentIdx != null && cumulativeTime && routePoints && currentDist != null && effDist > currentDist) {
          let poiIdx = currentIdx;
          for (let i = currentIdx; i < routePoints.length; i++) {
            if (routePoints[i].distanceFromStartMeters >= effDist) { poiIdx = i; break; }
            poiIdx = i;
          }
          const seconds = cumulativeTime[poiIdx] - cumulativeTime[currentIdx];
          if (seconds > 0) ridingTime = seconds;
        }
        allStarred.push({ ...poi, effectiveDist: effDist, ridingTimeSeconds: ridingTime });
      }
    }
    allStarred.sort((a, b) => a.effectiveDist - b.effectiveDist);
    if (currentDist == null) return allStarred;
    return allStarred.filter((p) => p.effectiveDist >= currentDist - POI_BEHIND_THRESHOLD_M);
  }, [routeIds, segments, getStarredPOIs, starredPOIIds, currentDist, currentIdx, cumulativeTime, routePoints]);

  const totalPOICount = usePoiStore((s) => {
    let count = 0;
    for (const routeId of routeIds) {
      count += s.pois[routeId]?.length ?? 0;
    }
    return count;
  });

  // Show inline detail when a POI is selected
  if (selectedPOI) {
    return <InlinePOIDetail poi={selectedPOI} onBack={() => setSelectedPOI(null)} />;
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

  return (
    <View className="flex-1">
      {/* Category filters */}
      <CompactFilterBar routeIds={routeIds} />

      {/* Header: starred count + "All POIs" link */}
      <View className="flex-row items-center justify-between px-3 pb-1">
        <Text className="text-[11px] font-barlow-semibold text-muted-foreground">
          {starredUpcoming.length > 0 ? `${starredUpcoming.length} starred ahead` : "No starred POIs ahead"}
        </Text>
        <TouchableOpacity hitSlop={8} onPress={() => setShowPOIList(true)}>
          <Text className="text-[11px] font-barlow-medium" style={{ color: colors.accent }}>
            All POIs ({totalPOICount})
          </Text>
        </TouchableOpacity>
      </View>

      {/* Starred POI list */}
      {starredUpcoming.length > 0 ? (
        <FlatList
          data={starredUpcoming}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <CompactPOIRow
              poi={item}
              effectiveDist={item.effectiveDist}
              currentDist={currentDist}
              ridingTimeSeconds={item.ridingTimeSeconds}
              onPress={() => {
                const raw = usePoiStore.getState().pois[item.routeId]?.find((p) => p.id === item.id);
                setSelectedPOI(raw ?? item);
              }}
            />
          )}
          showsVerticalScrollIndicator={false}
        />
      ) : (
        <View className="flex-1 items-center justify-center">
          <Star size={20} color={colors.textTertiary} />
          <Text className="text-[12px] text-muted-foreground font-barlow-medium mt-2">
            Star POIs from "All POIs" to see them here
          </Text>
        </View>
      )}
    </View>
  );
}

function CompactPOIRow({
  poi,
  effectiveDist,
  currentDist,
  ridingTimeSeconds,
  onPress,
}: {
  poi: POI;
  effectiveDist: number;
  currentDist: number | null;
  ridingTimeSeconds: number | null;
  onPress: () => void;
}) {
  const colors = useThemeColors();
  const units = useSettingsStore((s) => s.units);

  const catMeta = POI_CATEGORIES.find((c) => c.key === poi.category);
  const IconComp = catMeta ? POI_ICON_MAP[catMeta.iconName] : null;
  const distAhead = currentDist != null ? effectiveDist - currentDist : null;

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
              {ohStatus.label}{ohStatus.detail ? ` · ${ohStatus.detail}` : ""}
            </Text>
          </View>
        )}
      </View>

      <View className="items-end ml-2">
        {distAhead != null && (
          <Text className="text-[14px] font-barlow-sc-semibold text-foreground">
            {distAhead >= 0 ? formatDistance(distAhead, units) : `-${formatDistance(Math.abs(distAhead), units)}`}
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

function InlinePOIDetail({ poi, onBack }: { poi: POI; onBack: () => void }) {
  const colors = useThemeColors();
  const units = useSettingsStore((s) => s.units);
  const snappedPosition = useRouteStore((s) => s.snappedPosition);
  const toggleStarred = usePoiStore((s) => s.toggleStarred);
  const isStarred = usePoiStore((s) => s.starredPOIIds.has(poi.id));
  const getETAToPOI = useEtaStore((s) => s.getETAToPOI);
  const activeData = useActiveRouteData();

  const catMeta = POI_CATEGORIES.find((c) => c.key === poi.category);
  const IconComp = catMeta ? POI_ICON_MAP[catMeta.iconName] : null;

  const distAhead = useMemo(() => {
    if (!snappedPosition) return null;
    let poiDist = poi.distanceAlongRouteMeters;
    if (activeData?.segments) {
      const seg = activeData.segments.find((s) => s.routeId === poi.routeId);
      if (seg) poiDist += seg.distanceOffsetMeters;
    }
    return poiDist - snappedPosition.distanceAlongRouteMeters;
  }, [poi, snappedPosition, activeData]);

  const etaResult = useMemo(() => getETAToPOI(poi), [poi, getETAToPOI]);

  const openingHoursRaw = poi.tags?.opening_hours;
  const ohStatus = useMemo(
    () => openingHoursRaw ? getOpeningHoursStatus(openingHoursRaw) : null,
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
    () => openingHoursRaw ? getDaySchedules(openingHoursRaw) : null,
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
              <Text className="ml-1 text-[11px] font-barlow-medium" style={{ color: catMeta.color }}>
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
          <Star size={18} color={isStarred ? colors.warning : colors.textTertiary} fill={isStarred ? colors.warning : "none"} />
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
              <Text className="text-[12px] text-muted-foreground font-barlow-medium w-[60px]">{ds.label}</Text>
              <Text className="text-[12px] text-muted-foreground font-barlow-sc-medium">{ds.hours}</Text>
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
        <Text className="text-[10px] text-muted-foreground font-barlow mt-3">Powered by Google</Text>
      )}
    </ScrollView>
  );
}
