import { POI_CATEGORIES } from "@/constants";
import { getCategoryMeta, ohStatusColorKey } from "@/constants/poiHelpers";
import {
  applyPlannedStopOffsetToETA,
  plannedStopOffsetSecondsBeforeDistance,
  type PlannedStop,
} from "@/services/plannedStops";
import { toDisplayPOIs } from "@/services/displayDistance";
import { getETAToDistanceFromDistance } from "@/services/etaCalculator";
import { isOpenAt } from "@/services/openingHoursParser";
import { stitchPOIs } from "@/services/stitchingService";
import { formatDistance, formatDuration, formatETA } from "@/utils/formatters";
import { isDistanceInWindow, type DistanceWindow } from "@/utils/ridingHorizon";
import type {
  DisplayPOI,
  ETAResult,
  POI,
  POICategory,
  POICategoryMeta,
  RoutePoint,
  StitchedSegmentInfo,
  UnitSystem,
} from "@/types";

export type POICategoryCountMap = Partial<Record<POICategory, number>>;
export type OpeningHoursColorKey = NonNullable<ReturnType<typeof ohStatusColorKey>>;

export interface POIListRowModel {
  id: string;
  poi: DisplayPOI;
  title: string;
  categoryLabel: string;
  categoryColor: string;
  iconName: string;
  distanceText: string | null;
  distanceDirectionLabel: "ahead" | "behind" | null;
  ridingTimeText: string | null;
  etaAccessibilityText: string | null;
  openingHoursText: string | null;
  openingHoursColorKey: OpeningHoursColorKey | null;
  etaOpeningText: string | null;
  etaOpeningColorKey: OpeningHoursColorKey | null;
  offRouteText: string | null;
  isStarred: boolean;
  accessibilityLabel: string;
}

export interface CompactPOIRowModel {
  id: string;
  poi: DisplayPOI;
  title: string;
  categoryLabel: string;
  categoryColor: string;
  iconName: string;
  distanceText: string | null;
  signedDistanceText: string | null;
  distanceDirectionLabel: "ahead" | "behind" | null;
  ridingTimeText: string | null;
  openingHoursText: string | null;
  openingHoursColorKey: OpeningHoursColorKey | null;
  etaOpeningText: string | null;
  etaOpeningColorKey: OpeningHoursColorKey | null;
  offRouteText: string | null;
  accessibilityLabel: string;
}

interface ActivePOIInput {
  routeIds: readonly string[];
  segments: readonly StitchedSegmentInfo[] | null;
  poisByRoute: Record<string, readonly POI[]>;
  horizonWindow?: DistanceWindow;
}

interface VisiblePOIInput extends ActivePOIInput {
  enabledCategories: readonly POICategory[];
  starredPOIIds: ReadonlySet<string>;
}

interface RowModelInput {
  pois: readonly DisplayPOI[];
  currentDistanceMeters: number | null;
  routePoints: RoutePoint[] | null;
  cumulativeTime: number[] | null;
  plannedStops?: readonly PlannedStop[] | null;
  etaStartTimeMs?: number | null;
  starredPOIIds: ReadonlySet<string>;
  units: UnitSystem;
  searchQuery?: string;
  referenceTime?: Date;
}

type CommonPOIRowModelInput = Omit<RowModelInput, "pois" | "searchQuery"> & {
  poi: DisplayPOI;
};

const FALLBACK_CATEGORY_META: POICategoryMeta = {
  key: "other",
  label: "POI",
  group: "other",
  color: "#64748B",
  iconName: "MapPin",
};

export function buildPOICategoryCounts(
  poisByRoute: Record<string, readonly POI[]>,
  routeIds: readonly string[],
): POICategoryCountMap {
  const counts: POICategoryCountMap = {};
  for (const routeId of routeIds) {
    for (const poi of poisByRoute[routeId] ?? []) {
      counts[poi.category] = (counts[poi.category] ?? 0) + 1;
    }
  }
  return counts;
}

export function buildPOICategoryCountsFromPOIs(pois: readonly DisplayPOI[]): POICategoryCountMap {
  const counts: POICategoryCountMap = {};
  for (const poi of pois) {
    counts[poi.category] = (counts[poi.category] ?? 0) + 1;
  }
  return counts;
}

export function buildVisiblePOIsForActiveRoute({
  routeIds,
  segments,
  poisByRoute,
  horizonWindow,
  enabledCategories,
  starredPOIIds,
}: VisiblePOIInput): DisplayPOI[] {
  return buildDisplayPOIs({
    routeIds,
    segments,
    poisByRoute,
    horizonWindow,
    predicate: (poi) => isVisibleByPOIFilters(poi, enabledCategories, starredPOIIds),
  });
}

