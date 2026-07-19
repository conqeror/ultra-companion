import {
  ridingDistanceAtGeometricDistance,
  type FerryDistanceSpan,
} from "@/services/ferryCrossings";

export interface ElevationProfileFerrySpan {
  id: string;
  name: string;
  startDistanceMeters: number;
  endDistanceMeters: number;
  /** Geometric route length retained when riding-distance projection collapses the interval. */
  routeLengthMeters?: number;
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
}

const DISTANCE_EPSILON_METERS = 0.01;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

/**
 * Converts raw route ferry bounds into the riding-distance coordinate system.
 * A fully excluded crossing naturally collapses to one distance, so retain its
 * geometric length separately for an accurately scaled profile band.
 */
export function projectFerrySpansForRidingProfile(
  ferries: readonly ElevationProfileFerrySpan[],
  excludedSpans: readonly FerryDistanceSpan[],
): ElevationProfileFerrySpan[] {
  return ferries.map((ferry) => {
    const startDistanceMeters = ridingDistanceAtGeometricDistance(
      ferry.startDistanceMeters,
      excludedSpans,
    );
    const endDistanceMeters = ridingDistanceAtGeometricDistance(
      ferry.endDistanceMeters,
      excludedSpans,
    );

    return {
      ...ferry,
      startDistanceMeters,
      endDistanceMeters,
      routeLengthMeters: Math.abs(ferry.endDistanceMeters - ferry.startDistanceMeters),
    };
  });
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
    const intervalLengthMeters = absoluteEnd - absoluteStart;
    const retainedRouteLengthMeters = Number.isFinite(ferry.routeLengthMeters)
      ? Math.max(0, ferry.routeLengthMeters ?? 0)
      : 0;
    const markerLengthMeters =
      intervalLengthMeters > DISTANCE_EPSILON_METERS
        ? visibleEnd - visibleStart
        : retainedRouteLengthMeters;
    const scaledWidthPixels =
      (Math.min(totalDistanceMeters, markerLengthMeters) / totalDistanceMeters) *
      contentWidthPixels;
    const widthPixels = Math.min(contentWidthPixels, scaledWidthPixels);
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
