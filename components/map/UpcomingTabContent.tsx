import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlashList, type FlashListRef, type ListRenderItem } from "@shopify/flash-list";
import {
  ActivityIndicator,
  TouchableOpacity,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import {
  ChevronDown,
  ChevronUp,
  Clock3,
  Flag,
  GitBranch,
  MapPin,
  Mountain,
  Ship,
} from "lucide-react-native";
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
import {
  enturDepartureSearchTime,
  fetchEnturFerryTimetableContext,
  readLinkedEnturFerryStops,
} from "@/services/enturFerry";
import { formatDuration, formatETA } from "@/utils/formatters";
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
import type { DisplayFerryCrossing } from "@/types";
import type { FerryDeparture } from "@/services/ferryTimetable";

const EMPTY_FERRIES: DisplayFerryCrossing[] = [];

interface UpcomingFerryDepartureRequest {
  ferryId: string;
  providerRefs: Readonly<Record<string, string>>;
  afterMs: number;
}

interface FerryTimetableViewState {
  status: "loading" | "loaded" | "unavailable";
  departures: FerryDeparture[];
  previousDeparture: FerryDeparture | null;
  lastDepartureOfDay: FerryDeparture | null;
  firstDepartureNextDay: FerryDeparture | null;
  boardableTimeMs: number;
}

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
  const [ferryTimetables, setFerryTimetables] = useState<Record<string, FerryTimetableViewState>>(
    {},
  );
  const [expandedFerryId, setExpandedFerryId] = useState<string | null>(null);

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
  const displayFerries = activeData?.ferries ?? EMPTY_FERRIES;
  const ferrySpans = useMemo(
    () =>
      displayFerries.map((ferry) => ({
        startDistanceMeters: ferry.effectiveStartDistanceMeters,
        endDistanceMeters: ferry.effectiveEndDistanceMeters,
      })),
    [displayFerries],
  );
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
        ferrySpans,
      }),
    [derivedCurrentDistanceMeters, ferrySpans, ridingHorizonMeters, totalDistanceMeters],
  );

  const displayPOIs = useMemo(() => {
    return measureSync("upcoming.displayPOIs", () =>
      displayPOIsForActiveRoute(routeIds, segments, routePois),
    );
  }, [routeIds, segments, routePois]);

  const displayClimbs = useMemo(
    () =>
      measureSync("upcoming.displayClimbs", () =>
        getClimbsForDisplay(routeIds, segments).filter(
          (climb) =>
            !displayFerries.some(
              (ferry) =>
                climb.effectiveEndDistanceMeters > ferry.effectiveStartDistanceMeters &&
                climb.effectiveStartDistanceMeters < ferry.effectiveEndDistanceMeters,
            ),
        ),
      ),
    // routeClimbs is a route-scoped reactivity trigger: getClimbsForDisplay reads store via get()
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [routeIds, segments, routeClimbs, getClimbsForDisplay, displayFerries],
  );
  const plannedStops = useMemo(() => plannedStopsFromPOIs(displayPOIs), [displayPOIs]);

  const events = useMemo(
    () =>
      measureSync("upcoming.timeline", () =>
        buildUpcomingTimeline({
          pois: displayPOIs,
          starredPOIIds,
          climbs: displayClimbs,
          ferries: displayFerries,
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
      displayFerries,
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

  const ferryDepartureRequests = useMemo<UpcomingFerryDepartureRequest[]>(
    () =>
      events.flatMap((event) => {
        if (
          event.kind !== "ferry" ||
          event.isActive ||
          !event.eta ||
          !readLinkedEnturFerryStops(event.ferry.providerRefs)
        ) {
          return [];
        }
        const after = enturDepartureSearchTime(event.eta.eta, event.ferry.boardingBufferMinutes);
        if (!after) return [];
        return [
          {
            ferryId: event.ferry.id,
            providerRefs: event.ferry.providerRefs,
            afterMs: after.getTime(),
          },
        ];
      }),
    [events],
  );
  const expandableFerryIds = useMemo(
    () => new Set(ferryDepartureRequests.map((request) => request.ferryId)),
    [ferryDepartureRequests],
  );

  useEffect(() => {
    if (ferryDepartureRequests.length === 0) {
      setFerryTimetables((current) => (Object.keys(current).length === 0 ? current : {}));
      return;
    }

    const controller = new AbortController();
    let disposed = false;
    setFerryTimetables(
      Object.fromEntries(
        ferryDepartureRequests.map((request) => [
          request.ferryId,
          {
            status: "loading",
            departures: [],
            previousDeparture: null,
            lastDepartureOfDay: null,
            firstDepartureNextDay: null,
            boardableTimeMs: request.afterMs,
          } satisfies FerryTimetableViewState,
        ]),
      ),
    );
    void Promise.all(
      ferryDepartureRequests.map(
        async (
          request,
        ): Promise<readonly [ferryId: string, state: FerryTimetableViewState] | null> => {
          try {
            const timetable = await fetchEnturFerryTimetableContext(
              request.providerRefs,
              new Date(request.afterMs),
              controller.signal,
            );
            const hasTimetableData =
              timetable.nextDepartures.length > 0 ||
              timetable.previousDeparture != null ||
              timetable.lastDepartureOfDay != null ||
              timetable.firstDepartureNextDay != null;
            return [
              request.ferryId,
              {
                status: hasTimetableData ? "loaded" : "unavailable",
                departures: timetable.nextDepartures,
                previousDeparture: timetable.previousDeparture,
                lastDepartureOfDay: timetable.lastDepartureOfDay,
                firstDepartureNextDay: timetable.firstDepartureNextDay,
                boardableTimeMs: request.afterMs,
              },
            ];
          } catch (departureError) {
            if (
              controller.signal.aborted ||
              (departureError instanceof Error && departureError.name === "AbortError")
            ) {
              return null;
            }
            return [
              request.ferryId,
              {
                status: "unavailable",
                departures: [],
                previousDeparture: null,
                lastDepartureOfDay: null,
                firstDepartureNextDay: null,
                boardableTimeMs: request.afterMs,
              },
            ];
          }
        },
      ),
    ).then((results) => {
      if (disposed) return;
      setFerryTimetables(Object.fromEntries(results.filter((result) => result != null)));
    });

    return () => {
      disposed = true;
      controller.abort();
    };
  }, [ferryDepartureRequests]);

  useEffect(() => {
    if (expandedFerryId && !expandableFerryIds.has(expandedFerryId)) {
      setExpandedFerryId(null);
    }
  }, [expandableFerryIds, expandedFerryId]);

  const ferryDepartures = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(ferryTimetables).flatMap(([ferryId, timetable]) =>
          timetable.departures[0] ? [[ferryId, timetable.departures[0]]] : [],
        ),
      ),
    [ferryTimetables],
  );

  const rowModels = useMemo(
    () =>
      measureSync("upcoming.rows", () =>
        buildUpcomingRowModels({
          events,
          currentDistanceMeters: derivedCurrentDistanceMeters,
          units,
          ferries: displayFerries,
          ferryDepartures,
        }),
      ),
    [events, derivedCurrentDistanceMeters, displayFerries, ferryDepartures, units],
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
  const listExtraData = useMemo(
    () => ({ expandedFerryId, ferryTimetables }),
    [expandedFerryId, ferryTimetables],
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
        ferries: displayFerries,
      }),
    [
      totalDistanceMeters,
      derivedCurrentDistanceMeters,
      horizonWindow,
      routePoints,
      cumulativeTime,
      timing.futureStartMs,
      plannedStops,
      displayFerries,
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
      } else if (event.kind === "ferry" && expandableFerryIds.has(event.ferry.id)) {
        setExpandedFerryId((current) => (current === event.ferry.id ? null : event.ferry.id));
      }
    },
    [expandableFerryIds, setPanelTab, setSelectedClimb, setSelectedPOI],
  );

  const renderItem = useCallback<ListRenderItem<UpcomingListItemModel>>(
    ({ item }) =>
      item.itemType === "day-header" ? (
        <UpcomingDayHeader label={item.label} accessibilityLabel={item.accessibilityLabel} />
      ) : (
        <UpcomingEventRow
          model={item}
          onPress={handleEventPress}
          isExpandable={item.event.kind === "ferry" && expandableFerryIds.has(item.event.ferry.id)}
          isExpanded={item.event.kind === "ferry" && expandedFerryId === item.event.ferry.id}
          timetable={item.event.kind === "ferry" ? ferryTimetables[item.event.ferry.id] : undefined}
        />
      ),
    [expandableFerryIds, expandedFerryId, ferryTimetables, handleEventPress],
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
        extraData={listExtraData}
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
  isExpandable,
  isExpanded,
  timetable,
}: {
  model: UpcomingRowModel;
  onPress: (event: UpcomingEvent) => void;
  isExpandable: boolean;
  isExpanded: boolean;
  timetable?: FerryTimetableViewState;
}) {
  const colors = useThemeColors();
  const accentColor = resolveUpcomingRowColor(model.accentColor, colors);
  const subtitleColor = resolveUpcomingRowColor(model.subtitleColor, colors);
  const rowIsPressable = model.isPressable || isExpandable;

  return (
    <View className="border-b border-border">
      <TouchableOpacity
        className="flex-row items-center px-3 py-2.5"
        disabled={!rowIsPressable}
        onPress={() => onPress(model.event)}
        accessibilityRole={rowIsPressable ? "button" : "text"}
        accessibilityLabel={model.accessibilityLabel}
        accessibilityHint={isExpandable ? "Shows or hides the ferry timetable" : undefined}
        accessibilityState={isExpandable ? { expanded: isExpanded } : undefined}
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
          {model.hasFerryInterval && model.ferryLandingLabel && (
            <Text className="text-[20px] font-barlow-sc-semibold text-foreground" numberOfLines={1}>
              {model.ferryLandingLabel}
            </Text>
          )}
          <Text
            className="text-[12px] font-barlow-sc-medium text-muted-foreground"
            numberOfLines={1}
          >
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
            numberOfLines={model.subtitleNumberOfLines}
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
          <View className="flex-row items-center gap-1">
            <Text
              className="text-[11px] font-barlow-medium text-muted-foreground"
              numberOfLines={1}
            >
              {model.distanceDirectionLabel}
            </Text>
            {isExpandable &&
              (isExpanded ? (
                <ChevronUp size={14} color={colors.textSecondary} />
              ) : (
                <ChevronDown size={14} color={colors.textSecondary} />
              ))}
          </View>
        </View>
      </TouchableOpacity>
      {isExpandable && isExpanded && <FerryTimetableDetails timetable={timetable} />}
    </View>
  );
});

