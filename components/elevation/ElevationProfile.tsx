import React, { useMemo } from "react";
import { View } from "react-native";
import Svg, { Path, Circle, Defs, LinearGradient, Stop, Line, G, Rect, Text as SvgText } from "react-native-svg";
import { Text } from "@/components/ui/text";
import { useThemeColors, gradientColor } from "@/theme";
import { ELEVATION_STOPS } from "@/theme/elevation";
import { formatDistance, formatElevation } from "@/utils/formatters";
import { getOpeningHoursStatus } from "@/services/openingHoursParser";
import { categoryColor, categoryLetter, ohStatusColorKey } from "@/constants/poiHelpers";
import { climbDifficultyColor } from "@/constants/climbHelpers";
import type { RoutePoint, UnitSystem, POI, Climb } from "@/types";

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
  showLegend?: boolean;
  /** Offset added to X-axis labels so they show absolute route distance */
  distanceOffsetMeters?: number;
  /** POIs to render as markers on the chart */
  pois?: POI[];
  /** Called when a POI marker is tapped */
  onPOIPress?: (poi: POI) => void;
  /** Vertical boundary lines at segment junctions (for stitched collections) */
  segmentBoundaries?: SegmentBoundary[];
  /** Climbs to render as colored shading regions */
  climbs?: Climb[];
}

const PADDING = { top: 16, right: 16, bottom: 28, left: 48 };
const SAMPLE_INTERVAL_M = 100;
const POI_MARKER_RADIUS = 6;
const POI_MARKER_OFFSET_Y = -14;
const POI_COLLISION_MIN_PX = 12;
const POI_COLLISION_STEP_PX = 16;

