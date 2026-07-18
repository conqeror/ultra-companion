import { getETAToDistanceFromDistance } from "@/services/etaCalculator";
import {
  applyPlannedStopOffsetToETA,
  getPlannedStopDurationMinutes,
  plannedStopOffsetSecondsBeforeDistance,
  type PlannedStop,
} from "@/services/plannedStops";
import {
  isDistanceInWindow,
  isDistanceRangeInWindow,
  type DistanceWindow,
} from "@/utils/ridingHorizon";
import type {
  DisplayClimb,
  DisplayDistanceMeters,
  DisplayFerryCrossing,
  DisplayPOI,
  ETAResult,
  RoutePoint,
  StitchedSegmentInfo,
} from "@/types";

export type UpcomingEventKind = "poi" | "ferry" | "climb-span" | "segment-transition" | "finish";

interface UpcomingEventBase {
  id: string;
  kind: UpcomingEventKind;
  distanceMeters: DisplayDistanceMeters;
  eta: ETAResult | null;
}

export interface UpcomingPOIEvent extends UpcomingEventBase {
  kind: "poi";
  poi: DisplayPOI;
}

export interface UpcomingClimbSpanEvent extends UpcomingEventBase {
  kind: "climb-span";
  climb: DisplayClimb;
  endEta: ETAResult | null;
  isActive: boolean;
}

export interface UpcomingFerryEvent extends UpcomingEventBase {
  kind: "ferry";
  ferry: DisplayFerryCrossing;
  landingEta: ETAResult | null;
  isActive: boolean;
}

export interface UpcomingSegmentTransitionEvent extends UpcomingEventBase {
  kind: "segment-transition";
  fromSegment: StitchedSegmentInfo;
  toSegment: StitchedSegmentInfo;
}

export interface UpcomingFinishEvent extends UpcomingEventBase {
  kind: "finish";
  label: string;
}

export type UpcomingEvent =
  | UpcomingPOIEvent
  | UpcomingFerryEvent
  | UpcomingClimbSpanEvent
  | UpcomingSegmentTransitionEvent
  | UpcomingFinishEvent;

export interface BuildUpcomingTimelineInput {
  pois: DisplayPOI[];
  starredPOIIds: ReadonlySet<string>;
  climbs: DisplayClimb[];
  ferries?: DisplayFerryCrossing[];
  segments: StitchedSegmentInfo[] | null;
  totalDistanceMeters: number;
  currentDistanceMeters: number | null;
  horizonWindow?: DistanceWindow;
  routePoints?: RoutePoint[] | null;
  cumulativeTime?: number[] | null;
  etaStartTimeMs?: number | null;
  plannedStops?: readonly PlannedStop[] | null;
}

const EVENT_ORDER: Record<UpcomingEventKind, number> = {
  "segment-transition": 0,
  poi: 1,
  ferry: 2,
  "climb-span": 3,
  finish: 5,
};

