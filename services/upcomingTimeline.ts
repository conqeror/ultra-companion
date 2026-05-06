import { getClimbDifficulty } from "@/constants/climbHelpers";
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
  DisplayPOI,
  ETAResult,
  RoutePoint,
  StitchedSegmentInfo,
} from "@/types";

export type UpcomingEventKind =
  | "poi"
  | "climb-span"
  | "climb-start"
  | "climb-top"
  | "segment-transition"
  | "finish";

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
}

export interface UpcomingClimbPointEvent extends UpcomingEventBase {
  kind: "climb-start" | "climb-top";
  climb: DisplayClimb;
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
  | UpcomingClimbSpanEvent
  | UpcomingClimbPointEvent
  | UpcomingSegmentTransitionEvent
  | UpcomingFinishEvent;

export interface BuildUpcomingTimelineInput {
  pois: DisplayPOI[];
  starredPOIIds: ReadonlySet<string>;
  climbs: DisplayClimb[];
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
  "climb-start": 0,
  "segment-transition": 1,
  poi: 2,
  "climb-span": 3,
  "climb-top": 4,
  finish: 5,
};

export function buildUpcomingTimeline({
  pois,
  starredPOIIds,
  climbs,
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
      ),
      poi,
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

    const hasImportantPOIInside = importantPOIs.some(
      (poi) =>
        poi.effectiveDistanceMeters >= climb.effectiveStartDistanceMeters &&
        poi.effectiveDistanceMeters <= climb.effectiveEndDistanceMeters,
    );
    const shouldSplit =
      getClimbDifficulty(climb.difficultyScore) !== "low" || hasImportantPOIInside;

    if (shouldSplit) {
      if (
        isPointInUpcomingWindow(
          climb.effectiveStartDistanceMeters,
          horizonWindow,
          anchorDistanceMeters,
        )
      ) {
        events.push({
          id: `climb-start:${climb.id}`,
          kind: "climb-start",
          distanceMeters: climb.effectiveStartDistanceMeters,
          eta: resolveETA(
            cumulativeTime,
            routePoints,
            anchorDistanceMeters,
            climb.effectiveStartDistanceMeters,
            etaStartTimeMs,
            plannedStops,
          ),
          climb,
        });
      }
      if (
        isPointInUpcomingWindow(
          climb.effectiveEndDistanceMeters,
          horizonWindow,
          anchorDistanceMeters,
        )
      ) {
        events.push({
          id: `climb-top:${climb.id}`,
          kind: "climb-top",
          distanceMeters: climb.effectiveEndDistanceMeters,
          eta: resolveETA(
            cumulativeTime,
            routePoints,
            anchorDistanceMeters,
            climb.effectiveEndDistanceMeters,
            etaStartTimeMs,
            plannedStops,
          ),
          climb,
        });
      }
      continue;
    }

    events.push({
      id: `climb-span:${climb.id}`,
      kind: "climb-span",
      distanceMeters: climb.effectiveStartDistanceMeters,
      eta: resolveETA(
        cumulativeTime,
        routePoints,
        anchorDistanceMeters,
        climb.effectiveStartDistanceMeters,
        etaStartTimeMs,
        plannedStops,
      ),
      climb,
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
}: Pick<
  BuildUpcomingTimelineInput,
  | "totalDistanceMeters"
  | "currentDistanceMeters"
  | "horizonWindow"
  | "routePoints"
  | "cumulativeTime"
  | "etaStartTimeMs"
  | "plannedStops"
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
): ETAResult | null {
  if (!cumulativeTime || !routePoints?.length) return null;
  const eta = getETAToDistanceFromDistance(
    cumulativeTime,
    routePoints,
    currentDistanceMeters,
    targetDistanceMeters,
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
