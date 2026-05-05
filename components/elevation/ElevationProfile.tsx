import React, { useMemo, useRef, useEffect, useCallback } from "react";
import { View, PanResponder, type ScrollView } from "react-native";
import Animated, {
  createAnimatedComponent,
  useAnimatedProps,
  useAnimatedScrollHandler,
  useSharedValue,
} from "react-native-reanimated";
import Svg, { Path, Circle, Defs, LinearGradient, Stop, Line, G, Rect } from "react-native-svg";
import { Text } from "@/components/ui/text";
import { useThemeColors, gradientColor } from "@/theme";
import { ELEVATION_STOPS } from "@/theme/elevation";
import { formatDistance, formatElevation } from "@/utils/formatters";
import { categoryColor, getCategoryMeta } from "@/constants/poiHelpers";
import { climbDifficultyColor } from "@/constants/climbHelpers";
import { POI_ICON_MAP } from "@/constants/poiIcons";
import type { RoutePoint, UnitSystem, DisplayPOI, DisplayClimb } from "@/types";

interface SegmentBoundary {
  distanceMeters: number;
  label?: string;
}

interface ElevationProfileProps {
  points: RoutePoint[];
  units: UnitSystem;
  width: number;
  height: number;
  currentPointIndex?: number;
  currentDistanceMeters?: number;
  showLegend?: boolean;
  /** Offset added to X-axis labels so they show absolute route distance */
  distanceOffsetMeters?: number;
  pois?: DisplayPOI[];
  onPOIPress?: (poi: DisplayPOI) => void;
  /** Vertical boundary lines at segment junctions (for stitched collections) */
  segmentBoundaries?: SegmentBoundary[];
  climbs?: DisplayClimb[];
  /** Force fit-to-width — disables horizontal scrolling and the overview minimap */
  fitToWidth?: boolean;
}

const PADDING = { top: 16, right: 16, bottom: 28, left: 48 };
const BASE_INTERVAL_M = 100;
const MAX_DETAIL_SAMPLES = 8000;
// Scrolling kicks in when fit-to-width would produce less than this many px/km.
const MIN_PX_PER_KM = 2;
const MAX_GRADIENT_STOPS = 120;
const MAX_EXAGGERATION = 200;
const OVERVIEW_HEIGHT = 52;
const OVERVIEW_BAR_HEIGHT = 32;
const OVERVIEW_PADDING_V = 4;
const OVERVIEW_MAX_SAMPLES = 220;
const OVERVIEW_MARKER_RADIUS = 3;
const CURRENT_MARKER_RADIUS = 5;
const POI_MARKER_RADIUS = 6;
const POI_ICON_SIZE = 10;
const POI_ICON_STROKE_WIDTH = 2.5;
const POI_MARKER_OFFSET_Y = -14;
const POI_COLLISION_MIN_PX = 12;
const POI_COLLISION_STEP_PX = 16;
const POI_HIT_SIZE = 48;
const Y_LABEL_OFFSET_Y = 7;
const Y_LABEL_MIN_STEP_M = 5;
const Y_LABEL_MIN_SPACING_PX = 18;
const X_LABEL_WIDTH = 48;
const X_LABEL_HALF_WIDTH = X_LABEL_WIDTH / 2;
// Target ~one X-axis tick per this many pixels of scrollable content.
const X_TICK_TARGET_PX = 120;

const AnimatedRect = createAnimatedComponent(Rect);

type Sample = { distance: number; elevation: number };

