import { climbDifficultyColor } from "@/constants/climbHelpers";
import { getCategoryMeta } from "@/constants/poiHelpers";
import {
  departureTimeAfterPlannedStop,
  getPlannedStopDurationMinutes,
} from "@/services/plannedStops";
import type { UpcomingEvent, UpcomingEventKind } from "@/services/upcomingTimeline";
import { isOpenAt } from "@/services/openingHoursParser";
import {
  formatDistance,
  formatDuration,
  formatElevation,
  formatETA,
  formatUpcomingDayHeaderLabel,
  localCalendarDayOrdinal,
} from "@/utils/formatters";
import type { ThemeColors } from "@/theme";
import type { UnitSystem } from "@/types";

type ThemeColorValues = Record<keyof ThemeColors, string>;

export type UpcomingRowColor =
  | { kind: "theme"; key: keyof ThemeColors }
  | { kind: "value"; value: string };

export type UpcomingRowIcon =
  | { kind: "poi"; iconName: string }
  | { kind: "climb" }
  | { kind: "segment" }
  | { kind: "finish" };

export interface UpcomingRowModel {
  id: string;
  itemType: UpcomingEventKind;
  event: UpcomingEvent;
  isPressable: boolean;
  title: string;
  subtitle: string;
  subtitleColor: UpcomingRowColor;
  accentColor: UpcomingRowColor;
  icon: UpcomingRowIcon;
  clockLabel: string;
  departureLabel: string | null;
  climbEndLabel: string | null;
  ridingTimeLabel: string;
  distanceLabel: string;
  distanceDirectionLabel: "ahead" | "behind";
  hasStopInterval: boolean;
  hasClimbInterval: boolean;
  accessibilityLabel: string;
}

export interface UpcomingDayHeaderModel {
  id: string;
  itemType: "day-header";
  label: string;
  accessibilityLabel: string;
}

export type UpcomingListItemModel = UpcomingRowModel | UpcomingDayHeaderModel;
export type UpcomingListItemType = UpcomingEventKind | "day-header";

export interface BuildUpcomingRowModelsInput {
  events: readonly UpcomingEvent[];
  currentDistanceMeters: number | null;
  units: UnitSystem;
}

export interface BuildUpcomingListItemsInput {
  rows: readonly UpcomingRowModel[];
  etaBaseTimeMs: number;
}

interface BuildUpcomingRowModelInput {
  event: UpcomingEvent;
  currentDistanceMeters: number | null;
  units: UnitSystem;
}

export function buildUpcomingRowModels({
  events,
  currentDistanceMeters,
  units,
}: BuildUpcomingRowModelsInput): UpcomingRowModel[] {
  return events.map((event) => buildUpcomingRowModel({ event, currentDistanceMeters, units }));
}

export function buildUpcomingListItems({
  rows,
  etaBaseTimeMs,
}: BuildUpcomingListItemsInput): UpcomingListItemModel[] {
  const items: UpcomingListItemModel[] = [];
  let currentDayKey: string | null = null;

  for (const row of rows) {
    const etaDate = row.event.eta?.eta;
    const dayKey = etaDate ? upcomingDayKey(etaDate) : null;

    if (etaDate && dayKey && dayKey !== currentDayKey) {
      const dayOrdinal = localCalendarDayOrdinal(etaDate, etaBaseTimeMs);
      const label = formatUpcomingDayHeaderLabel(etaDate, etaBaseTimeMs);
      items.push({
        id: `day:${dayOrdinal}:${dayKey}`,
        itemType: "day-header",
        label,
        accessibilityLabel: label,
      });
      currentDayKey = dayKey;
    }

    items.push(row);
  }

  return items;
}

export function getUpcomingRowItemType(item: UpcomingRowModel): UpcomingEventKind {
  return item.itemType;
}

export function getUpcomingListItemType(item: UpcomingListItemModel): UpcomingListItemType {
  return item.itemType;
}

export function resolveUpcomingRowColor(color: UpcomingRowColor, colors: ThemeColorValues): string {
  return color.kind === "theme" ? colors[color.key] : color.value;
}

