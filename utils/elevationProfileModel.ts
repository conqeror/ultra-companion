import { categoryColor, getCategoryMeta } from "@/constants/poiHelpers";
import type { DisplayPOI, RoutePoint, UnitSystem } from "@/types";
import { buildClimbTickDistances } from "@/utils/climbProfile";
import {
  getElevationSampleIndexRange,
  getElevationTileDistanceRange,
  getVisibleElevationTileRange,
  interpolateElevationAtDistance,
  type ElevationProfileSample,
  type ElevationSampleIndexRange,
} from "@/utils/elevationProfileSampling";
import { formatDistance, formatElevation } from "@/utils/formatters";

export const ELEVATION_PROFILE_PADDING = {
  top: 16,
  right: 16,
  bottom: 28,
  left: 48,
} as const;

export const DEFAULT_ELEVATION_MIN_PIXELS_PER_KM = 2;
export const DEFAULT_ELEVATION_TILE_WIDTH_PIXELS = 768;

const CLIMB_Y_AXIS_WIDTH = 30;
const LEGEND_HEIGHT = 18;
const OVERVIEW_HEIGHT = 52;
const MAX_VERTICAL_EXAGGERATION = 200;
const Y_LABEL_MIN_STEP_METERS = 5;
const Y_LABEL_MIN_SPACING_PIXELS = 18;
const X_TICK_TARGET_PIXELS = 120;
const POI_MARKER_RADIUS = 6;
const POI_MARKER_OFFSET_Y = -14;
const POI_COLLISION_MIN_PIXELS = 12;
const POI_COLLISION_STEP_PIXELS = 16;

export type ElevationProfileAxisStyle = "standard" | "climb";
export type ElevationProfileYAxisSide = "left" | "right";

export interface ElevationProfileLayoutOptions {
  totalDistanceMeters: number;
  widthPixels: number;
  heightPixels: number;
  axisStyle?: ElevationProfileAxisStyle;
  yAxisSide?: ElevationProfileYAxisSide;
  fitToWidth?: boolean;
  minPixelsPerKm?: number;
  showScrollOverview?: boolean;
  showLegend?: boolean;
}

export interface ElevationProfileLayout {
  widthPixels: number;
  heightPixels: number;
  totalDistanceMeters: number;
  axisStyle: ElevationProfileAxisStyle;
  yAxisSide: ElevationProfileYAxisSide;
  yAxisWidthPixels: number;
  fitContentWidthPixels: number;
  desiredContentWidthPixels: number;
  contentWidthPixels: number;
  viewportWidthPixels: number;
  pixelsPerMeter: number;
  isScrollable: boolean;
  overviewShown: boolean;
  overviewHeightPixels: number;
  legendHeightPixels: number;
  mainChartHeightPixels: number;
  plotHeightPixels: number;
  plotTopPixels: number;
  axisYPixels: number;
}

export interface ElevationYDomainOptions {
  samples: readonly ElevationProfileSample[];
  contentWidthPixels: number;
  plotHeightPixels: number;
  axisStyle?: ElevationProfileAxisStyle;
}

export interface ElevationYDomain {
  yMinMeters: number;
  yMaxMeters: number;
  dataMinMeters: number;
  dataMaxMeters: number;
}

export interface ElevationYTick {
  valueMeters: number;
  yPixels: number;
  label: string;
}

export interface ElevationYTickOptions {
  domain: ElevationYDomain;
  plotHeightPixels: number;
  units: UnitSystem;
  axisStyle?: ElevationProfileAxisStyle;
  plotTopPixels?: number;
  minimumSpacingPixels?: number;
}

export interface ElevationXTick {
  valueMeters: number;
  xPixels: number;
  label: string;
}

export interface ElevationXTickOptions {
  totalDistanceMeters: number;
  contentWidthPixels: number;
  units: UnitSystem;
  axisStyle?: ElevationProfileAxisStyle;
  isScrollable?: boolean;
  xTickIntervalMeters?: number;
  xAxisLabelOffsetMeters?: number;
}