export function buildStarredPOIsForActiveRoute({
  routeIds,
  segments,
  poisByRoute,
  horizonWindow,
  starredPOIIds,
}: ActivePOIInput & { starredPOIIds: ReadonlySet<string> }): DisplayPOI[] {
  return buildDisplayPOIs({
    routeIds,
    segments,
    poisByRoute,
    horizonWindow,
    predicate: (poi) => starredPOIIds.has(poi.id),
  });
}

export function buildPOIListRowModels({
  pois,
  currentDistanceMeters,
  routePoints,
  cumulativeTime,
  plannedStops,
  etaStartTimeMs,
  starredPOIIds,
  units,
  searchQuery,
  referenceTime,
}: RowModelInput): POIListRowModel[] {
  const q = searchQuery?.trim().toLowerCase() ?? "";
  const sorted = [...pois].sort(compareDisplayPOIs);
  const visible = q ? sorted.filter((poi) => poi.name?.toLowerCase().includes(q)) : sorted;

  return visible.map((poi) => {
    const common = buildCommonPOIRowModel({
      poi,
      currentDistanceMeters,
      routePoints,
      cumulativeTime,
      plannedStops,
      etaStartTimeMs,
      starredPOIIds,
      units,
      referenceTime,
    });
    return {
      id: common.id,
      poi: common.poi,
      title: common.title,
      categoryLabel: common.categoryLabel,
      categoryColor: common.categoryColor,
      iconName: common.iconName,
      distanceText: common.distanceText,
      distanceDirectionLabel: common.distanceDirectionLabel,
      ridingTimeText: common.ridingTimeText,
      openingHoursText: common.openingHoursText,
      openingHoursColorKey: common.openingHoursColorKey,
      etaOpeningText: common.etaOpeningText,
      etaOpeningColorKey: common.etaOpeningColorKey,
      offRouteText: common.offRouteText,
      isStarred: starredPOIIds.has(poi.id),
      etaAccessibilityText: common.etaAccessibilityText,
      accessibilityLabel: [
        common.title,
        common.distanceText && common.distanceDirectionLabel
          ? `${common.distanceText} ${common.distanceDirectionLabel}`
          : null,
        common.etaAccessibilityText,
        common.etaOpeningText ?? common.openingHoursText,
        common.offRouteText,
      ]
        .filter(Boolean)
        .join(", "),
    };
  });
}

export function buildCompactPOIRowModels(input: RowModelInput): CompactPOIRowModel[] {
  return [...input.pois].sort(compareDisplayPOIs).map((poi) => {
    const common = buildCommonPOIRowModel({ ...input, poi });
    const signedDistanceText =
      common.distanceText == null
        ? null
        : common.distanceDirectionLabel === "behind"
          ? `-${common.distanceText}`
          : common.distanceText;

    return {
      id: common.id,
      poi,
      title: common.title,
      categoryLabel: common.categoryLabel,
      categoryColor: common.categoryColor,
      iconName: common.iconName,
      distanceText: common.distanceText,
      signedDistanceText,
      distanceDirectionLabel: common.distanceDirectionLabel,
      ridingTimeText: common.ridingTimeText,
      openingHoursText: common.openingHoursText,
      openingHoursColorKey: common.openingHoursColorKey,
      etaOpeningText: common.etaOpeningText,
      etaOpeningColorKey: common.etaOpeningColorKey,
      offRouteText: common.offRouteText,
      accessibilityLabel: [
        common.title,
        common.distanceText && common.distanceDirectionLabel
          ? `${common.distanceText} ${common.distanceDirectionLabel}`
          : null,
        common.ridingTimeText ? `${common.ridingTimeText} riding` : null,
        common.etaOpeningText ?? common.openingHoursText,
        common.offRouteText,
      ]
        .filter(Boolean)
        .join(", "),
    };
  });
}

function buildDisplayPOIs({
  routeIds,
  segments,
  poisByRoute,
  horizonWindow,
  predicate,
}: ActivePOIInput & { predicate: (poi: POI) => boolean }): DisplayPOI[] {
  if (routeIds.length === 0) return [];
  const filteredByRoute: Record<string, POI[]> = {};
  for (const routeId of routeIds) {
    filteredByRoute[routeId] = (poisByRoute[routeId] ?? []).filter(predicate);
  }

  if (segments) return stitchPOIs([...segments], filteredByRoute, horizonWindow);

  return routeIds
    .flatMap((routeId) =>
      toDisplayPOIs(
        filteredByRoute[routeId].filter((poi) =>
          isDistanceInWindow(poi.distanceAlongRouteMeters, horizonWindow),
        ),
      ),
    )
    .sort(compareDisplayPOIs);
}