function upcomingDayKey(date: Date): string | null {
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildUpcomingRowModel({
  event,
  currentDistanceMeters,
  units,
}: BuildUpcomingRowModelInput): UpcomingRowModel {
  const distanceAhead =
    currentDistanceMeters != null
      ? event.distanceMeters - currentDistanceMeters
      : event.distanceMeters;
  const distanceLabel =
    distanceAhead >= 0
      ? formatDistance(distanceAhead, units)
      : `-${formatDistance(Math.abs(distanceAhead), units)}`;
  const distanceDirectionLabel = distanceAhead >= 0 ? "ahead" : "behind";
  const eta = event.eta;
  const plannedStopMinutes = event.kind === "poi" ? getPlannedStopDurationMinutes(event.poi) : 0;
  const departureTime =
    event.kind === "poi" ? departureTimeAfterPlannedStop(eta, plannedStopMinutes) : null;
  const hasStopInterval = plannedStopMinutes > 0 && eta != null && departureTime != null;
  const hasClimbInterval = event.kind === "climb-span" && !event.isActive && event.endEta != null;
  const clockLabel = eta ? formatETA(eta.eta) : "--:--";
  const departureLabel = departureTime ? formatETA(departureTime) : null;
  const climbEndLabel =
    event.kind === "climb-span" && event.endEta ? formatETA(event.endEta.eta) : null;
  const primaryRidingTime = eta ?? (event.kind === "climb-span" ? event.endEta : null);
  const ridingTimeLabel =
    primaryRidingTime && primaryRidingTime.ridingTimeSeconds > 0
      ? `~${formatDuration(primaryRidingTime.ridingTimeSeconds)}`
      : "no ETA";
  const content = upcomingEventContent(event, units);
  const isPressable = event.kind === "poi" || event.kind === "climb-span";
  const accessibilityLabel = [
    content.title,
    content.subtitle,
    eta ? `ETA ${clockLabel}` : null,
    hasStopInterval && departureLabel ? `depart ${departureLabel}` : null,
    hasClimbInterval && climbEndLabel ? `end ${climbEndLabel}` : null,
    `${distanceLabel} ${distanceDirectionLabel}`,
  ]
    .filter(Boolean)
    .join(", ");

  return {
    id: event.id,
    itemType: event.kind,
    event,
    isPressable,
    title: content.title,
    subtitle: content.subtitle,
    subtitleColor: content.subtitleColor,
    accentColor: content.accentColor,
    icon: content.icon,
    clockLabel,
    departureLabel,
    climbEndLabel,
    ridingTimeLabel,
    distanceLabel,
    distanceDirectionLabel,
    hasStopInterval,
    hasClimbInterval,
    accessibilityLabel,
  };
}

function upcomingEventContent(
  event: UpcomingEvent,
  units: UnitSystem,
): Pick<UpcomingRowModel, "title" | "subtitle" | "subtitleColor" | "accentColor" | "icon"> {
  switch (event.kind) {
    case "poi": {
      const meta = getCategoryMeta(event.poi.category);
      const etaOpen =
        event.eta && event.poi.tags.opening_hours
          ? isOpenAt(event.poi.tags.opening_hours, event.eta.eta)
          : null;
      const offRoute =
        event.poi.distanceFromRouteMeters > 50
          ? ` · ${Math.round(event.poi.distanceFromRouteMeters)} m off`
          : "";
      const status =
        etaOpen == null ? (meta?.label ?? "POI") : etaOpen ? "Open @ ETA" : "Closed @ ETA";
      return {
        title: event.poi.name ?? meta?.label ?? "Unnamed POI",
        subtitle: `${status}${offRoute}`,
        subtitleColor:
          etaOpen == null
            ? { kind: "value", value: meta?.color ?? "#9C958E" }
            : etaOpen
              ? { kind: "theme", key: "positive" }
              : { kind: "theme", key: "destructive" },
        accentColor: { kind: "value", value: meta?.color ?? "#9C958E" },
        icon: { kind: "poi", iconName: meta?.iconName ?? "MapPin" },
      };
    }
    case "climb-span": {
      const color = climbDifficultyColor(event.climb.difficultyScore);
      return {
        title: event.climb.name ?? "Climb",
        subtitle: `${formatDistance(event.climb.lengthMeters, units)} · +${formatElevation(
          event.climb.totalAscentMeters,
          units,
        )} · ${event.climb.averageGradientPercent}% avg`,
        subtitleColor: { kind: "value", value: color },
        accentColor: { kind: "value", value: color },
        icon: { kind: "climb" },
      };
    }
    case "segment-transition":
      return {
        title: `End ${event.fromSegment.routeName}`,
        subtitle: `Start ${event.toSegment.routeName}`,
        subtitleColor: { kind: "theme", key: "textSecondary" },
        accentColor: { kind: "theme", key: "info" },
        icon: { kind: "segment" },
      };
    case "finish":
      return {
        title: event.label,
        subtitle: "End of active route",
        subtitleColor: { kind: "theme", key: "textSecondary" },
        accentColor: { kind: "theme", key: "accent" },
        icon: { kind: "finish" },
      };
  }
}