export function buildUpcomingTimeline({
  pois,
  starredPOIIds,
  climbs,
  ferries = [],
  segments,
  totalDistanceMeters,
  currentDistanceMeters,
  horizonWindow,
  routePoints,
  cumulativeTime,
  etaStartTimeMs,
  plannedStops,
}: BuildUpcomingTimelineInput): UpcomingEvent[] {
  const anchorDistanceMeters = Math.max(0, currentDistanceMeters ?? 0);
  const events: UpcomingEvent[] = [];
  const importantPOIs = getImportantPOIs(pois, starredPOIIds, horizonWindow, anchorDistanceMeters);

  for (const poi of importantPOIs) {
    events.push({
      id: `poi:${poi.id}`,
      kind: "poi",
      distanceMeters: poi.effectiveDistanceMeters,
      eta: resolveETA(
        cumulativeTime,
        routePoints,
        anchorDistanceMeters,
        poi.effectiveDistanceMeters,
        etaStartTimeMs,
        plannedStops,
        ferries,
      ),
      poi,
    });
  }

  for (const ferry of ferries) {
    if (
      !isDistanceRangeInUpcomingWindow(
        ferry.effectiveStartDistanceMeters,
        ferry.effectiveEndDistanceMeters,
        horizonWindow,
        anchorDistanceMeters,
      ) ||
      ferry.effectiveEndDistanceMeters < anchorDistanceMeters
    ) {
      continue;
    }
    const isActive =
      ferry.effectiveStartDistanceMeters <= anchorDistanceMeters &&
      ferry.effectiveEndDistanceMeters > anchorDistanceMeters;
    const quayDistance = (
      isActive ? anchorDistanceMeters : ferry.effectiveStartDistanceMeters
    ) as DisplayDistanceMeters;
    events.push({
      id: `ferry:${ferry.id}:${ferry.effectiveStartDistanceMeters}`,
      kind: "ferry",
      distanceMeters: quayDistance,
      eta: resolveETA(
        cumulativeTime,
        routePoints,
        anchorDistanceMeters,
        quayDistance,
        etaStartTimeMs,
        plannedStops,
        ferries,
      ),
      landingEta: resolveETA(
        cumulativeTime,
        routePoints,
        anchorDistanceMeters,
        ferry.effectiveEndDistanceMeters,
        etaStartTimeMs,
        plannedStops,
        ferries,
      ),
      ferry,
      isActive,
    });
  }

  for (const climb of climbs) {
    if (
      !isDistanceRangeInUpcomingWindow(
        climb.effectiveStartDistanceMeters,
        climb.effectiveEndDistanceMeters,
        horizonWindow,
        anchorDistanceMeters,
      )
    ) {
      continue;
    }

    const isActive =
      climb.effectiveStartDistanceMeters < anchorDistanceMeters &&
      climb.effectiveEndDistanceMeters >= anchorDistanceMeters;
    const endEta = resolveETA(
      cumulativeTime,
      routePoints,
      anchorDistanceMeters,
      climb.effectiveEndDistanceMeters,
      etaStartTimeMs,
      plannedStops,
      ferries,
    );

    events.push({
      id: `climb-span:${climb.id}`,
      kind: "climb-span",
      distanceMeters: (isActive
        ? anchorDistanceMeters
        : climb.effectiveStartDistanceMeters) as DisplayDistanceMeters,
      eta: isActive
        ? endEta
        : resolveETA(
            cumulativeTime,
            routePoints,
            anchorDistanceMeters,
            climb.effectiveStartDistanceMeters,
            etaStartTimeMs,
            plannedStops,
            ferries,
          ),
      climb,
      endEta,
      isActive,
    });
  }

  if (segments) {
    for (let i = 0; i < segments.length - 1; i++) {
      const fromSegment = segments[i];
      const toSegment = segments[i + 1];
      const distanceMeters = toSegment.distanceOffsetMeters as DisplayDistanceMeters;
      if (!isPointInUpcomingWindow(distanceMeters, horizonWindow, anchorDistanceMeters)) continue;
      events.push({
        id: `segment:${fromSegment.routeId}:${toSegment.routeId}:${toSegment.position}`,
        kind: "segment-transition",
        distanceMeters,
        eta: resolveETA(
          cumulativeTime,
          routePoints,
          anchorDistanceMeters,
          distanceMeters,
          etaStartTimeMs,
          plannedStops,
          ferries,
        ),
        fromSegment,
        toSegment,
      });
    }
  }

  const finishDistanceMeters = totalDistanceMeters as DisplayDistanceMeters;
  if (
    totalDistanceMeters > 0 &&
    isPointInUpcomingWindow(finishDistanceMeters, horizonWindow, anchorDistanceMeters)
  ) {
    events.push({
      id: "finish",
      kind: "finish",
      distanceMeters: finishDistanceMeters,
      eta: resolveETA(
        cumulativeTime,
        routePoints,
        anchorDistanceMeters,
        finishDistanceMeters,
        etaStartTimeMs,
        plannedStops,
        ferries,
      ),
      label: segments ? "Collection finish" : "Route finish",
    });
  }

  return events.sort(compareUpcomingEvents);
}