export interface ElevationCurrentPositionOptions {
  samples: readonly ElevationProfileSample[];
  points: readonly RoutePoint[];
  totalDistanceMeters: number;
  contentWidthPixels: number;
  plotHeightPixels: number;
  domain: ElevationYDomain;
  currentDistanceMeters?: number;
  currentPointIndex?: number;
  plotTopPixels?: number;
}

export interface ElevationCurrentPosition {
  distanceMeters: number;
  elevationMeters: number;
  xPixels: number;
  yPixels: number;
}

export interface ElevationPOIMarkerOptions {
  pois: readonly DisplayPOI[];
  samples: readonly ElevationProfileSample[];
  totalDistanceMeters: number;
  contentWidthPixels: number;
  plotHeightPixels: number;
  domain: ElevationYDomain;
  distanceOffsetMeters?: number;
  plotTopPixels?: number;
  markerOffsetYPixels?: number;
  markerRadiusPixels?: number;
  collisionMinimumPixels?: number;
  collisionStepPixels?: number;
}

export interface ElevationPOIMarker {
  poi: DisplayPOI;
  distanceMeters: number;
  elevationMeters: number;
  xPixels: number;
  yPixels: number;
  color: string;
  iconName: string;
}

export interface ElevationTileDescriptorOptions {
  contentWidthPixels: number;
  viewportWidthPixels: number;
  scrollOffsetPixels: number;
  contentStartDistanceMeters: number;
  contentEndDistanceMeters: number;
  tileWidthPixels?: number;
  overscanTiles?: number;
  samples?: readonly ElevationProfileSample[];
}

export interface ElevationTileDescriptor {
  index: number;
  xPixels: number;
  widthPixels: number;
  startDistanceMeters: number;
  endDistanceMeters: number;
  sampleIndexRange?: ElevationSampleIndexRange;
}

export interface CenteredScrollOffsetOptions {
  contentX: number;
  contentWidthPixels: number;
  viewportWidthPixels: number;
}

export interface InitialElevationScrollOffsetOptions {
  currentDistanceMeters: number;
  totalDistanceMeters: number;
  contentWidthPixels: number;
  viewportWidthPixels: number;
}

export interface OverviewSeekOptions {
  touchXPixels: number;
  overviewWidthPixels: number;
  contentWidthPixels: number;
  viewportWidthPixels: number;
  overviewPaddingLeftPixels?: number;
  overviewPaddingRightPixels?: number;
}

export interface OverviewViewportOptions {
  scrollOffsetPixels: number;
  overviewWidthPixels: number;
  contentWidthPixels: number;
  viewportWidthPixels: number;
  overviewPaddingLeftPixels?: number;
  overviewPaddingRightPixels?: number;
  minimumIndicatorWidthPixels?: number;
}