function isVisibleByPOIFilters(
  poi: POI,
  enabledCategories: readonly POICategory[],
  starredPOIIds: ReadonlySet<string>,
): boolean {
  const categoryEnabled = enabledCategories.includes(poi.category);
  const isStarred = starredPOIIds.has(poi.id);
  if (isStarred) return true;
  if (!categoryEnabled) return false;
  return true;
}

function buildCommonPOIRowModel({
  poi,
  currentDistanceMeters,
  routePoints,
  cumulativeTime,
  plannedStops,
  etaStartTimeMs,
  units,
}: CommonPOIRowModelInput) {
  const meta = getCategoryMeta(poi.category) ?? FALLBACK_CATEGORY_META;
  const distanceReferenceMeters = currentDistanceMeters ?? 0;
  const distAhead = poi.effectiveDistanceMeters - distanceReferenceMeters;
  const distanceText = formatDistance(Math.abs(distAhead), units);
  const distanceDirectionLabel = distAhead >= 0 ? ("ahead" as const) : ("behind" as const);
  const etaResult = resolvePOIETA({
    poi,
    currentDistanceMeters,
    routePoints,
    cumulativeTime,
    plannedStops,
    etaStartTimeMs,
  });
  const ridingTimeText =
    etaResult && etaResult.ridingTimeSeconds > 0
      ? formatDuration(etaResult.ridingTimeSeconds)
      : null;
  const etaAccessibilityText =
    etaResult && etaResult.ridingTimeSeconds > 0
      ? `${formatDuration(etaResult.ridingTimeSeconds)}, ETA ${formatETA(etaResult.eta)}`
      : null;
  const etaOpen =
    etaResult && poi.tags?.opening_hours ? isOpenAt(poi.tags.opening_hours, etaResult.eta) : null;
  const etaOpeningText = etaOpen == null ? null : etaOpen ? "Open @ ETA" : "Closed @ ETA";
  const etaOpeningColorKey: OpeningHoursColorKey | null =
    etaOpen == null ? null : etaOpen ? "positive" : "destructive";
  const openingHoursText = etaOpeningText;
  const openingHoursColorKey = etaOpeningColorKey;
  const offRouteText =
    poi.distanceFromRouteMeters > 50 ? `${Math.round(poi.distanceFromRouteMeters)} m off` : null;

  return {
    id: poi.id,
    poi,
    title: poi.name ?? meta.label ?? "Unnamed",
    categoryLabel: meta.label,
    categoryColor: meta.color,
    iconName: meta.iconName,
    distanceText,
    distanceDirectionLabel,
    ridingTimeText,
    etaAccessibilityText,
    openingHoursText,
    openingHoursColorKey,
    etaOpeningText,
    etaOpeningColorKey,
    offRouteText,
  };
}

function resolvePOIETA({
  poi,
  currentDistanceMeters,
  routePoints,
  cumulativeTime,
  plannedStops,
  etaStartTimeMs,
}: {
  poi: DisplayPOI;
  currentDistanceMeters: number | null;
  routePoints: RoutePoint[] | null;
  cumulativeTime: number[] | null;
  plannedStops?: readonly PlannedStop[] | null;
  etaStartTimeMs?: number | null;
}): ETAResult | null {
  if (!cumulativeTime || !routePoints?.length || currentDistanceMeters == null) return null;
  if (poi.effectiveDistanceMeters <= currentDistanceMeters) return null;
  const eta = getETAToDistanceFromDistance(
    cumulativeTime,
    routePoints,
    currentDistanceMeters,
    poi.effectiveDistanceMeters,
  );
  const stopOffsetSeconds = plannedStopOffsetSecondsBeforeDistance(
    plannedStops,
    currentDistanceMeters,
    poi.effectiveDistanceMeters,
  );
  const withStops = applyPlannedStopOffsetToETA(eta, stopOffsetSeconds, etaStartTimeMs);
  if (!withStops || etaStartTimeMs == null) return withStops;
  return {
    ...withStops,
    eta: new Date(etaStartTimeMs + withStops.ridingTimeSeconds * 1000),
  };
}

function compareDisplayPOIs(a: DisplayPOI, b: DisplayPOI): number {
  return a.effectiveDistanceMeters - b.effectiveDistanceMeters;
}

export function hasAnyPOICategoryCounts(counts: POICategoryCountMap): boolean {
  return POI_CATEGORIES.some((category) => (counts[category.key] ?? 0) > 0);
}
