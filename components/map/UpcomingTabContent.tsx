import React, { useCallback, useMemo } from "react";
import { FlatList, TouchableOpacity, View, type ListRenderItem } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Clock3, Flag, GitBranch, MapPin, Mountain } from "lucide-react-native";
import { Text } from "@/components/ui/text";
import { POI_ICON_MAP } from "@/constants/poiIcons";
import { getCategoryMeta, ohStatusColorKey } from "@/constants/poiHelpers";
import {
  CLIMB_DIFFICULTY_LABELS,
  climbDifficultyColor,
  getClimbDifficulty,
} from "@/constants/climbHelpers";
import { useThemeColors } from "@/theme";
import { useClimbStore } from "@/store/climbStore";
import { useCollectionStore } from "@/store/collectionStore";
import { useEtaStore } from "@/store/etaStore";
import { usePanelStore } from "@/store/panelStore";
import { usePoiStore } from "@/store/poiStore";
import { useRouteStore } from "@/store/routeStore";
import { useSettingsStore } from "@/store/settingsStore";
import { displayPOIsForActiveRoute } from "@/services/activePOIs";
import {
  buildUpcomingTimeline,
  resolveUpcomingHorizonETA,
  type UpcomingEvent,
} from "@/services/upcomingTimeline";
import { getOpeningHoursStatus } from "@/services/openingHoursParser";
import {
  departureTimeAfterPlannedStop,
  getPlannedStopDurationMinutes,
  plannedStopsFromPOIs,
} from "@/services/plannedStops";
import { formatDistance, formatDuration, formatElevation, formatETA } from "@/utils/formatters";
import { activeRouteTiming } from "@/utils/activeRouteTiming";
import { resolveActiveRouteProgress } from "@/utils/routeProgress";
import {
  createRidingHorizonWindow,
  ridingHorizonLabelForMode,
  ridingHorizonMetersForMode,
  ridingHorizonScopeLabelForMode,
} from "@/utils/ridingHorizon";
import type { ActiveRouteData, PanelMode, UnitSystem } from "@/types";

interface UpcomingTabContentProps {
  activeData: ActiveRouteData | null;
}

const INITIAL_RENDER_COUNT = 10;
const LIST_MAX_BATCH = 8;
const LIST_WINDOW_SIZE = 5;
const LIST_BATCHING_PERIOD_MS = 50;

function eventKeyExtractor(event: UpcomingEvent): string {
  return event.id;
}