export interface OverviewViewport {
  xPixels: number;
  widthPixels: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

/** Computes the shared chart, viewport, and logical-content geometry. */
export function computeElevationProfileLayout(
  options: ElevationProfileLayoutOptions,
): ElevationProfileLayout {
  const widthPixels = finiteNonNegative(options.widthPixels);
  const heightPixels = finiteNonNegative(options.heightPixels);
  const totalDistanceMeters = finiteNonNegative(options.totalDistanceMeters);
  const axisStyle = options.axisStyle ?? "standard";
  const yAxisSide = options.yAxisSide ?? (axisStyle === "climb" ? "right" : "left");
  const climbRightYAxis = axisStyle === "climb" && yAxisSide === "right";
  const yAxisWidthPixels = climbRightYAxis ? CLIMB_Y_AXIS_WIDTH : ELEVATION_PROFILE_PADDING.left;
  const fitContentWidthPixels = Math.max(
    0,
    climbRightYAxis
      ? widthPixels - yAxisWidthPixels
      : widthPixels - ELEVATION_PROFILE_PADDING.left - ELEVATION_PROFILE_PADDING.right,
  );
  const minPixelsPerKm =
    options.minPixelsPerKm == null
      ? DEFAULT_ELEVATION_MIN_PIXELS_PER_KM
      : finiteNonNegative(options.minPixelsPerKm);
  const desiredContentWidthPixels = (totalDistanceMeters / 1000) * minPixelsPerKm;
  const isScrollable =
    !options.fitToWidth &&
    totalDistanceMeters > 0 &&
    desiredContentWidthPixels > fitContentWidthPixels + 0.5;
  const contentWidthPixels = isScrollable
    ? Math.ceil(desiredContentWidthPixels)
    : fitContentWidthPixels;
  const viewportWidthPixels = Math.max(
    0,
    climbRightYAxis
      ? widthPixels - yAxisWidthPixels
      : yAxisSide === "right"
        ? widthPixels - ELEVATION_PROFILE_PADDING.left - ELEVATION_PROFILE_PADDING.right
        : widthPixels - ELEVATION_PROFILE_PADDING.left,
  );
  const overviewShown = isScrollable && (options.showScrollOverview ?? true);
  const overviewHeightPixels = overviewShown ? OVERVIEW_HEIGHT : 0;
  const legendHeightPixels = (options.showLegend ?? true) ? LEGEND_HEIGHT : 0;
  const mainChartHeightPixels = Math.max(
    0,
    heightPixels - overviewHeightPixels - legendHeightPixels,
  );
  const plotHeightPixels = Math.max(
    0,
    mainChartHeightPixels - ELEVATION_PROFILE_PADDING.top - ELEVATION_PROFILE_PADDING.bottom,
  );

  return {
    widthPixels,
    heightPixels,
    totalDistanceMeters,
    axisStyle,
    yAxisSide,
    yAxisWidthPixels,
    fitContentWidthPixels,
    desiredContentWidthPixels,
    contentWidthPixels,
    viewportWidthPixels,
    pixelsPerMeter: totalDistanceMeters > 0 ? contentWidthPixels / totalDistanceMeters : 0,
    isScrollable,
    overviewShown,
    overviewHeightPixels,
    legendHeightPixels,
    mainChartHeightPixels,
    plotHeightPixels,
    plotTopPixels: ELEVATION_PROFILE_PADDING.top,
    axisYPixels: ELEVATION_PROFILE_PADDING.top + plotHeightPixels,
  };
}

/** Computes a padded elevation domain while retaining the SVG chart's aspect cap. */
export function computeElevationYDomain(options: ElevationYDomainOptions): ElevationYDomain {
  if (options.samples.length < 2) return defaultYDomain();

  let dataMinMeters = Number.POSITIVE_INFINITY;
  let dataMaxMeters = Number.NEGATIVE_INFINITY;
  for (const sample of options.samples) {
    if (!Number.isFinite(sample.elevationMeters)) continue;
    dataMinMeters = Math.min(dataMinMeters, sample.elevationMeters);
    dataMaxMeters = Math.max(dataMaxMeters, sample.elevationMeters);
  }
  if (!Number.isFinite(dataMinMeters) || !Number.isFinite(dataMaxMeters)) return defaultYDomain();

  const rawRangeMeters = dataMaxMeters - dataMinMeters || 100;
  const lastDistanceMeters = finiteNonNegative(
    options.samples[options.samples.length - 1].distanceMeters,
  );
  const minimumRangeMeters = Math.min(200, Math.max(50, lastDistanceMeters * 0.05));
  const horizontalMetersPerPixel =
    options.contentWidthPixels > 0 ? lastDistanceMeters / options.contentWidthPixels : 0;
  const minimumRangeForAspect =
    (finiteNonNegative(options.plotHeightPixels) * horizontalMetersPerPixel) /
    MAX_VERTICAL_EXAGGERATION;
  const elevationRangeMeters = Math.max(rawRangeMeters, minimumRangeMeters, minimumRangeForAspect);
  const paddedRangeMeters = elevationRangeMeters * 1.2;
  const axisStyle = options.axisStyle ?? "standard";
  let yMinMeters: number;
  let yMaxMeters: number;

  if (axisStyle === "climb") {
    const bottomPaddingMeters = Math.min(
      paddedRangeMeters * 0.08,
      Math.max(5, rawRangeMeters * 0.08),
    );
    yMinMeters = dataMinMeters - bottomPaddingMeters;
    yMaxMeters = yMinMeters + paddedRangeMeters;
  } else {
    const midpointMeters = (dataMinMeters + dataMaxMeters) / 2;
    yMinMeters = midpointMeters - paddedRangeMeters / 2;
    yMaxMeters = midpointMeters + paddedRangeMeters / 2;
  }

  if (yMinMeters < 0 && dataMinMeters >= 0) {
    yMinMeters = 0;
    yMaxMeters = paddedRangeMeters;
  }

  return {
    yMinMeters,
    yMaxMeters,
    dataMinMeters: axisStyle === "climb" ? yMinMeters : dataMinMeters,
    dataMaxMeters: axisStyle === "climb" ? yMaxMeters : dataMaxMeters,
  };
}

/** Maps a local route distance into logical chart content coordinates. */
export function scaleElevationDistanceToX(
  distanceMeters: number,
  totalDistanceMeters: number,
  contentWidthPixels: number,
): number {
  return totalDistanceMeters > 0 ? (distanceMeters / totalDistanceMeters) * contentWidthPixels : 0;
}

/** Maps an elevation into plot coordinates. Values are deliberately not clipped. */
export function scaleElevationToY(
  elevationMeters: number,
  domain: ElevationYDomain,
  plotHeightPixels: number,
  plotTopPixels: number = ELEVATION_PROFILE_PADDING.top,
): number {
  return (
    plotTopPixels +
    plotHeightPixels -
    ((elevationMeters - domain.yMinMeters) /
      Math.max(1e-6, domain.yMaxMeters - domain.yMinMeters)) *
      plotHeightPixels
  );
}

/** Builds formatted Y-axis ticks and removes labels that would visually collide. */
export function buildElevationYTicks(options: ElevationYTickOptions): ElevationYTick[] {
  const plotTopPixels = options.plotTopPixels ?? ELEVATION_PROFILE_PADDING.top;
  const minimumSpacingPixels = options.minimumSpacingPixels ?? Y_LABEL_MIN_SPACING_PIXELS;
  const values = buildYTickValues(options.domain);
  const ticks = values.map((valueMeters) => ({
    valueMeters,
    yPixels: scaleElevationToY(
      valueMeters,
      options.domain,
      options.plotHeightPixels,
      plotTopPixels,
    ),
    label:
      (options.axisStyle ?? "standard") === "climb"
        ? formatClimbYAxisLabel(valueMeters, options.units)
        : formatElevation(valueMeters, options.units),
  }));
  if (ticks.length <= 1) return ticks;

  const sorted = [...ticks].sort((a, b) => b.yPixels - a.yPixels);
  const kept: ElevationYTick[] = [sorted[0]];
  for (let index = 1; index < sorted.length; index++) {
    if (kept[kept.length - 1].yPixels - sorted[index].yPixels >= minimumSpacingPixels) {
      kept.push(sorted[index]);
    }
  }
  return kept;
}

/** Builds renderer-neutral X-axis coordinates and labels for route and climb profiles. */
export function buildElevationXTicks(options: ElevationXTickOptions): ElevationXTick[] {
  const totalDistanceMeters = finiteNonNegative(options.totalDistanceMeters);
  if (totalDistanceMeters <= 0) return [];

  const axisStyle = options.axisStyle ?? "standard";
  let distances: number[];
  if (axisStyle === "climb") {
    distances = buildClimbTickDistances(totalDistanceMeters, options.xTickIntervalMeters);
  } else if (options.xTickIntervalMeters != null && options.xTickIntervalMeters > 0) {
    distances = buildFixedXTicks(totalDistanceMeters, options.xTickIntervalMeters);
  } else if (!options.isScrollable) {
    distances = [0, totalDistanceMeters / 2, totalDistanceMeters];
  } else {
    const targetCount = Math.max(
      3,
      Math.round(finiteNonNegative(options.contentWidthPixels) / X_TICK_TARGET_PIXELS),
    );
    distances = buildRoundXTicks(totalDistanceMeters, targetCount);
  }

  const labelOffsetMeters = options.xAxisLabelOffsetMeters ?? 0;
  return distances.map((valueMeters) => ({
    valueMeters,
    xPixels: scaleElevationDistanceToX(
      valueMeters,
      totalDistanceMeters,
      options.contentWidthPixels,
    ),
    label:
      axisStyle === "climb"
        ? formatClimbXAxisLabel(valueMeters)
        : formatDistance(valueMeters + labelOffsetMeters, options.units),
  }));
}

/** Resolves current-distance precedence and interpolates its elevation when applicable. */
export function resolveElevationCurrentPosition(
  options: ElevationCurrentPositionOptions,
): ElevationCurrentPosition | null {
  let distanceMeters: number;
  let elevationMeters: number;

  if (options.currentDistanceMeters != null) {
    if (
      !Number.isFinite(options.currentDistanceMeters) ||
      options.currentDistanceMeters < 0 ||
      options.currentDistanceMeters > options.totalDistanceMeters
    ) {
      return null;
    }
    distanceMeters = options.currentDistanceMeters;
    elevationMeters = interpolateElevationAtDistance(options.samples, distanceMeters);
  } else {
    const pointIndex = options.currentPointIndex;
    if (pointIndex == null || pointIndex < 0 || pointIndex >= options.points.length) return null;
    const point = options.points[pointIndex];
    distanceMeters = point.distanceFromStartMeters;
    elevationMeters = point.elevationMeters ?? 0;
  }

  return {
    distanceMeters,
    elevationMeters,
    xPixels: scaleElevationDistanceToX(
      distanceMeters,
      options.totalDistanceMeters,
      options.contentWidthPixels,
    ),
    yPixels: scaleElevationToY(
      elevationMeters,
      options.domain,
      options.plotHeightPixels,
      options.plotTopPixels,
    ),
  };
}

/** Positions route-local POIs and applies the existing deterministic collision stack. */
export function buildElevationPOIMarkers(options: ElevationPOIMarkerOptions): ElevationPOIMarker[] {
  if (
    options.pois.length === 0 ||
    options.samples.length === 0 ||
    options.totalDistanceMeters <= 0
  ) {
    return [];
  }

  const distanceOffsetMeters = options.distanceOffsetMeters ?? 0;
  const markerOffsetYPixels = options.markerOffsetYPixels ?? POI_MARKER_OFFSET_Y;
  const markerRadiusPixels = options.markerRadiusPixels ?? POI_MARKER_RADIUS;
  const collisionMinimumPixels = options.collisionMinimumPixels ?? POI_COLLISION_MIN_PIXELS;
  const collisionStepPixels = options.collisionStepPixels ?? POI_COLLISION_STEP_PIXELS;
  const plotTopPixels = options.plotTopPixels ?? ELEVATION_PROFILE_PADDING.top;
  const markers: ElevationPOIMarker[] = [];

  for (const poi of options.pois) {
    const distanceMeters = poi.effectiveDistanceMeters - distanceOffsetMeters;
    if (distanceMeters < 0 || distanceMeters > options.totalDistanceMeters) continue;

    const elevationMeters = interpolateElevationAtDistance(options.samples, distanceMeters);
    markers.push({
      poi,
      distanceMeters,
      elevationMeters,
      xPixels: scaleElevationDistanceToX(
        distanceMeters,
        options.totalDistanceMeters,
        options.contentWidthPixels,
      ),
      yPixels:
        scaleElevationToY(
          elevationMeters,
          options.domain,
          options.plotHeightPixels,
          plotTopPixels,
        ) + markerOffsetYPixels,
      color: categoryColor(poi.category),
      iconName: getCategoryMeta(poi.category)?.iconName ?? "MapPin",
    });
  }

  markers.sort((a, b) => a.xPixels - b.xPixels);
  for (let index = 1; index < markers.length; index++) {
    if (markers[index].xPixels - markers[index - 1].xPixels < collisionMinimumPixels) {
      markers[index].yPixels = markers[index - 1].yPixels - collisionStepPixels;
    }
  }

  const minimumY = plotTopPixels + markerRadiusPixels + 2;
  for (const marker of markers) marker.yPixels = Math.max(minimumY, marker.yPixels);
  return markers;
}

/** Builds only the render tiles intersecting the viewport plus bounded overscan. */
export function buildElevationTileDescriptors(
  options: ElevationTileDescriptorOptions,
): ElevationTileDescriptor[] {
  const tileWidthPixels = options.tileWidthPixels ?? DEFAULT_ELEVATION_TILE_WIDTH_PIXELS;
  const distanceSpanMeters = options.contentEndDistanceMeters - options.contentStartDistanceMeters;
  if (distanceSpanMeters <= 0 || options.contentWidthPixels <= 0) return [];

  const visibleRange = getVisibleElevationTileRange({
    scrollOffsetPixels: options.scrollOffsetPixels,
    viewportWidthPixels: options.viewportWidthPixels,
    tileWidthPixels,
    contentWidthPixels: options.contentWidthPixels,
    overscanTiles: options.overscanTiles,
  });
  if (!visibleRange) return [];

  const pixelsPerMeter = options.contentWidthPixels / distanceSpanMeters;
  const descriptors: ElevationTileDescriptor[] = [];
  for (let index = visibleRange.firstTileIndex; index <= visibleRange.lastTileIndex; index++) {
    const distanceRange = getElevationTileDistanceRange({
      tileIndex: index,
      tileWidthPixels,
      pixelsPerMeter,
      contentStartDistanceMeters: options.contentStartDistanceMeters,
      contentEndDistanceMeters: options.contentEndDistanceMeters,
    });
    if (!distanceRange) continue;

    const xPixels = index * tileWidthPixels;
    const descriptor: ElevationTileDescriptor = {
      index,
      xPixels,
      widthPixels: Math.min(tileWidthPixels, options.contentWidthPixels - xPixels),
      ...distanceRange,
    };
    if (options.samples) {
      descriptor.sampleIndexRange = getElevationSampleIndexRange(
        options.samples,
        distanceRange.startDistanceMeters,
        distanceRange.endDistanceMeters,
      );
    }
    descriptors.push(descriptor);
  }
  return descriptors;
}

/** Centers a logical content coordinate and clamps it to the scrollable range. */
export function getCenteredElevationScrollOffset(options: CenteredScrollOffsetOptions): number {
  const contentWidthPixels = finiteNonNegative(options.contentWidthPixels);
  const viewportWidthPixels = finiteNonNegative(options.viewportWidthPixels);
  const maximumOffset = Math.max(0, contentWidthPixels - viewportWidthPixels);
  const contentX = Number.isFinite(options.contentX) ? options.contentX : 0;
  return clamp(contentX - viewportWidthPixels / 2, 0, maximumOffset);
}

/** Maps current route distance to the one-time initial centered scroll offset. */
export function getInitialElevationScrollOffset(
  options: InitialElevationScrollOffsetOptions,
): number {
  const contentX = scaleElevationDistanceToX(
    options.currentDistanceMeters,
    options.totalDistanceMeters,
    options.contentWidthPixels,
  );
  return getCenteredElevationScrollOffset({ ...options, contentX });
}

/** Maps an overview scrubber touch into the matching centered detail scroll offset. */
export function getElevationOverviewSeekOffset(options: OverviewSeekOptions): number {
  const paddingLeft = options.overviewPaddingLeftPixels ?? ELEVATION_PROFILE_PADDING.left;
  const paddingRight = options.overviewPaddingRightPixels ?? ELEVATION_PROFILE_PADDING.right;
  const overviewInnerWidth = Math.max(0, options.overviewWidthPixels - paddingLeft - paddingRight);
  const overviewX = clamp(options.touchXPixels - paddingLeft, 0, overviewInnerWidth);
  const fraction = overviewInnerWidth > 0 ? overviewX / overviewInnerWidth : 0;
  return getCenteredElevationScrollOffset({
    contentX: fraction * options.contentWidthPixels,
    contentWidthPixels: options.contentWidthPixels,
    viewportWidthPixels: options.viewportWidthPixels,
  });
}

/** Maps the detail viewport back onto the overview selection indicator. */
export function getElevationOverviewViewport(options: OverviewViewportOptions): OverviewViewport {
  const paddingLeft = options.overviewPaddingLeftPixels ?? ELEVATION_PROFILE_PADDING.left;
  const paddingRight = options.overviewPaddingRightPixels ?? ELEVATION_PROFILE_PADDING.right;
  const overviewInnerWidth = Math.max(0, options.overviewWidthPixels - paddingLeft - paddingRight);
  const contentWidthPixels = finiteNonNegative(options.contentWidthPixels);
  const viewportWidthPixels = finiteNonNegative(options.viewportWidthPixels);
  const maximumOffset = Math.max(0, contentWidthPixels - viewportWidthPixels);
  const scrollOffsetPixels = clamp(
    Number.isFinite(options.scrollOffsetPixels) ? options.scrollOffsetPixels : 0,
    0,
    maximumOffset,
  );
  const startFraction = contentWidthPixels > 0 ? scrollOffsetPixels / contentWidthPixels : 0;
  const endFraction =
    contentWidthPixels > 0
      ? Math.min(1, (scrollOffsetPixels + viewportWidthPixels) / contentWidthPixels)
      : 1;

  return {
    xPixels: paddingLeft + startFraction * overviewInnerWidth,
    widthPixels: Math.max(
      options.minimumIndicatorWidthPixels ?? 4,
      (endFraction - startFraction) * overviewInnerWidth,
    ),
  };
}

function defaultYDomain(): ElevationYDomain {
  return {
    yMinMeters: 0,
    yMaxMeters: 100,
    dataMinMeters: 0,
    dataMaxMeters: 100,
  };
}

/** Round-number spacing (1/2/5 x 10^n) matching the existing chart axes. */
function niceStep(range: number, targetCount: number): number {
  const raw = range / targetCount;
  const power = Math.pow(10, Math.floor(Math.log10(raw)));
  const normalized = raw / power;
  const multiplier = normalized >= 5 ? 5 : normalized >= 2 ? 2 : 1;
  return multiplier * power;
}

function buildYTickValues(domain: ElevationYDomain): number[] {
  const low = Math.max(0, domain.yMinMeters, Math.floor(domain.dataMinMeters));
  const high = Math.min(domain.yMaxMeters, domain.dataMaxMeters);
  const range = high - low;
  if (range <= 0) return [Math.round(low)];

  const step = Math.max(Y_LABEL_MIN_STEP_METERS, niceStep(range, 3));
  const first = Math.ceil(low / step) * step;
  const lastCandidate = Math.ceil(high / step) * step;
  const last =
    lastCandidate <= domain.yMaxMeters + 1e-6 ? lastCandidate : Math.floor(high / step) * step;
  const values: number[] = [];
  for (let value = first; value <= last + 1e-6; value += step) {
    values.push(Math.round(value));
  }

  if (domain.yMinMeters <= 0 && (values.length === 0 || values[0] !== 0)) values.unshift(0);
  return values;
}

function buildRoundXTicks(totalDistanceMeters: number, targetCount: number): number[] {
  if (totalDistanceMeters <= 0 || targetCount < 1) return [0];
  const step = niceStep(totalDistanceMeters, targetCount);
  const values: number[] = [];
  for (let value = 0; value <= totalDistanceMeters + 1e-6; value += step) values.push(value);
  if (values[values.length - 1] < totalDistanceMeters - step * 0.3) {
    values.push(totalDistanceMeters);
  }
  return values;
}

function buildFixedXTicks(totalDistanceMeters: number, intervalMeters: number): number[] {
  if (totalDistanceMeters <= 0 || intervalMeters <= 0) return [];
  const values = [0];
  for (let value = intervalMeters; value < totalDistanceMeters - 1; value += intervalMeters) {
    values.push(value);
  }
  const last = values[values.length - 1];
  if (totalDistanceMeters - last >= intervalMeters * 0.7) values.push(totalDistanceMeters);
  return values;
}

function formatClimbXAxisLabel(distanceMeters: number): string {
  const kilometers = distanceMeters / 1000;
  return Number.isInteger(kilometers) ? `${kilometers}` : kilometers.toFixed(1);
}

function formatClimbYAxisLabel(elevationMeters: number, units: UnitSystem): string {
  if (units === "imperial") return formatElevation(elevationMeters, units).replace(/\s/g, "");
  return `${Math.round(elevationMeters)}m`;
}
