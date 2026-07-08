import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { FlashList, type FlashListRef, type ListRenderItem } from "@shopify/flash-list";
import {
  TouchableOpacity,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { Clock3, Flag, GitBranch, MapPin, Mountain } from "lucide-react-native";
import { useShallow } from "zustand/react/shallow";
import { Text } from "@/components/ui/text";
import { POI_ICON_MAP } from "@/constants/poiIcons";
import { useThemeColors } from "@/theme";
import { useClimbStore } from "@/store/climbStore";
import { useEtaStore } from "@/store/etaStore";
import { usePanelStore } from "@/store/panelStore";
import { usePoiStore } from "@/store/poiStore";
import { useRouteStore } from "@/store/routeStore";
import { useSettingsStore } from "@/store/settingsStore";
import { useActiveRouteTiming } from "@/hooks/useActiveRouteTiming";
import { displayPOIsForActiveRoute } from "@/services/activePOIs";
import {
  buildUpcomingTimeline,
  resolveUpcomingHorizonETA,
  type UpcomingEvent,
} from "@/services/upcomingTimeline";
import { plannedStopsFromPOIs } from "@/services/plannedStops";
import { formatDuration } from "@/utils/formatters";
import { resolveActiveRouteProgress } from "@/utils/routeProgress";
import { bucketDistanceForDerivedWork } from "@/utils/distanceBuckets";
import {
  createRidingHorizonWindow,
  ridingHorizonLabelForMode,
  ridingHorizonMetersForMode,
  ridingHorizonScopeLabelForMode,
} from "@/utils/ridingHorizon";
import { measureSync } from "@/utils/perfMarks";
import { pickRouteRecords } from "@/utils/routeScopedRecords";
import {
  buildUpcomingListItems,
  buildUpcomingRowModels,
  getUpcomingListItemType,
  resolveUpcomingRowColor,
  type UpcomingListItemModel,
  type UpcomingRowIcon,
  type UpcomingRowModel,
} from "@/utils/upcomingRowModels";
import type { ActiveRouteData, PanelMode } from "@/types";

interface UpcomingTabContentProps {
  activeData: ActiveRouteData | null;
}

function upcomingItemKeyExtractor(item: UpcomingListItemModel): string {
  return item.id;
}

export default function UpcomingTabContent({ activeData }: UpcomingTabContentProps) {
  const listRef = useRef<FlashListRef<UpcomingListItemModel>>(null);
  const restoredScrollKeyRef = useRef<string | null>(null);
  const colors = useThemeColors();
  const units = useSettingsStore((s) => s.units);
  const snappedPosition = useRouteStore((s) => s.snappedPosition);
  const starredPOIIds = usePoiStore((s) => s.starredPOIIds);
  const setSelectedPOI = usePoiStore((s) => s.setSelectedPOI);
  const getClimbsForDisplay = useClimbStore((s) => s.getClimbsForDisplay);
  const setSelectedClimb = useClimbStore((s) => s.setSelectedClimb);
  const cumulativeTime = useEtaStore((s) => s.cumulativeTime);
  const panelMode = usePanelStore((s) => s.panelMode);
  const setPanelTab = usePanelStore((s) => s.setPanelTab);
  const setPanelScrollOffset = usePanelStore((s) => s.setPanelScrollOffset);
  const timing = useActiveRouteTiming(activeData);

  const routeIds = useMemo(() => activeData?.routeIds ?? [], [activeData?.routeIds]);
  const scrollKey = useMemo(
    () => `${activeData?.id ?? "no-route"}:${panelMode}`,
    [activeData?.id, panelMode],
  );
  const segments = activeData?.segments ?? null;
  const routePoints = activeData?.points ?? null;
  const totalDistanceMeters = activeData?.totalDistanceMeters ?? 0;
  const routePois = usePoiStore(useShallow((s) => pickRouteRecords(s.pois, routeIds)));
  const routeClimbs = useClimbStore(useShallow((s) => pickRouteRecords(s.climbs, routeIds)));
  const activeRouteProgress = useMemo(
    () =>
      resolveActiveRouteProgress(activeData, snappedPosition, {
        plannedStartMs: timing.plannedStartMs,
      }),
    [activeData, snappedPosition, timing.plannedStartMs],
  );
  const currentDistanceMeters = activeRouteProgress?.distanceAlongRouteMeters ?? null;
  const derivedCurrentDistanceMeters = bucketDistanceForDerivedWork(currentDistanceMeters);
  const ridingHorizonMeters = ridingHorizonMetersForMode(panelMode);
  const horizonWindow = useMemo(
    () =>
      createRidingHorizonWindow(derivedCurrentDistanceMeters, ridingHorizonMeters, {
        totalDistanceMeters,
      }),
    [derivedCurrentDistanceMeters, ridingHorizonMeters, totalDistanceMeters],
  );

  const displayPOIs = useMemo(() => {
    return measureSync("upcoming.displayPOIs", () =>
      displayPOIsForActiveRoute(routeIds, segments, routePois),
    );
  }, [routeIds, segments, routePois]);

  const displayClimbs = useMemo(
    () => measureSync("upcoming.displayClimbs", () => getClimbsForDisplay(routeIds, segments)),
    // routeClimbs is a route-scoped reactivity trigger: getClimbsForDisplay reads store via get()
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [routeIds, segments, routeClimbs, getClimbsForDisplay],
  );
  const plannedStops = useMemo(() => plannedStopsFromPOIs(displayPOIs), [displayPOIs]);

  const events = useMemo(
    () =>
      measureSync("upcoming.timeline", () =>
        buildUpcomingTimeline({
          pois: displayPOIs,
          starredPOIIds,
          climbs: displayClimbs,
          segments,
          totalDistanceMeters,
          currentDistanceMeters: derivedCurrentDistanceMeters,
          horizonWindow,
          routePoints,
          cumulativeTime,
          etaStartTimeMs: timing.futureStartMs,
          plannedStops,
        }),
      ),
    [
      displayPOIs,
      starredPOIIds,
      displayClimbs,
      segments,
      totalDistanceMeters,
      derivedCurrentDistanceMeters,
      horizonWindow,
      routePoints,
      cumulativeTime,
      timing.futureStartMs,
      plannedStops,
    ],
  );

  const rowModels = useMemo(
    () =>
      measureSync("upcoming.rows", () =>
        buildUpcomingRowModels({
          events,
          currentDistanceMeters: derivedCurrentDistanceMeters,
          units,
        }),
      ),
    [events, derivedCurrentDistanceMeters, units],
  );
  const upcomingEtaBaseTimeMs = timing.futureStartMs ?? Date.now();
  const listItems = useMemo(
    () =>
      measureSync("upcoming.listItems", () =>
        buildUpcomingListItems({
          rows: rowModels,
          etaBaseTimeMs: upcomingEtaBaseTimeMs,
        }),
      ),
    [rowModels, upcomingEtaBaseTimeMs],
  );

  const horizonETA = useMemo(
    () =>
      resolveUpcomingHorizonETA({
        totalDistanceMeters,
        currentDistanceMeters: derivedCurrentDistanceMeters,
        horizonWindow,
        routePoints,
        cumulativeTime,
        etaStartTimeMs: timing.futureStartMs,
        plannedStops,
      }),
    [
      totalDistanceMeters,
      derivedCurrentDistanceMeters,
      horizonWindow,
      routePoints,
      cumulativeTime,
      timing.futureStartMs,
      plannedStops,
    ],
  );

  useEffect(() => {
    if (restoredScrollKeyRef.current === scrollKey || listItems.length === 0) return;

    const offset = usePanelStore.getState().getPanelScrollOffset("upcoming", scrollKey);
    restoredScrollKeyRef.current = scrollKey;
    requestAnimationFrame(() => {
      listRef.current?.scrollToOffset({ offset, animated: false });
    });
  }, [listItems.length, scrollKey]);

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      setPanelScrollOffset("upcoming", scrollKey, event.nativeEvent.contentOffset.y);
    },
    [scrollKey, setPanelScrollOffset],
  );

  const handleEventPress = useCallback(
    (event: UpcomingEvent) => {
      if (event.kind === "poi") {
        setSelectedPOI(event.poi);
      } else if (event.kind === "climb-span") {
        setSelectedClimb(event.climb);
        setPanelTab("climbs");
      }
    },
    [setPanelTab, setSelectedClimb, setSelectedPOI],
  );

  const renderItem = useCallback<ListRenderItem<UpcomingListItemModel>>(
    ({ item }) =>
      item.itemType === "day-header" ? (
        <UpcomingDayHeader label={item.label} accessibilityLabel={item.accessibilityLabel} />
      ) : (
        <UpcomingEventRow model={item} onPress={handleEventPress} />
      ),
    [handleEventPress],
  );

  const scopeLabel = ridingHorizonScopeLabelForMode(panelMode);

  return (
    <View className="flex-1">
      <UpcomingHeader
        panelMode={panelMode}
        eventCount={events.length}
        horizonEtaSeconds={horizonETA?.ridingTimeSeconds ?? null}
      />

      <FlashList
        ref={listRef}
        data={listItems}
        keyExtractor={upcomingItemKeyExtractor}
        renderItem={renderItem}
        getItemType={getUpcomingListItemType}
        showsVerticalScrollIndicator={false}
        onScroll={handleScroll}
        scrollEventThrottle={250}
        contentContainerStyle={{ paddingBottom: 8 }}
        ListEmptyComponent={
          <View className="items-center justify-center px-5 py-12">
            <Clock3 size={24} color={colors.textTertiary} />
            <Text className="text-[13px] text-muted-foreground font-barlow-medium mt-2 text-center">
              No important events in {scopeLabel}
            </Text>
            <Text className="text-[11px] text-muted-foreground mt-1 text-center">
              Star POIs you want to see here during the ride.
            </Text>
          </View>
        }
      />
    </View>
  );
}

