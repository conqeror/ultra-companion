import {
  ridingDistanceAtGeometricDistance,
  type FerryDistanceSpan,
} from "@/services/ferryCrossings";

export interface ElevationProfileFerrySpan {
  id: string;
  name: string;
  startDistanceMeters: number;
  endDistanceMeters: number;
}

export interface ElevationProfileFerryMarker {
  id: string;
  name: string;
  leftPixels: number;
  widthPixels: number;
  centerXPixels: number;
  isCollapsed: boolean;
}

interface BuildElevationProfileFerryMarkersOptions {
  totalDistanceMeters: number;
  contentWidthPixels: number;
  distanceOffsetMeters?: number;
  minimumWidthPixels?: number;
}

const DISTANCE_EPSILON_METERS = 0.01;
const DEFAULT_MINIMUM_WIDTH_PIXELS = 24;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

/**
 * Converts raw route ferry bounds into the riding-distance coordinate system.
 * A fully excluded crossing naturally collapses to one distance; renderers give
 * that zero-width interval a small semantic marker without adding route km.
 */
export function projectFerrySpansForRidingProfile(
  ferries: readonly ElevationProfileFerrySpan[],
  excludedSpans: readonly FerryDistanceSpan[],
): ElevationProfileFerrySpan[] {
  return ferries.map((ferry) => ({
    ...ferry,
    startDistanceMeters: ridingDistanceAtGeometricDistance(
      ferry.startDistanceMeters,
      excludedSpans,
    ),
    endDistanceMeters: ridingDistanceAtGeometricDistance(ferry.endDistanceMeters, excludedSpans),
  }));
}

/** Builds clipped pixel bands for ferry spans in a full or sliced profile. */
export function buildElevationProfileFerryMarkers(
  ferries: readonly ElevationProfileFerrySpan[] | undefined,
  options: BuildElevationProfileFerryMarkersOptions,
): ElevationProfileFerryMarker[] {
  const totalDistanceMeters = Number.isFinite(options.totalDistanceMeters)
    ? Math.max(0, options.totalDistanceMeters)
    : 0;
  const contentWidthPixels = Number.isFinite(options.contentWidthPixels)
    ? Math.max(0, options.contentWidthPixels)
    : 0;
  if (!ferries?.length || totalDistanceMeters <= 0 || contentWidthPixels <= 0) return [];

  const distanceOffsetMeters = Number.isFinite(options.distanceOffsetMeters)
    ? (options.distanceOffsetMeters ?? 0)
    : 0;
  const minimumWidthPixels = Number.isFinite(options.minimumWidthPixels)
    ? Math.max(0, options.minimumWidthPixels ?? DEFAULT_MINIMUM_WIDTH_PIXELS)
    : DEFAULT_MINIMUM_WIDTH_PIXELS;
  const markers: ElevationProfileFerryMarker[] = [];

  for (const ferry of ferries) {
    if (!Number.isFinite(ferry.startDistanceMeters) || !Number.isFinite(ferry.endDistanceMeters)) {
      continue;
    }
    const absoluteStart = Math.min(ferry.startDistanceMeters, ferry.endDistanceMeters);
    const absoluteEnd = Math.max(ferry.startDistanceMeters, ferry.endDistanceMeters);
    const localStart = absoluteStart - distanceOffsetMeters;
    const localEnd = absoluteEnd - distanceOffsetMeters;
    if (localEnd < 0 || localStart > totalDistanceMeters) continue;

    const visibleStart = clamp(localStart, 0, totalDistanceMeters);
    const visibleEnd = clamp(localEnd, 0, totalDistanceMeters);
    const startX = (visibleStart / totalDistanceMeters) * contentWidthPixels;
    const endX = (visibleEnd / totalDistanceMeters) * contentWidthPixels;
    const centerXPixels = (startX + endX) / 2;
    const widthPixels = Math.min(contentWidthPixels, Math.max(endX - startX, minimumWidthPixels));
    const leftPixels = clamp(
      centerXPixels - widthPixels / 2,
      0,
      Math.max(0, contentWidthPixels - widthPixels),
    );

    markers.push({
      id: ferry.id,
      name: ferry.name,
      leftPixels,
      widthPixels,
      centerXPixels: clamp(centerXPixels, leftPixels, leftPixels + widthPixels),
      isCollapsed: absoluteEnd - absoluteStart <= DISTANCE_EPSILON_METERS,
    });
  }

  return markers.sort(
    (first, second) =>
      first.centerXPixels - second.centerXPixels || first.id.localeCompare(second.id),
  );
}