/** Resample route points at fixed distance intervals */
function resampleAtInterval(
  points: RoutePoint[],
  intervalM: number,
): { distance: number; elevation: number }[] {
  if (points.length === 0) return [];

  const result: { distance: number; elevation: number }[] = [];
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

/** Interpolate elevation at a given distance using evenly-spaced resampled data (O(1)) */
function interpolateElevation(
  samples: { distance: number; elevation: number }[],
  distance: number,
): number {
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

/** Pick round-number elevation ticks covering the actual data range (not padded viewport). */
function buildYLabels(yMin: number, yMax: number, dataMin: number, dataMax: number): number[] {
  const lo = Math.max(0, yMin, Math.floor(dataMin));
  const hi = Math.min(yMax, dataMax);
  const range = hi - lo;
  if (range <= 0) return [Math.round(lo)];

  const raw = range / 3;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / pow;
  const mult = norm >= 5 ? 5 : norm >= 2 ? 2 : 1;
  const step = mult * pow;

  const first = Math.ceil(lo / step) * step;
  // One tick above the data for headroom, as long as it fits in the viewport
  const lastCandidate = Math.ceil(hi / step) * step;
  const last = lastCandidate <= yMax + 1e-6 ? lastCandidate : Math.floor(hi / step) * step;
  const ticks: number[] = [];
  for (let v = first; v <= last + 1e-6; v += step) ticks.push(Math.round(v));

  if (yMin <= 0 && (ticks.length === 0 || ticks[0] !== 0)) ticks.unshift(0);
  return ticks;
}

interface POIMarkerPos {
  poi: POI;
  x: number;
  y: number;
  color: string;
  letter: string;
  ohRingColor: string | null;
}

export default function ElevationProfile({
  points,
  units,
  width,
  height,
  currentPointIndex,
  showLegend = true,
  distanceOffsetMeters = 0,
  pois,
  onPOIPress,
  segmentBoundaries,
  climbs,
}: ElevationProfileProps) {
  const colors = useThemeColors();
  const chartWidth = width - PADDING.left - PADDING.right;
  const chartHeight = height - PADDING.top - PADDING.bottom;

  const { linePath, fillPath, gradientStops, minElev, maxElev, dataMin, dataMax, totalDist, xScale, yScale, samples } =
    useMemo(() => {
      if (points.length === 0) {
        return {
          linePath: "",
          fillPath: "",
          gradientStops: [] as { offset: string; color: string }[],
          minElev: 0,
          maxElev: 100,
          dataMin: 0,
          dataMax: 100,
          totalDist: 0,
          xScale: (_d: number) => 0,
          yScale: (_e: number) => 0,
          samples: [] as { distance: number; elevation: number }[],
        };
      }

      const smp = resampleAtInterval(points, SAMPLE_INTERVAL_M);
      if (smp.length < 2) {
        return {
          linePath: "",
          fillPath: "",
          gradientStops: [],
          minElev: 0,
          maxElev: 100,
          dataMin: 0,
          dataMax: 100,
          totalDist: 0,
          xScale: (_d: number) => 0,
          yScale: (_e: number) => 0,
          samples: smp,
        };
      }

      const elevs = smp.map((s) => s.elevation);
      const minE = Math.min(...elevs);
      const maxE = Math.max(...elevs);
      const rawRange = maxE - minE || 100;
      const totalD = smp[smp.length - 1].distance;
      // Scale min vertical range to horizontal distance (~5%), clamped to [50, 200]
      const minRange = Math.min(200, Math.max(50, totalD * 0.05));
      // Cap vertical exaggeration so long routes in tall charts don't make hills look like cliffs
      const MAX_EXAGGERATION = 200;
      const horizMPerPx = chartWidth > 0 ? totalD / chartWidth : 0;
      const minRangeForAspect = (chartHeight * horizMPerPx) / MAX_EXAGGERATION;
      const elevRange = Math.max(rawRange, minRange, minRangeForAspect);
      const mid = (minE + maxE) / 2;
      const paddedRange = elevRange * 1.2;
      let yMin = mid - paddedRange / 2;
      let yMax = mid + paddedRange / 2;
      // If padding would push below sea level but actual data isn't, anchor 0 to the bottom
      if (yMin < 0 && minE >= 0) {
        yMax = paddedRange;
        yMin = 0;
      }

      const xs = (d: number) =>
        PADDING.left + (totalD > 0 ? (d / totalD) * chartWidth : 0);
      const ys = (e: number) =>
        PADDING.top + chartHeight - ((e - yMin) / (yMax - yMin)) * chartHeight;

      // Compute gradient at each sample point
      const grads: number[] = [];
      for (let i = 0; i < smp.length; i++) {
        if (i === 0) {
          const dist = smp[1].distance - smp[0].distance;
          const elevDiff = smp[1].elevation - smp[0].elevation;
          grads.push(dist > 0 ? (elevDiff / dist) * 100 : 0);
        } else if (i === smp.length - 1) {
          const dist = smp[i].distance - smp[i - 1].distance;
          const elevDiff = smp[i].elevation - smp[i - 1].elevation;
          grads.push(dist > 0 ? (elevDiff / dist) * 100 : 0);
        } else {
          const dist = smp[i + 1].distance - smp[i - 1].distance;
          const elevDiff = smp[i + 1].elevation - smp[i - 1].elevation;
          grads.push(dist > 0 ? (elevDiff / dist) * 100 : 0);
        }
      }

      // Build gradient stops
      const stops: { offset: string; color: string }[] = [];
      for (let i = 0; i < smp.length; i++) {
        const fraction = totalD > 0 ? smp[i].distance / totalD : 0;
        stops.push({
          offset: fraction.toFixed(4),
          color: gradientColor(grads[i]),
        });
      }

      // Build line path
      let lineD = "";
      for (let i = 0; i < smp.length; i++) {
        const x = xs(smp[i].distance);
        const y = ys(smp[i].elevation);
        lineD += i === 0 ? `M${x},${y}` : ` L${x},${y}`;
      }

      // Fill path
      const fillD =
        lineD +
        ` L${xs(totalD)},${PADDING.top + chartHeight}` +
        ` L${xs(0)},${PADDING.top + chartHeight} Z`;

      return {
        linePath: lineD,
        fillPath: fillD,
        gradientStops: stops,
        minElev: yMin,
        maxElev: yMax,
        dataMin: minE,
        dataMax: maxE,
        totalDist: totalD,
        xScale: xs,
        yScale: ys,
        samples: smp,
      };
    }, [points, chartWidth, chartHeight]);

  const currentPos = useMemo(() => {
    if (currentPointIndex == null || currentPointIndex < 0 || currentPointIndex >= points.length)
      return null;
    const p = points[currentPointIndex];
    return {
      x: xScale(p.distanceFromStartMeters),
      y: yScale(p.elevationMeters ?? 0),
    };
  }, [currentPointIndex, points, xScale, yScale]);

  // Compute POI marker positions with collision avoidance
  const poiMarkers = useMemo(() => {
    if (!pois || pois.length === 0 || samples.length === 0 || totalDist === 0) return [];

    const markers: POIMarkerPos[] = [];

    for (const poi of pois) {
      // Convert POI's absolute distanceAlongRouteMeters to local chart distance
      const localDist = poi.distanceAlongRouteMeters - distanceOffsetMeters;
      if (localDist < 0 || localDist > totalDist) continue;

      const x = xScale(localDist);
      const elev = interpolateElevation(samples, localDist);
      const baseY = yScale(elev) + POI_MARKER_OFFSET_Y;

      const ohTag = poi.tags?.opening_hours;
      const ohKey = ohTag ? ohStatusColorKey(getOpeningHoursStatus(ohTag)) : null;
      const ohRingColor = ohKey ? colors[ohKey] : null;

      markers.push({
        poi,
        x,
        y: baseY,
        color: categoryColor(poi.category),
        letter: categoryLetter(poi.category),
        ohRingColor,
      });
    }

    // Simple collision avoidance: if markers overlap horizontally, offset upward
    markers.sort((a, b) => a.x - b.x);
    for (let i = 1; i < markers.length; i++) {
      if (markers[i].x - markers[i - 1].x < POI_COLLISION_MIN_PX) {
        markers[i].y = markers[i - 1].y - POI_COLLISION_STEP_PX;
      }
    }

    // Clamp to chart area
    for (const m of markers) {
      m.y = Math.max(PADDING.top + POI_MARKER_RADIUS + 2, m.y);
    }

    return markers;
  }, [pois, samples, totalDist, distanceOffsetMeters, xScale, yScale, colors]);

  // Compute climb shading regions
  const climbRegions = useMemo(() => {
    if (!climbs || climbs.length === 0 || samples.length === 0 || totalDist === 0) return [];

    return climbs.map((climb) => {
      const localStart = climb.startDistanceMeters - distanceOffsetMeters;
      const localEnd = climb.endDistanceMeters - distanceOffsetMeters;
      const visStart = Math.max(0, localStart);
      const visEnd = Math.min(totalDist, localEnd);
      if (visStart >= visEnd) return null;

      const color = climbDifficultyColor(climb.difficultyScore);

      // Build fill path: trace elevation line from visStart to visEnd, then close to X-axis
      let d = "";
      const startX = xScale(visStart);
      const startElev = interpolateElevation(samples, visStart);
      d = `M${startX},${yScale(startElev)}`;

      for (const s of samples) {
        if (s.distance <= visStart) continue;
        if (s.distance >= visEnd) break;
        d += ` L${xScale(s.distance)},${yScale(s.elevation)}`;
      }

      const endX = xScale(visEnd);
      const endElev = interpolateElevation(samples, visEnd);
      d += ` L${endX},${yScale(endElev)}`;

      const axisY = PADDING.top + chartHeight;
      d += ` L${endX},${axisY} L${startX},${axisY} Z`;

      return { id: climb.id, color, fillPath: d };
    }).filter(Boolean) as { id: string; color: string; fillPath: string }[];
  }, [climbs, samples, totalDist, distanceOffsetMeters, xScale, yScale, chartHeight]);

  if (points.length === 0) {
    return (
      <View className="bg-surface" style={{ width, height }}>
        <Text className="text-center text-muted-foreground mt-10">
          No elevation data
        </Text>
      </View>
    );
  }

  const yLabels = buildYLabels(minElev, maxElev, dataMin, dataMax).map((value) => ({
    value,
    y: yScale(value),
  }));

  const xLabels = [0, totalDist / 2, totalDist].map((d) => ({
    value: d,
    x: xScale(d),
  }));

  return (
    <View className="bg-surface" style={{ width, height }}>
      <Svg width={width} height={height}>
        <Defs>
          <LinearGradient id="elevFill" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={colors.textTertiary} stopOpacity="0.15" />
            <Stop offset="1" stopColor={colors.textTertiary} stopOpacity="0.03" />
          </LinearGradient>
          {/* Horizontal gradient matching terrain steepness */}
          <LinearGradient id="lineGrad" x1="0" y1="0" x2="1" y2="0">
            {gradientStops.map((s, i) => (
              <Stop key={i} offset={s.offset} stopColor={s.color} />
            ))}
          </LinearGradient>
        </Defs>

        {/* Grid lines */}
        {yLabels.map((l, i) => (
          <Line
            key={`grid-${i}`}
            x1={PADDING.left}
            y1={l.y}
            x2={width - PADDING.right}
            y2={l.y}
            stroke={colors.border}
            strokeWidth={0.5}
          />
        ))}

        {/* Fill area */}
        <Path d={fillPath} fill="url(#elevFill)" />

        {/* Climb shading */}
        {climbRegions.map((region) => (
          <Path
            key={`climb-${region.id}`}
            d={region.fillPath}
            fill={region.color}
            opacity={0.2}
          />
        ))}

        {/* Single path with blended gradient stroke */}
        <Path
          d={linePath}
          stroke="url(#lineGrad)"
          strokeWidth={2.5}
          fill="none"
          strokeLinejoin="round"
        />

        {/* Current position marker */}
        {currentPos && (
          <>
            <Line
              x1={currentPos.x}
              y1={PADDING.top}
              x2={currentPos.x}
              y2={PADDING.top + chartHeight}
              stroke={colors.accent}
              strokeWidth={1}
              strokeDasharray="4,4"
            />
            <Circle cx={currentPos.x} cy={currentPos.y} r={5} fill={colors.accent} />
          </>
        )}

        {/* Segment boundary lines */}
        {segmentBoundaries?.map((b, i) => {
          const localDist = b.distanceMeters - distanceOffsetMeters;
          if (localDist <= 0 || localDist >= totalDist) return null;
          const bx = xScale(localDist);
          return (
            <Line
              key={`seg-boundary-${i}`}
              x1={bx}
              y1={PADDING.top}
              x2={bx}
              y2={PADDING.top + chartHeight}
              stroke={colors.border}
              strokeWidth={1}
              strokeDasharray="3,3"
              opacity={0.6}
            />
          );
        })}

        {/* POI markers */}
        {poiMarkers.map((m) => (
          <G
            key={m.poi.id}
            onPress={onPOIPress ? () => onPOIPress(m.poi) : undefined}
          >
            {/* Opening hours ring */}
            {m.ohRingColor && (
              <Circle
                cx={m.x}
                cy={m.y}
                r={POI_MARKER_RADIUS + 2.5}
                fill="none"
                stroke={m.ohRingColor}
                strokeWidth={2}
              />
            )}
            {/* Category circle */}
            <Circle
              cx={m.x}
              cy={m.y}
              r={POI_MARKER_RADIUS}
              fill={m.color}
            />
            {/* Category letter */}
            <SvgText
              x={m.x}
              y={m.y + 3.5}
              fontSize={9}
              fontWeight="bold"
              fill="white"
              textAnchor="middle"
            >
              {m.letter}
            </SvgText>
            {/* Invisible touch target */}
            {onPOIPress && (
              <Rect
                x={m.x - 24}
                y={m.y - 24}
                width={48}
                height={48}
                fill="transparent"
              />
            )}
          </G>
        ))}
      </Svg>

      {/* Y-axis labels */}
      {yLabels.map((l, i) => (
        <Text
          key={`yl-${i}`}
          className="font-barlow-sc-medium text-[10px] text-muted-foreground"
          style={{ position: "absolute", left: 2, top: l.y - 7 }}
        >
          {formatElevation(l.value, units)}
        </Text>
      ))}

      {/* X-axis labels */}
      {xLabels.map((l, i) => (
        <Text
          key={`xl-${i}`}
          className="font-barlow-sc-medium text-[10px] text-muted-foreground text-center"
          style={{ position: "absolute", left: l.x - 20, bottom: 4, width: 40 }}
        >
          {formatDistance(l.value + distanceOffsetMeters, units)}
        </Text>
      ))}

      {/* Gradient legend */}
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