export function resolveUpcomingHorizonETA({
  totalDistanceMeters,
  currentDistanceMeters,
  horizonWindow,
  routePoints,
  cumulativeTime,
  etaStartTimeMs,
  plannedStops,
  ferries,
}: Pick<
  BuildUpcomingTimelineInput,
  | "totalDistanceMeters"
  | "currentDistanceMeters"
  | "horizonWindow"
  | "routePoints"
  | "cumulativeTime"
  | "etaStartTimeMs"
  | "plannedStops"
  | "ferries"
>): ETAResult | null {
  const anchorDistanceMeters = Math.max(0, currentDistanceMeters ?? 0);
  const targetDistanceMeters = horizonWindow?.endDistanceMeters ?? totalDistanceMeters;
  if (targetDistanceMeters == null || targetDistanceMeters <= anchorDistanceMeters) return null;
  return resolveETA(
    cumulativeTime,
    routePoints,
    anchorDistanceMeters,
    Math.min(totalDistanceMeters, targetDistanceMeters) as DisplayDistanceMeters,
    etaStartTimeMs,
    plannedStops,
    ferries,
  );
}

function getImportantPOIs(
  pois: DisplayPOI[],
  starredPOIIds: ReadonlySet<string>,
  horizonWindow: DistanceWindow | undefined,
  anchorDistanceMeters: number,
): DisplayPOI[] {
  return pois
    .filter(
      (poi) =>
        poi.source === "custom" ||
        starredPOIIds.has(poi.id) ||
        getPlannedStopDurationMinutes(poi) > 0,
    )
    .filter((poi) =>
      isPointInUpcomingWindow(poi.effectiveDistanceMeters, horizonWindow, anchorDistanceMeters),
    )
    .sort((a, b) => a.effectiveDistanceMeters - b.effectiveDistanceMeters);
}

function isPointInUpcomingWindow(
  distanceMeters: number,
  horizonWindow: DistanceWindow | undefined,
  anchorDistanceMeters: number,
): boolean {
  if (horizonWindow) return isDistanceInWindow(distanceMeters, horizonWindow);
  return distanceMeters >= anchorDistanceMeters;
}

function isDistanceRangeInUpcomingWindow(
  startDistanceMeters: number,
  endDistanceMeters: number,
  horizonWindow: DistanceWindow | undefined,
  anchorDistanceMeters: number,
): boolean {
  if (horizonWindow)
    return isDistanceRangeInWindow(startDistanceMeters, endDistanceMeters, horizonWindow);
  return endDistanceMeters >= anchorDistanceMeters;
}

function resolveETA(
  cumulativeTime: number[] | null | undefined,
  routePoints: RoutePoint[] | null | undefined,
  currentDistanceMeters: number,
  targetDistanceMeters: DisplayDistanceMeters,
  etaStartTimeMs?: number | null,
  plannedStops?: readonly PlannedStop[] | null,
  ferries: readonly DisplayFerryCrossing[] = [],
): ETAResult | null {
  if (!cumulativeTime || !routePoints?.length) return null;
  const eta = getETAToDistanceFromDistance(
    cumulativeTime,
    routePoints,
    currentDistanceMeters,
    targetDistanceMeters,
    ferries,
  );
  const stopOffsetSeconds = plannedStopOffsetSecondsBeforeDistance(
    plannedStops,
    currentDistanceMeters,
    targetDistanceMeters,
  );
  const withStops = applyPlannedStopOffsetToETA(eta, stopOffsetSeconds, etaStartTimeMs);
  if (!withStops || etaStartTimeMs == null) return withStops;
  return {
    ...withStops,
    eta: new Date(etaStartTimeMs + withStops.ridingTimeSeconds * 1000),
  };
}

function compareUpcomingEvents(a: UpcomingEvent, b: UpcomingEvent): number {
  const distanceDelta = a.distanceMeters - b.distanceMeters;
  if (distanceDelta !== 0) return distanceDelta;
  return EVENT_ORDER[a.kind] - EVENT_ORDER[b.kind];
}