function UpcomingDayHeader({
  label,
  accessibilityLabel,
}: {
  label: string;
  accessibilityLabel: string;
}) {
  return (
    <View
      className="items-center bg-surface px-3 pt-2 pb-0.5 border-b border-border-subtle"
      accessibilityRole="header"
      accessibilityLabel={accessibilityLabel}
    >
      <Text className="text-[11px] font-barlow-semibold text-muted-foreground" numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function UpcomingHeader({
  panelMode,
  eventCount,
  horizonEtaSeconds,
}: {
  panelMode: PanelMode;
  eventCount: number;
  horizonEtaSeconds: number | null;
}) {
  const colors = useThemeColors();
  const label =
    panelMode === "full-route" ? "To finish" : `Next ${ridingHorizonLabelForMode(panelMode)}`;
  const etaLabel = horizonEtaSeconds != null ? ` · ~${formatDuration(horizonEtaSeconds)}` : "";

  return (
    <View
      className="flex-row items-center justify-between px-3"
      style={{ height: 52, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle }}
    >
      <View className="flex-1 min-w-0">
        <Text className="text-[15px] font-barlow-semibold text-foreground" numberOfLines={1}>
          {label}
          {etaLabel}
        </Text>
        <Text className="text-[11px] font-barlow-medium text-muted-foreground" numberOfLines={1}>
          {eventCount} timeline events
        </Text>
      </View>
    </View>
  );
}

const UpcomingEventRow = React.memo(function UpcomingEventRow({
  model,
  onPress,
}: {
  model: UpcomingRowModel;
  onPress: (event: UpcomingEvent) => void;
}) {
  const colors = useThemeColors();
  const accentColor = resolveUpcomingRowColor(model.accentColor, colors);
  const subtitleColor = resolveUpcomingRowColor(model.subtitleColor, colors);

  return (
    <TouchableOpacity
      className="flex-row items-center px-3 py-2.5 border-b border-border"
      disabled={!model.isPressable}
      onPress={() => onPress(model.event)}
      accessibilityRole={model.isPressable ? "button" : "text"}
      accessibilityLabel={model.accessibilityLabel}
    >
      <View className="w-[70px]">
        <Text className="text-[20px] font-barlow-sc-semibold text-foreground" numberOfLines={1}>
          {model.clockLabel}
        </Text>
        {model.hasStopInterval && model.departureLabel && (
          <Text className="text-[20px] font-barlow-sc-semibold text-foreground" numberOfLines={1}>
            {model.departureLabel}
          </Text>
        )}
        {model.hasClimbInterval && model.climbEndLabel && (
          <Text className="text-[20px] font-barlow-sc-semibold text-foreground" numberOfLines={1}>
            {model.climbEndLabel}
          </Text>
        )}
        <Text className="text-[12px] font-barlow-sc-medium text-muted-foreground" numberOfLines={1}>
          {model.ridingTimeLabel}
        </Text>
      </View>

      <View
        className="w-[42px] h-[42px] rounded-full items-center justify-center mx-2"
        style={{ backgroundColor: accentColor + "1A" }}
      >
        <RenderUpcomingRowIcon icon={model.icon} color={accentColor} />
      </View>

      <View className="flex-1 min-w-0">
        <Text className="text-[15px] font-barlow-semibold text-foreground" numberOfLines={1}>
          {model.title}
        </Text>
        <Text
          className="text-[13px] font-barlow-medium"
          style={{ color: subtitleColor }}
          numberOfLines={1}
        >
          {model.subtitle}
        </Text>
      </View>

      <View className="ml-2 items-end w-[92px]">
        <Text
          className="text-[18px] font-barlow-sc-semibold text-foreground"
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.72}
        >
          {model.distanceLabel}
        </Text>
        <Text className="text-[11px] font-barlow-medium text-muted-foreground" numberOfLines={1}>
          {model.distanceDirectionLabel}
        </Text>
      </View>
    </TouchableOpacity>
  );
});

function RenderUpcomingRowIcon({ icon, color }: { icon: UpcomingRowIcon; color: string }) {
  switch (icon.kind) {
    case "poi": {
      const IconComp = POI_ICON_MAP[icon.iconName] ?? MapPin;
      return <IconComp size={20} color={color} />;
    }
    case "climb":
      return <Mountain size={20} color={color} />;
    case "segment":
      return <GitBranch size={20} color={color} />;
    case "finish":
      return <Flag size={20} color={color} />;
  }
}
