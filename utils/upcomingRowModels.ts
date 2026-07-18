import { climbDifficultyColor } from "@/constants/climbHelpers";
import { getCategoryMeta } from "@/constants/poiHelpers";
import {
  departureTimeAfterPlannedStop,
  getPlannedStopDurationMinutes,
} from "@/services/plannedStops";
import type { UpcomingEvent, UpcomingEventKind } from "@/services/upcomingTimeline";
import type { FerryDeparture } from "@/services/ferryTimetable";
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
import type { DisplayFerryCrossing } from "@/types";
import {
  ferryEndDistanceMeters,
  ferryStartDistanceMeters,
  ridingDistanceBetween,
} from "@/services/ferryCrossings";

type ThemeColorValues = Record<keyof ThemeColors, string>;

export type UpcomingRowColor =
  | { kind: "theme"; key: keyof ThemeColors }
  | { kind: "value"; value: string };

export type UpcomingRowIcon =
  | { kind: "poi"; iconName: string }
  | { kind: "climb" }
  | { kind: "ferry" }
  | { kind: "segment" }
  | { kind: "finish" };

export interface UpcomingRowModel {
  id: string;
  itemType: UpcomingEventKind;
  event: UpcomingEvent;
  isPressable: boolean;
  title: string;
  subtitle: string;
  subtitleNumberOfLines: 1 | 2 | 3;
  subtitleColor: UpcomingRowColor;
  accentColor: UpcomingRowColor;
  icon: UpcomingRowIcon;
  clockLabel: string;
  departureLabel: string | null;
  climbEndLabel: string | null;
  ferryLandingLabel: string | null;
  ridingTimeLabel: string;
  distanceLabel: string;
  distanceDirectionLabel: "ahead" | "behind";
  hasStopInterval: boolean;
  hasClimbInterval: boolean;
  hasFerryInterval: boolean;
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
  ferries?: readonly DisplayFerryCrossing[];
  ferryDepartures?: Readonly<Record<string, FerryDeparture | undefined>>;
}

export interface BuildUpcomingListItemsInput {
  rows: readonly UpcomingRowModel[];
  etaBaseTimeMs: number;
}

interface BuildUpcomingRowModelInput {
  event: UpcomingEvent;
  currentDistanceMeters: number | null;
  units: UnitSystem;
  ferries: readonly DisplayFerryCrossing[];
  ferryDepartures: Readonly<Record<string, FerryDeparture | undefined>>;
}

export function buildUpcomingRowModels({
  events,
  currentDistanceMeters,
  units,
  ferries = [],
  ferryDepartures = {},
}: BuildUpcomingRowModelsInput): UpcomingRowModel[] {
  return events.map((event) =>
    buildUpcomingRowModel({ event, currentDistanceMeters, units, ferries, ferryDepartures }),
  );
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
  ferries,
  ferryDepartures,
}: BuildUpcomingRowModelInput): UpcomingRowModel {
  const geometricDistanceAhead =
    currentDistanceMeters != null
      ? event.distanceMeters - currentDistanceMeters
      : event.distanceMeters;
  const distanceAhead =
    currentDistanceMeters != null && geometricDistanceAhead >= 0
      ? ridingDistanceBetween(
          currentDistanceMeters,
          event.distanceMeters,
          ferries.map((crossing) => ({
            startDistanceMeters: ferryStartDistanceMeters(crossing),
            endDistanceMeters: ferryEndDistanceMeters(crossing),
          })),
        )
      : geometricDistanceAhead;
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
  const ferryDeparture = event.kind === "ferry" ? ferryDepartures[event.ferry.id] : undefined;
  const concreteDepartureDate = validTimetableDate(ferryDeparture?.departureTime);
  const concreteArrivalDate = validTimetableDate(ferryDeparture?.arrivalTime);
  const hasFerryInterval =
    event.kind === "ferry" && (concreteArrivalDate != null || event.landingEta != null);
  const clockLabel = eta ? formatETA(eta.eta) : "--:--";
  const departureLabel = departureTime ? formatETA(departureTime) : null;
  const climbEndLabel =
    event.kind === "climb-span" && event.endEta ? formatETA(event.endEta.eta) : null;
  const ferryLandingLabel =
    event.kind === "ferry"
      ? concreteArrivalDate
        ? formatETA(concreteArrivalDate)
        : event.landingEta
          ? formatETA(event.landingEta.eta)
          : null
      : null;
  const primaryRidingTime = eta ?? (event.kind === "climb-span" ? event.endEta : null);
  const ridingTimeLabel =
    primaryRidingTime && primaryRidingTime.ridingTimeSeconds > 0
      ? `~${formatDuration(primaryRidingTime.ridingTimeSeconds)}`
      : "no ETA";
  const content = upcomingEventContent(event, units, ferryDeparture);
  const subtitleNumberOfLines: UpcomingRowModel["subtitleNumberOfLines"] =
    event.kind === "ferry" ? (event.isActive ? 3 : 2) : 1;
  const isPressable = event.kind === "poi" || event.kind === "climb-span";
  const accessibilityLabel = [
    content.title,
    content.subtitle,
    eta ? `ETA ${clockLabel}` : null,
    hasStopInterval && departureLabel ? `depart ${departureLabel}` : null,
    hasClimbInterval && climbEndLabel ? `end ${climbEndLabel}` : null,
    concreteDepartureDate ? `next scheduled departure ${formatETA(concreteDepartureDate)}` : null,
    hasFerryInterval && ferryLandingLabel ? `land ${ferryLandingLabel}` : null,
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
    subtitleNumberOfLines,
    subtitleColor: content.subtitleColor,
    accentColor: content.accentColor,
    icon: content.icon,
    clockLabel,
    departureLabel,
    climbEndLabel,
    ferryLandingLabel,
    ridingTimeLabel,
    distanceLabel,
    distanceDirectionLabel,
    hasStopInterval,
    hasClimbInterval,
    hasFerryInterval,
    accessibilityLabel,
  };
}

function upcomingEventContent(
  event: UpcomingEvent,
  units: UnitSystem,
  ferryDeparture?: FerryDeparture,
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
    case "ferry": {
      const departureDate = validTimetableDate(ferryDeparture?.departureTime);
      const arrivalDate = validTimetableDate(ferryDeparture?.arrivalTime);
      if (departureDate) {
        const concreteDurationMinutes = arrivalDate
          ? Math.max(0, Math.round((arrivalDate.getTime() - departureDate.getTime()) / 60_000))
          : event.ferry.durationMinutes;
        return {
          title: event.ferry.name,
          subtitle: [
            `Next ${formatETA(departureDate)}${arrivalDate ? ` → ${formatETA(arrivalDate)}` : ""}`,
            `${concreteDurationMinutes} min crossing · Entur schedule`,
          ].join("\n"),
          subtitleColor: { kind: "theme", key: "info" },
          accentColor: { kind: "theme", key: "info" },
          icon: { kind: "ferry" },
        };
      }
      return {
        title: event.ferry.name,
        subtitle: [
          event.isActive ? "On ferry" : null,
          `${event.ferry.durationMinutes} min crossing`,
          `${event.ferry.assumedWaitMinutes} min assumed wait`,
        ]
          .filter(Boolean)
          .join("\n"),
        subtitleColor: { kind: "theme", key: "info" },
        accentColor: { kind: "theme", key: "info" },
        icon: { kind: "ferry" },
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

function validTimetableDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