function FerryTimetableDetails({ timetable }: { timetable?: FerryTimetableViewState }) {
  const colors = useThemeColors();
  if (!timetable || timetable.status === "loading") {
    return (
      <View className="flex-row items-center gap-2 bg-info/5 px-4 pb-3 pt-1">
        <ActivityIndicator size="small" color={colors.info} />
        <Text className="text-[13px] font-barlow-medium text-info">Loading Entur departures…</Text>
      </View>
    );
  }
  if (
    timetable.status === "unavailable" ||
    (timetable.departures.length === 0 &&
      !timetable.previousDeparture &&
      !timetable.lastDepartureOfDay &&
      !timetable.firstDepartureNextDay)
  ) {
    return (
      <View className="bg-info/5 px-4 pb-3 pt-1">
        <Text className="text-[13px] leading-5 text-muted-foreground">
          Timetable unavailable. Using the saved assumed wait and crossing time.
        </Text>
      </View>
    );
  }

  return (
    <View className="bg-info/5 px-4 pb-3 pt-1">
      {timetable.previousDeparture && (
        <View className="pb-2">
          <Text className="text-[13px] font-barlow-semibold text-muted-foreground">
            Previous departure
          </Text>
          <FerryDepartureLine
            departure={timetable.previousDeparture}
            trailingLabel={previousDepartureGapLabel(
              timetable.previousDeparture,
              timetable.boardableTimeMs,
            )}
          />
        </View>
      )}

      {timetable.departures.length > 0 ? (
        <View>
          <Text className="text-[13px] font-barlow-semibold text-foreground">Next departures</Text>
          {timetable.departures.slice(0, 5).map((departure) => (
            <FerryDepartureLine
              key={`${departure.departureTime}:${departure.arrivalTime ?? ""}:${departure.serviceName ?? ""}`}
              departure={departure}
              trailingLabel="Scheduled"
            />
          ))}
        </View>
      ) : (
        <Text className="text-[13px] leading-5 text-muted-foreground">
          No later departure was found.
        </Text>
      )}

      {timetable.lastDepartureOfDay && (
        <View className="mt-2 border-t border-border-subtle pt-2">
          <Text className="text-[13px] font-barlow-semibold" style={{ color: colors.warning }}>
            Last departure today
          </Text>
          <FerryDepartureLine
            departure={timetable.lastDepartureOfDay}
            trailingLabel="Last today"
            isImportant
          />
        </View>
      )}

      {timetable.firstDepartureNextDay && (
        <View className="mt-2 border-t border-border-subtle pt-2">
          <Text className="text-[13px] font-barlow-semibold text-foreground">
            First departure tomorrow
          </Text>
          <FerryDepartureLine
            departure={timetable.firstDepartureNextDay}
            trailingLabel="First tomorrow"
          />
        </View>
      )}
    </View>
  );
}