export default function UpcomingTabContent({ activeData }: UpcomingTabContentProps) {
  const colors = useThemeColors();
  const { bottom: safeBottom } = useSafeAreaInsets();
  const units = useSettingsStore((s) => s.units);
  const snappedPosition = useRouteStore((s) => s.snappedPosition);
  const allPois = usePoiStore((s) => s.pois);
  const starredPOIIds = usePoiStore((s) => s.starredPOIIds);
  const setSelectedPOI = usePoiStore((s) => s.setSelectedPOI);
  const allClimbs = useClimbStore((s) => s.climbs);
  const getClimbsForDisplay = useClimbStore((s) => s.getClimbsForDisplay);
  const setSelectedClimb = useClimbStore((s) => s.setSelectedClimb);
  const cumulativeTime = useEtaStore((s) => s.cumulativeTime);
  const panelMode = usePanelStore((s) => s.panelMode);
  const collections = useCollectionStore((s) => s.collections);
  const timing = useMemo(
    () => activeRouteTiming(activeData, collections),
    [activeData, collections],
  );

  const routeIds = useMemo(() => activeData?.routeIds ?? [], [activeData?.routeIds]);
  const segments = activeData?.segments ?? null;
  const routePoints = activeData?.points ?? null;
  const totalDistanceMeters = activeData?.totalDistanceMeters ?? 0;
  const activeRouteProgress = useMemo(
    () =>
      resolveActiveRouteProgress(activeData, snappedPosition, {
        plannedStartMs: timing.plannedStartMs,
      }),
    [activeData, snappedPosition, timing.plannedStartMs],
  );
  const currentDistanceMeters = activeRouteProgress?.distanceAlongRouteMeters ?? null;
  const ridingHorizonMeters = ridingHorizonMetersForMode(panelMode);
  const horizonWindow = useMemo(
    () =>
      createRidingHorizonWindow(currentDistanceMeters, ridingHorizonMeters, {
        totalDistanceMeters,
      }),
    [currentDistanceMeters, ridingHorizonMeters, totalDistanceMeters],
  );

  const displayPOIs = useMemo(() => {
    return displayPOIsForActiveRoute(routeIds, segments, allPois);
  }, [routeIds, segments, allPois]);

  const displayClimbs = useMemo(
    () => getClimbsForDisplay(routeIds, segments),
    // allClimbs is a reactivity trigger: getClimbsForDisplay reads store via get() and is not itself reactive
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [routeIds, segments, allClimbs, getClimbsForDisplay],
  );
  const plannedStops = useMemo(() => plannedStopsFromPOIs(displayPOIs), [displayPOIs]);

  const events = useMemo(
    () =>
      buildUpcomingTimeline({
        pois: displayPOIs,
        starredPOIIds,
        climbs: displayClimbs,
        segments,
        totalDistanceMeters,
        currentDistanceMeters,
        horizonWindow,
        routePoints,
        cumulativeTime,
        etaStartTimeMs: timing.futureStartMs,
        plannedStops,
      }),
    [
      displayPOIs,
      starredPOIIds,
      displayClimbs,
      segments,
      totalDistanceMeters,
      currentDistanceMeters,
      horizonWindow,
      routePoints,
      cumulativeTime,
      timing.futureStartMs,
      plannedStops,
    ],
  );

  const horizonETA = useMemo(
    () =>
      resolveUpcomingHorizonETA({
        totalDistanceMeters,
        currentDistanceMeters,
        horizonWindow,
        routePoints,
        cumulativeTime,
        etaStartTimeMs: timing.futureStartMs,
        plannedStops,
      }),
    [
      totalDistanceMeters,
      currentDistanceMeters,
      horizonWindow,
      routePoints,
      cumulativeTime,
      timing.futureStartMs,
      plannedStops,
    ],
  );

  const handleEventPress = useCallback(
    (event: UpcomingEvent) => {
      if (event.kind === "poi") {
        setSelectedPOI(event.poi);
      } else if (
        event.kind === "climb-span" ||
        event.kind === "climb-start" ||
        event.kind === "climb-top"
      ) {
        setSelectedClimb(event.climb);
      }
    },
    [setSelectedClimb, setSelectedPOI],
  );

  const renderEvent = useCallback<ListRenderItem<UpcomingEvent>>(
    ({ item }) => (
      <UpcomingEventRow
        event={item}
        currentDistanceMeters={currentDistanceMeters}
        units={units}
        onPress={handleEventPress}
      />
    ),
    [currentDistanceMeters, units, handleEventPress],
  );

  const scopeLabel = ridingHorizonScopeLabelForMode(panelMode);

  return (
    <View className="flex-1">
      <UpcomingHeader
        panelMode={panelMode}
        eventCount={events.length}
        horizonEtaSeconds={horizonETA?.ridingTimeSeconds ?? null}
      />

      <FlatList
        data={events}
        keyExtractor={eventKeyExtractor}
        renderItem={renderEvent}
        showsVerticalScrollIndicator={false}
        initialNumToRender={INITIAL_RENDER_COUNT}
        maxToRenderPerBatch={LIST_MAX_BATCH}
        updateCellsBatchingPeriod={LIST_BATCHING_PERIOD_MS}
        windowSize={LIST_WINDOW_SIZE}
        removeClippedSubviews
        contentContainerStyle={{ paddingBottom: safeBottom }}
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
  event,
  currentDistanceMeters,
  units,
  onPress,
}: {
  event: UpcomingEvent;
  currentDistanceMeters: number | null;
  units: UnitSystem;
  onPress: (event: UpcomingEvent) => void;
}) {
  const colors = useThemeColors();
  const distanceAhead =
    currentDistanceMeters != null
      ? event.distanceMeters - currentDistanceMeters
      : event.distanceMeters;
  const distanceLabel =
    distanceAhead >= 0
      ? formatDistance(distanceAhead, units)
      : `-${formatDistance(Math.abs(distanceAhead), units)}`;
  const eta = event.eta;
  const plannedStopMinutes = event.kind === "poi" ? getPlannedStopDurationMinutes(event.poi) : 0;
  const departureTime =
    event.kind === "poi" ? departureTimeAfterPlannedStop(eta, plannedStopMinutes) : null;
  const hasStopInterval = plannedStopMinutes > 0 && eta != null && departureTime != null;
  const clockLabel = hasStopInterval
    ? `${formatETA(eta.eta)}-${formatETA(departureTime)}`
    : eta
      ? formatETA(eta.eta)
      : "--:--";
  const ridingTimeLabel =
    eta && eta.ridingTimeSeconds > 0 ? `~${formatDuration(eta.ridingTimeSeconds)}` : "no ETA";
  const isPressable =
    event.kind === "poi" ||
    event.kind === "climb-span" ||
    event.kind === "climb-start" ||
    event.kind === "climb-top";
  const content = eventContent(event, units, colors);
  const accessibilityLabel = [
    content.title,
    content.subtitle,
    eta ? `ETA ${clockLabel}` : null,
    `${distanceLabel} ahead`,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <TouchableOpacity
      className="flex-row items-center px-3 py-2.5 border-b border-border"
      disabled={!isPressable}
      onPress={() => onPress(event)}
      accessibilityRole={isPressable ? "button" : "text"}
      accessibilityLabel={accessibilityLabel}
    >
      <View className={hasStopInterval ? "w-[92px]" : "w-[70px]"}>
        <Text
          className={`${
            hasStopInterval ? "text-[17px]" : "text-[20px]"
          } font-barlow-sc-semibold text-foreground`}
          numberOfLines={1}
        >
          {clockLabel}
        </Text>
        <Text className="text-[12px] font-barlow-sc-medium text-muted-foreground" numberOfLines={1}>
          {ridingTimeLabel}
        </Text>
      </View>

      <View
        className="w-[42px] h-[42px] rounded-full items-center justify-center mx-2"
        style={{ backgroundColor: content.color + "1A" }}
      >
        {content.icon}
      </View>

      <View className="flex-1 min-w-0">
        <Text className="text-[15px] font-barlow-semibold text-foreground" numberOfLines={1}>
          {content.title}
        </Text>
        <Text
          className="text-[13px] font-barlow-medium"
          style={{ color: content.subtitleColor ?? colors.textSecondary }}
          numberOfLines={1}
        >
          {content.subtitle}
        </Text>
      </View>

      <View className="ml-2 items-end w-[62px]">
        <Text className="text-[18px] font-barlow-sc-semibold text-foreground" numberOfLines={1}>
          {distanceLabel}
        </Text>
        <Text className="text-[11px] font-barlow-medium text-muted-foreground" numberOfLines={1}>
          {distanceAhead >= 0 ? "ahead" : "behind"}
        </Text>
      </View>
    </TouchableOpacity>
  );
});