function resampleAtInterval(points: RoutePoint[], intervalM: number): Sample[] {
  if (points.length === 0) return [];

  const result: Sample[] = [];
  const totalDist = points[points.length - 1].distanceFromStartMeters;

  let ptIdx = 0;
  for (let d = 0; d <= totalDist; d += intervalM) {
    while (ptIdx < points.length - 1 && points[ptIdx + 1].distanceFromStartMeters < d) {
      ptIdx++;
    }

    if (ptIdx >= points.length - 1) {
      const last = points[points.length - 1];
      result.push({ distance: d, elevation: last.elevationMeters ?? 0 });
      continue;
    }

    const p1 = points[ptIdx];
    const p2 = points[ptIdx + 1];
    const segDist = p2.distanceFromStartMeters - p1.distanceFromStartMeters;
    const t = segDist > 0 ? (d - p1.distanceFromStartMeters) / segDist : 0;
    const e1 = p1.elevationMeters ?? 0;
    const e2 = p2.elevationMeters ?? 0;
    result.push({ distance: d, elevation: e1 + t * (e2 - e1) });
  }

  const lastSample = result[result.length - 1];
  if (lastSample && lastSample.distance < totalDist - 1) {
    const last = points[points.length - 1];
    result.push({ distance: totalDist, elevation: last.elevationMeters ?? 0 });
  }

  return result;
}

function interpolateElevation(samples: Sample[], distance: number): number {
  if (samples.length === 0) return 0;
  const first = samples[0].distance;
  const last = samples[samples.length - 1].distance;
  if (distance <= first) return samples[0].elevation;
  if (distance >= last) return samples[samples.length - 1].elevation;

  const i = Math.min(
    Math.floor(((distance - first) / (last - first)) * (samples.length - 1)),
    samples.length - 2,
  );
  const segDist = samples[i + 1].distance - samples[i].distance;
  const t = segDist > 0 ? (distance - samples[i].distance) / segDist : 0;
  return samples[i].elevation + t * (samples[i + 1].elevation - samples[i].elevation);
}