function FerryDepartureLine({
  departure,
  trailingLabel,
  isImportant = false,
}: {
  departure: FerryDeparture;
  trailingLabel: string;
  isImportant?: boolean;
}) {
  const colors = useThemeColors();
  const departureDate = timetableDate(departure.departureTime);
  const arrivalDate = timetableDate(departure.arrivalTime);
  if (!departureDate) return null;
  const departureLabel = formatETA(departureDate);
  const arrivalLabel = arrivalDate ? formatETA(arrivalDate) : "--:--";
  const trailingColor = isImportant ? colors.warning : colors.info;
  return (
    <View
      className="mt-1.5 min-h-[28px] flex-row items-center"
      accessible
      accessibilityLabel={`${departureLabel} departure, ${arrivalLabel} arrival, ${trailingLabel}`}
    >
      <Text className="w-[58px] text-[17px] font-barlow-sc-semibold text-foreground">
        {departureLabel}
      </Text>
      <Text className="mr-2 text-[13px] text-muted-foreground">→</Text>
      <Text className="w-[58px] text-[17px] font-barlow-sc-semibold text-foreground">
        {arrivalLabel}
      </Text>
      <Text
        className="flex-1 text-right text-[12px] font-barlow-medium"
        style={{ color: trailingColor }}
      >
        {trailingLabel}
      </Text>
    </View>
  );
}

function previousDepartureGapLabel(departure: FerryDeparture, boardableTimeMs: number): string {
  const departureDate = timetableDate(departure.departureTime);
  if (!departureDate) return "Previous";
  const gapMinutes = Math.max(1, Math.round((boardableTimeMs - departureDate.getTime()) / 60_000));
  if (gapMinutes < 60) return `${gapMinutes} min earlier`;
  const minutes = gapMinutes % 60;
  return minutes === 0 ? "1h earlier" : `1h ${minutes}m earlier`;
}

function timetableDate(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function RenderUpcomingRowIcon({ icon, color }: { icon: UpcomingRowIcon; color: string }) {
  switch (icon.kind) {
    case "poi": {
      const IconComp = POI_ICON_MAP[icon.iconName] ?? MapPin;
      return <IconComp size={20} color={color} />;
    }
    case "climb":
      return <Mountain size={20} color={color} />;
    case "ferry":
      return <Ship size={20} color={color} />;
    case "segment":
      return <GitBranch size={20} color={color} />;
    case "finish":
      return <Flag size={20} color={color} />;
  }
}