function eventContent(
  event: UpcomingEvent,
  units: UnitSystem,
  colors: ReturnType<typeof useThemeColors>,
) {
  switch (event.kind) {
    case "poi": {
      const meta = getCategoryMeta(event.poi.category);
      const IconComp = meta ? POI_ICON_MAP[meta.iconName] : MapPin;
      const ohStatus = event.poi.tags.opening_hours
        ? getOpeningHoursStatus(event.poi.tags.opening_hours)
        : null;
      const ohColorKey = ohStatusColorKey(ohStatus);
      const ohColor = ohColorKey ? colors[ohColorKey] : colors.textSecondary;
      const offRoute =
        event.poi.distanceFromRouteMeters > 50
          ? ` · ${Math.round(event.poi.distanceFromRouteMeters)} m off`
          : "";
      const status = ohStatus
        ? `${ohStatus.label}${ohStatus.detail ? ` · ${ohStatus.detail}` : ""}`
        : (meta?.label ?? "POI");
      return {
        title: event.poi.name ?? meta?.label ?? "Unnamed POI",
        subtitle: `${status}${offRoute}`,
        subtitleColor: ohStatus ? ohColor : meta?.color,
        color: meta?.color ?? colors.textTertiary,
        icon: <IconComp size={20} color={meta?.color ?? colors.textPrimary} />,
      };
    }
    case "climb-span":
    case "climb-start":
    case "climb-top": {
      const difficulty = getClimbDifficulty(event.climb.difficultyScore);
      const color = climbDifficultyColor(event.climb.difficultyScore);
      const titlePrefix =
        event.kind === "climb-start"
          ? "Climb starts"
          : event.kind === "climb-top"
            ? "Climb top"
            : "Climb";
      return {
        title: `${titlePrefix}: ${event.climb.name ?? "Climb"}`,
        subtitle: `${CLIMB_DIFFICULTY_LABELS[difficulty]} · ${formatDistance(
          event.climb.lengthMeters,
          units,
        )} · +${formatElevation(event.climb.totalAscentMeters, units)}`,
        subtitleColor: color,
        color,
        icon: <Mountain size={20} color={color} />,
      };
    }
    case "segment-transition":
      return {
        title: `End ${event.fromSegment.routeName}`,
        subtitle: `Start ${event.toSegment.routeName}`,
        color: colors.info,
        icon: <GitBranch size={20} color={colors.info} />,
      };
    case "finish":
      return {
        title: event.label,
        subtitle: "End of active route",
        color: colors.accent,
        icon: <Flag size={20} color={colors.accent} />,
      };
  }
}