/** First index in `samples` with distance >= target. Binary search (O(log n)). */
function findFirstSampleAtOrAfter(samples: Sample[], target: number): number {
  let lo = 0;
  let hi = samples.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (samples[mid].distance < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Round-number spacing (1/2/5 × 10ⁿ) that yields ~targetCount steps over `range`. */
function niceStep(range: number, targetCount: number): number {
  const raw = range / targetCount;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / pow;
  const mult = norm >= 5 ? 5 : norm >= 2 ? 2 : 1;
  return mult * pow;
}

/** Elevation ticks covering the actual data range (not padded viewport). */
function buildYLabels(yMin: number, yMax: number, dataMin: number, dataMax: number): number[] {
  const lo = Math.max(0, yMin, Math.floor(dataMin));
  const hi = Math.min(yMax, dataMax);
  const range = hi - lo;
  if (range <= 0) return [Math.round(lo)];

  // Floor step to avoid dense tick stacks on flat profiles (e.g. 138/140/142/144).
  const step = Math.max(Y_LABEL_MIN_STEP_M, niceStep(range, 3));
  const first = Math.ceil(lo / step) * step;
  const lastCandidate = Math.ceil(hi / step) * step;
  const last = lastCandidate <= yMax + 1e-6 ? lastCandidate : Math.floor(hi / step) * step;
  const ticks: number[] = [];
  for (let v = first; v <= last + 1e-6; v += step) ticks.push(Math.round(v));

  if (yMin <= 0 && (ticks.length === 0 || ticks[0] !== 0)) ticks.unshift(0);
  return ticks;
}

function buildXTicks(totalD: number, targetCount: number): number[] {
  if (totalD <= 0 || targetCount < 1) return [0];
  const step = niceStep(totalD, targetCount);
  const ticks: number[] = [];
  for (let v = 0; v <= totalD + 1e-6; v += step) ticks.push(v);
  if (ticks[ticks.length - 1] < totalD - step * 0.3) ticks.push(totalD);
  return ticks;
}

function buildLinePath(
  samples: Sample[],
  xs: (d: number) => number,
  ys: (e: number) => number,
): string {
  let d = "";
  for (let i = 0; i < samples.length; i++) {
    const x = xs(samples[i].distance);
    const y = ys(samples[i].elevation);
    d += i === 0 ? `M${x},${y}` : ` L${x},${y}`;
  }
  return d;
}

interface POIMarkerPos {
  poi: DisplayPOI;
  x: number;
  y: number;
  color: string;
  iconName: string;
}

export default function ElevationProfile({
  points,
  units,
  width,
  height,
  currentPointIndex,
  currentDistanceMeters,
  showLegend = true,
  distanceOffsetMeters = 0,
  pois,
  onPOIPress,
  segmentBoundaries,
  climbs,
  fitToWidth = false,
}: ElevationProfileProps) {
  const colors = useThemeColors();

  const totalMeters = points.length > 0 ? points[points.length - 1].distanceFromStartMeters : 0;
  const totalKm = totalMeters / 1000;

  const fitInnerWidth = Math.max(0, width - PADDING.left - PADDING.right);
  const desiredScrollInnerWidth = totalKm * MIN_PX_PER_KM;
  const isScrollable =
    !fitToWidth && totalMeters > 0 && desiredScrollInnerWidth > fitInnerWidth + 0.5;
  const innerWidth = isScrollable ? Math.ceil(desiredScrollInnerWidth) : fitInnerWidth;

  const overviewShown = isScrollable;
  const overviewHeight = overviewShown ? OVERVIEW_HEIGHT : 0;
  const legendHeight = showLegend ? 18 : 0;
  const mainChartHeight = Math.max(0, height - overviewHeight - legendHeight);
  const chartPlotHeight = Math.max(0, mainChartHeight - PADDING.top - PADDING.bottom);
  const viewportWidth = Math.max(0, width - PADDING.left);
  const axisY = PADDING.top + chartPlotHeight;

  const detailInterval = useMemo(() => {
    if (!isScrollable) return BASE_INTERVAL_M;
    if (totalMeters === 0 || innerWidth === 0) return BASE_INTERVAL_M;
    // ~2 samples per content pixel, with a hard cap on total samples.
    const byDensity = totalMeters / Math.max(1, innerWidth * 2);
    const byCap = totalMeters / MAX_DETAIL_SAMPLES;
    return Math.max(BASE_INTERVAL_M, byDensity, byCap);
  }, [isScrollable, totalMeters, innerWidth]);

  const samples = useMemo(
    () => resampleAtInterval(points, detailInterval),
    [points, detailInterval],
  );

  const overviewInterval = useMemo(() => {
    if (!overviewShown || totalMeters === 0) return BASE_INTERVAL_M;
    return Math.max(BASE_INTERVAL_M, totalMeters / OVERVIEW_MAX_SAMPLES);
  }, [overviewShown, totalMeters]);

  const overviewSamples = useMemo(
    () => (overviewShown ? resampleAtInterval(points, overviewInterval) : []),
    [overviewShown, points, overviewInterval],
  );

  const { yMin, yMax, dataMin, dataMax } = useMemo(() => {
    if (samples.length < 2) {
      return { yMin: 0, yMax: 100, dataMin: 0, dataMax: 100 };
    }
    let minE = Infinity;
    let maxE = -Infinity;
    for (const s of samples) {
      if (s.elevation < minE) minE = s.elevation;
      if (s.elevation > maxE) maxE = s.elevation;
    }
    const rawRange = maxE - minE || 100;
    const totalD = samples[samples.length - 1].distance;
    const minRange = Math.min(200, Math.max(50, totalD * 0.05));
    const horizMPerPx = innerWidth > 0 ? totalD / innerWidth : 0;
    // Cap vertical exaggeration so long routes in tall charts don't look like cliffs.
    const minRangeForAspect = (chartPlotHeight * horizMPerPx) / MAX_EXAGGERATION;
    const elevRange = Math.max(rawRange, minRange, minRangeForAspect);
    const mid = (minE + maxE) / 2;
    const paddedRange = elevRange * 1.2;
    let yn = mid - paddedRange / 2;
    let yx = mid + paddedRange / 2;
    // If padding would push below sea level but actual data isn't, anchor 0 to bottom.
    if (yn < 0 && minE >= 0) {
      yx = paddedRange;
      yn = 0;
    }
    return { yMin: yn, yMax: yx, dataMin: minE, dataMax: maxE };
  }, [samples, innerWidth, chartPlotHeight]);

  const xScale = useCallback(
    (d: number) => (totalMeters > 0 ? (d / totalMeters) * innerWidth : 0),
    [totalMeters, innerWidth],
  );
  const yScale = useCallback(
    (e: number) =>
      PADDING.top + chartPlotHeight - ((e - yMin) / Math.max(1e-6, yMax - yMin)) * chartPlotHeight,
    [chartPlotHeight, yMin, yMax],
  );

  const { linePath, fillPath, gradientStops } = useMemo(() => {
    if (samples.length < 2) {
      return {
        linePath: "",
        fillPath: "",
        gradientStops: [] as { offset: string; color: string }[],
      };
    }
    const lineD = buildLinePath(samples, xScale, yScale);
    const fillD = lineD + ` L${xScale(totalMeters)},${axisY} L${xScale(0)},${axisY} Z`;

    // Decimated gradient stops, smoothed by step interval.
    const n = samples.length;
    const step = Math.max(1, Math.floor(n / MAX_GRADIENT_STOPS));
    const stops: { offset: string; color: string }[] = [];
    for (let i = 0; i < n; i += step) {
      const prev = samples[Math.max(0, i - step)];
      const cur = samples[i];
      const dist = cur.distance - prev.distance;
      const grad = dist > 0 ? ((cur.elevation - prev.elevation) / dist) * 100 : 0;
      const fraction = totalMeters > 0 ? cur.distance / totalMeters : 0;
      stops.push({ offset: Math.min(1, fraction).toFixed(4), color: gradientColor(grad) });
    }
    if (stops.length === 0 || stops[stops.length - 1].offset !== "1.0000") {
      const last = samples[n - 1];
      const prev = samples[Math.max(0, n - 1 - step)];
      const dist = last.distance - prev.distance;
      const grad = dist > 0 ? ((last.elevation - prev.elevation) / dist) * 100 : 0;
      stops.push({ offset: "1.0000", color: gradientColor(grad) });
    }
    return { linePath: lineD, fillPath: fillD, gradientStops: stops };
  }, [samples, xScale, yScale, axisY, totalMeters]);

  const poiMarkers = useMemo<POIMarkerPos[]>(() => {
    if (!pois || pois.length === 0 || samples.length === 0 || totalMeters === 0) return [];

    const markers: POIMarkerPos[] = [];
    for (const poi of pois) {
      const localDist = poi.effectiveDistanceMeters - distanceOffsetMeters;
      if (localDist < 0 || localDist > totalMeters) continue;

      const x = xScale(localDist);
      const elev = interpolateElevation(samples, localDist);
      const baseY = yScale(elev) + POI_MARKER_OFFSET_Y;

      markers.push({
        poi,
        x,
        y: baseY,
        color: categoryColor(poi.category),
        iconName: getCategoryMeta(poi.category)?.iconName ?? "MapPin",
      });
    }

    markers.sort((a, b) => a.x - b.x);
    for (let i = 1; i < markers.length; i++) {
      if (markers[i].x - markers[i - 1].x < POI_COLLISION_MIN_PX) {
        markers[i].y = markers[i - 1].y - POI_COLLISION_STEP_PX;
      }
    }
    for (const m of markers) {
      m.y = Math.max(PADDING.top + POI_MARKER_RADIUS + 2, m.y);
    }
    return markers;
  }, [pois, samples, totalMeters, distanceOffsetMeters, xScale, yScale]);

  const climbRegions = useMemo(() => {
    if (!climbs || climbs.length === 0 || samples.length === 0 || totalMeters === 0) return [];

    const regions: { id: string; color: string; fillPath: string }[] = [];
    for (const climb of climbs) {
      const localStart = climb.effectiveStartDistanceMeters - distanceOffsetMeters;
      const localEnd = climb.effectiveEndDistanceMeters - distanceOffsetMeters;
      const visStart = Math.max(0, localStart);
      const visEnd = Math.min(totalMeters, localEnd);
      if (visStart >= visEnd) continue;

      const startX = xScale(visStart);
      const startElev = interpolateElevation(samples, visStart);
      let d = `M${startX},${yScale(startElev)}`;

      const startIdx = findFirstSampleAtOrAfter(samples, visStart);
      const endIdx = findFirstSampleAtOrAfter(samples, visEnd);
      for (let i = startIdx; i < endIdx; i++) {
        const s = samples[i];
        if (s.distance <= visStart) continue;
        d += ` L${xScale(s.distance)},${yScale(s.elevation)}`;
      }

      const endX = xScale(visEnd);
      const endElev = interpolateElevation(samples, visEnd);
      d += ` L${endX},${yScale(endElev)}`;
      d += ` L${endX},${axisY} L${startX},${axisY} Z`;

      regions.push({
        id: climb.id,
        color: climbDifficultyColor(climb.difficultyScore),
        fillPath: d,
      });
    }
    return regions;
  }, [climbs, samples, totalMeters, distanceOffsetMeters, xScale, yScale, axisY]);

  const currentPos = useMemo(() => {
    if (currentDistanceMeters != null) {
      if (
        !Number.isFinite(currentDistanceMeters) ||
        currentDistanceMeters < 0 ||
        currentDistanceMeters > totalMeters
      ) {
        return null;
      }
      const d = currentDistanceMeters;
      return {
        x: xScale(d),
        y: yScale(interpolateElevation(samples, d)),
        distanceMeters: d,
      };
    }
    if (currentPointIndex == null || currentPointIndex < 0 || currentPointIndex >= points.length)
      return null;
    const p = points[currentPointIndex];
    return {
      x: xScale(p.distanceFromStartMeters),
      y: yScale(p.elevationMeters ?? 0),
      distanceMeters: p.distanceFromStartMeters,
    };
  }, [currentDistanceMeters, totalMeters, currentPointIndex, points, samples, xScale, yScale]);

  const scrollRef = useRef<ScrollView | null>(null);
  const scrollX = useSharedValue(0);

  const onScroll = useAnimatedScrollHandler(
    {
      onScroll: (event) => {
        scrollX.value = event.contentOffset.x;
      },
    },
    [],
  );

  const didAutoScroll = useRef(false);
  useEffect(() => {
    if (!isScrollable) return;
    if (didAutoScroll.current) return;
    if (innerWidth <= viewportWidth) return;
    didAutoScroll.current = true;
    if (currentPos) {
      const target = Math.max(
        0,
        Math.min(innerWidth - viewportWidth, currentPos.x - viewportWidth / 2),
      );
      scrollRef.current?.scrollTo({ x: target, animated: false });
      scrollX.value = target;
    }
  }, [isScrollable, currentPos, innerWidth, viewportWidth, scrollX]);

  const overviewWidth = width;
  const overviewInnerWidth = Math.max(0, overviewWidth - PADDING.left - PADDING.right);
  const overviewPlotHeight = OVERVIEW_BAR_HEIGHT - OVERVIEW_PADDING_V * 2;

  const { overviewLinePath, overviewFillPath } = useMemo(() => {
    if (!overviewShown || overviewSamples.length < 2 || overviewInnerWidth === 0) {
      return { overviewLinePath: "", overviewFillPath: "" };
    }
    let minE = Infinity;
    let maxE = -Infinity;
    for (const s of overviewSamples) {
      if (s.elevation < minE) minE = s.elevation;
      if (s.elevation > maxE) maxE = s.elevation;
    }
    const range = maxE - minE || 100;
    const pad = range * 0.1;
    const oyMin = minE - pad;
    const oyMax = maxE + pad;
    const oxs = (d: number) =>
      PADDING.left + (totalMeters > 0 ? (d / totalMeters) * overviewInnerWidth : 0);
    const oys = (e: number) =>
      OVERVIEW_PADDING_V +
      overviewPlotHeight -
      ((e - oyMin) / Math.max(1e-6, oyMax - oyMin)) * overviewPlotHeight;

    const d = buildLinePath(overviewSamples, oxs, oys);
    const ay = OVERVIEW_PADDING_V + overviewPlotHeight;
    const fillD = d + ` L${oxs(totalMeters)},${ay} L${oxs(0)},${ay} Z`;
    return { overviewLinePath: d, overviewFillPath: fillD };
  }, [overviewShown, overviewSamples, overviewInnerWidth, overviewPlotHeight, totalMeters]);

  const seekFromOverviewX = useCallback(
    (touchX: number) => {
      if (!overviewShown) return;
      const px = Math.max(0, Math.min(overviewInnerWidth, touchX - PADDING.left));
      const frac = overviewInnerWidth > 0 ? px / overviewInnerWidth : 0;
      const targetContentX = frac * innerWidth;
      const target = Math.max(
        0,
        Math.min(innerWidth - viewportWidth, targetContentX - viewportWidth / 2),
      );
      scrollRef.current?.scrollTo({ x: target, animated: false });
      scrollX.value = target;
    },
    [overviewShown, overviewInnerWidth, innerWidth, viewportWidth, scrollX],
  );

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e) => seekFromOverviewX(e.nativeEvent.locationX),
        onPanResponderMove: (e) => seekFromOverviewX(e.nativeEvent.locationX),
      }),
    [seekFromOverviewX],
  );

  const viewportIndicatorAnimatedProps = useAnimatedProps(() => {
    const fracStart = innerWidth > 0 ? scrollX.value / innerWidth : 0;
    const fracEnd = innerWidth > 0 ? Math.min(1, (scrollX.value + viewportWidth) / innerWidth) : 1;
    return {
      x: PADDING.left + fracStart * overviewInnerWidth,
      width: Math.max(4, (fracEnd - fracStart) * overviewInnerWidth),
    };
  }, [innerWidth, overviewInnerWidth, scrollX, viewportWidth]);

  const overviewCurrentX = useMemo(() => {
    if (!overviewShown || !currentPos || totalMeters === 0) return null;
    const frac = currentPos.distanceMeters / totalMeters;
    return PADDING.left + frac * overviewInnerWidth;
  }, [overviewShown, currentPos, totalMeters, overviewInnerWidth]);

  const yLabels = useMemo(() => {
    const raw = buildYLabels(yMin, yMax, dataMin, dataMax).map((value) => ({
      value,
      y: yScale(value),
    }));
    // Drop ticks that would render within MIN_SPACING_PX of the previous one
    // to prevent visual overlap on flat profiles or cramped chart heights.
    if (raw.length <= 1) return raw;
    const sorted = [...raw].sort((a, b) => b.y - a.y);
    const kept: typeof raw = [sorted[0]];
    for (let i = 1; i < sorted.length; i++) {
      if (kept[kept.length - 1].y - sorted[i].y >= Y_LABEL_MIN_SPACING_PX) {
        kept.push(sorted[i]);
      }
    }
    return kept;
  }, [yMin, yMax, dataMin, dataMax, yScale]);

  const xLabels = useMemo(() => {
    if (totalMeters <= 0) return [];
    if (!isScrollable) {
      return [0, totalMeters / 2, totalMeters].map((d) => ({ value: d, x: xScale(d) }));
    }
    const target = Math.max(3, Math.round(innerWidth / X_TICK_TARGET_PX));
    return buildXTicks(totalMeters, target).map((d) => ({ value: d, x: xScale(d) }));
  }, [totalMeters, isScrollable, innerWidth, xScale]);

  // Memoized SVG tree — avoids re-rendering thousands of nodes on every scroll
  // frame. None of its deps change while the user pans the detail chart.
  const detailSvg = useMemo(
    () => (
      <Svg width={innerWidth} height={mainChartHeight}>
        <Defs>
          <LinearGradient id="elevFill" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={colors.textTertiary} stopOpacity="0.15" />
            <Stop offset="1" stopColor={colors.textTertiary} stopOpacity="0.03" />
          </LinearGradient>
          <LinearGradient id="lineGrad" x1="0" y1="0" x2="1" y2="0">
            {gradientStops.map((s) => (
              <Stop key={`${s.offset}-${s.color}`} offset={s.offset} stopColor={s.color} />
            ))}
          </LinearGradient>
        </Defs>

        {yLabels.map((l) => (
          <Line
            key={`grid-${l.value}`}
            x1={0}
            y1={l.y}
            x2={innerWidth}
            y2={l.y}
            stroke={colors.border}
            strokeWidth={0.5}
          />
        ))}

        <Path d={fillPath} fill="url(#elevFill)" />

        {climbRegions.map((region) => (
          <Path key={`climb-${region.id}`} d={region.fillPath} fill={region.color} opacity={0.2} />
        ))}

        <Path
          d={linePath}
          stroke="url(#lineGrad)"
          strokeWidth={2.5}
          fill="none"
          strokeLinejoin="round"
        />

        {currentPos && (
          <>
            <Line
              x1={currentPos.x}
              y1={PADDING.top}
              x2={currentPos.x}
              y2={axisY}
              stroke={colors.accent}
              strokeWidth={1}
              strokeDasharray="4,4"
            />
            <Circle
              cx={currentPos.x}
              cy={currentPos.y}
              r={CURRENT_MARKER_RADIUS}
              fill={colors.accent}
            />
          </>
        )}

        {segmentBoundaries?.map((b) => {
          const localDist = b.distanceMeters - distanceOffsetMeters;
          if (localDist <= 0 || localDist >= totalMeters) return null;
          const bx = xScale(localDist);
          return (
            <Line
              key={`seg-boundary-${b.distanceMeters}`}
              x1={bx}
              y1={PADDING.top}
              x2={bx}
              y2={axisY}
              stroke={colors.border}
              strokeWidth={1}
              strokeDasharray="3,3"
              opacity={0.6}
            />
          );
        })}

        {poiMarkers.map((m) => {
          const Icon = POI_ICON_MAP[m.iconName] ?? POI_ICON_MAP.MapPin;
          return (
            <G key={m.poi.id} onPress={onPOIPress ? () => onPOIPress(m.poi) : undefined}>
              <Circle cx={m.x} cy={m.y} r={POI_MARKER_RADIUS} fill={m.color} />
              <G transform={`translate(${m.x - POI_ICON_SIZE / 2}, ${m.y - POI_ICON_SIZE / 2})`}>
                <Icon color="white" size={POI_ICON_SIZE} strokeWidth={POI_ICON_STROKE_WIDTH} />
              </G>
              {onPOIPress && (
                <Rect
                  x={m.x - POI_HIT_SIZE / 2}
                  y={m.y - POI_HIT_SIZE / 2}
                  width={POI_HIT_SIZE}
                  height={POI_HIT_SIZE}
                  fill="transparent"
                />
              )}
            </G>
          );
        })}
      </Svg>
    ),
    [
      innerWidth,
      mainChartHeight,
      colors,
      gradientStops,
      yLabels,
      fillPath,
      climbRegions,
      linePath,
      currentPos,
      axisY,
      segmentBoundaries,
      distanceOffsetMeters,
      totalMeters,
      xScale,
      poiMarkers,
      onPOIPress,
    ],
  );

  if (points.length === 0) {
    return (
      <View className="bg-surface" style={{ width, height }}>
        <Text className="text-center text-muted-foreground mt-10">No elevation data</Text>
      </View>
    );
  }

  const detailBody = (
    <View style={{ width: innerWidth, height: mainChartHeight }}>
      {detailSvg}
      {xLabels.map((l) => (
        <Text
          key={`xl-${l.value}`}
          className="font-barlow-sc-medium text-[10px] text-muted-foreground text-center"
          style={{
            position: "absolute",
            left: l.x - X_LABEL_HALF_WIDTH,
            bottom: 4,
            width: X_LABEL_WIDTH,
          }}
        >
          {formatDistance(l.value + distanceOffsetMeters, units)}
        </Text>
      ))}
    </View>
  );

  return (
    <View className="bg-surface" style={{ width, height }}>
      {overviewShown && (
        <View
          style={{ height: OVERVIEW_HEIGHT, width: overviewWidth }}
          {...panResponder.panHandlers}
        >
          <Svg width={overviewWidth} height={OVERVIEW_BAR_HEIGHT}>
            <Defs>
              <LinearGradient id="ovFill" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={colors.textTertiary} stopOpacity="0.25" />
                <Stop offset="1" stopColor={colors.textTertiary} stopOpacity="0.05" />
              </LinearGradient>
            </Defs>
            <Path d={overviewFillPath} fill="url(#ovFill)" />
            <Path d={overviewLinePath} stroke={colors.textTertiary} strokeWidth={1} fill="none" />
            {overviewShown && (
              <AnimatedRect
                animatedProps={viewportIndicatorAnimatedProps}
                y={OVERVIEW_PADDING_V - 2}
                height={overviewPlotHeight + 4}
                fill={colors.accent}
                fillOpacity={0.18}
                stroke={colors.accent}
                strokeWidth={1}
                rx={2}
              />
            )}
            {overviewCurrentX != null && (
              <Circle
                cx={overviewCurrentX}
                cy={OVERVIEW_PADDING_V + overviewPlotHeight / 2}
                r={OVERVIEW_MARKER_RADIUS}
                fill={colors.accent}
              />
            )}
          </Svg>
          <View
            style={{
              position: "absolute",
              left: PADDING.left,
              right: PADDING.right,
              top: OVERVIEW_BAR_HEIGHT + 2,
              flexDirection: "row",
              justifyContent: "space-between",
            }}
          >
            <Text className="font-barlow-sc-medium text-[10px] text-muted-foreground">
              {formatDistance(distanceOffsetMeters, units)}
            </Text>
            <Text className="font-barlow-sc-medium text-[10px] text-muted-foreground">
              {formatDistance(distanceOffsetMeters + totalMeters, units)}
            </Text>
          </View>
        </View>
      )}

      <View style={{ flexDirection: "row", height: mainChartHeight }}>
        <View style={{ width: PADDING.left, height: mainChartHeight }}>
          {yLabels.map((l) => (
            <Text
              key={`yl-${l.value}`}
              className="font-barlow-sc-medium text-[10px] text-muted-foreground"
              style={{ position: "absolute", left: 2, top: l.y - Y_LABEL_OFFSET_Y }}
            >
              {formatElevation(l.value, units)}
            </Text>
          ))}
        </View>

        {isScrollable ? (
          <Animated.ScrollView
            ref={scrollRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            scrollEventThrottle={16}
            onScroll={onScroll}
            bounces={false}
            overScrollMode="never"
            style={{ width: viewportWidth }}
          >
            {detailBody}
          </Animated.ScrollView>
        ) : (
          <View style={{ width: viewportWidth, height: mainChartHeight }}>{detailBody}</View>
        )}
      </View>

      {showLegend && (
        <View className="flex-row items-center justify-center pb-1 gap-1">
          {ELEVATION_STOPS.map((stop) => (
            <React.Fragment key={stop.label}>
              <View className="w-2 h-2 rounded-full ml-1" style={{ backgroundColor: stop.color }} />
              <Text className="text-[9px] text-muted-foreground">{stop.label}</Text>
            </React.Fragment>
          ))}
        </View>
      )}
    </View>
  );
}
