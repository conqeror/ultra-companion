import React, { useMemo } from "react";
import { View } from "react-native";
import Svg, { Path, Circle, Defs, LinearGradient, Stop, Line } from "react-native-svg";
import { Text } from "@/components/ui/text";
import { useThemeColors, gradientColor } from "@/theme";
import { ELEVATION_STOPS } from "@/theme/elevation";
import { formatDistance, formatElevation } from "@/utils/formatters";
import type { RoutePoint, UnitSystem } from "@/types";

interface ElevationProfileProps {
  points: RoutePoint[];
  units: UnitSystem;
  width: number;
  height: number;
  currentPointIndex?: number;
  showLegend?: boolean;
  /** Offset added to X-axis labels so they show absolute route distance */
  distanceOffsetMeters?: number;
}

const PADDING = { top: 16, right: 16, bottom: 28, left: 48 };
const SAMPLE_INTERVAL_M = 100;

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

export default function ElevationProfile({
  points,
  units,
  width,
  height,
  currentPointIndex,
  showLegend = true,
  distanceOffsetMeters = 0,
}: ElevationProfileProps) {
  const colors = useThemeColors();
  const chartWidth = width - PADDING.left - PADDING.right;
  const chartHeight = height - PADDING.top - PADDING.bottom;

  const { linePath, fillPath, gradientStops, minElev, maxElev, totalDist, xScale, yScale } =
    useMemo(() => {
      if (points.length === 0) {
        return {
          linePath: "",
          fillPath: "",
          gradientStops: [] as { offset: string; color: string }[],
          minElev: 0,
          maxElev: 100,
          totalDist: 0,
          xScale: (_d: number) => 0,
          yScale: (_e: number) => 0,
        };
      }

      const samples = resampleAtInterval(points, SAMPLE_INTERVAL_M);
      if (samples.length < 2) {
        return {
          linePath: "",
          fillPath: "",
          gradientStops: [],
          minElev: 0,
          maxElev: 100,
          totalDist: 0,
          xScale: (_d: number) => 0,
          yScale: (_e: number) => 0,
        };
      }

      const elevs = samples.map((s) => s.elevation);
      const minE = Math.min(...elevs);
      const maxE = Math.max(...elevs);
      const elevRange = maxE - minE || 100;
      const pad = elevRange * 0.1;
      const yMin = minE - pad;
      const yMax = maxE + pad;
      const totalD = samples[samples.length - 1].distance;

      const xs = (d: number) =>
        PADDING.left + (totalD > 0 ? (d / totalD) * chartWidth : 0);
      const ys = (e: number) =>
        PADDING.top + chartHeight - ((e - yMin) / (yMax - yMin)) * chartHeight;

      // Compute gradient at each sample point
      const grads: number[] = [];
      for (let i = 0; i < samples.length; i++) {
        if (i === 0) {
          const dist = samples[1].distance - samples[0].distance;
          const elevDiff = samples[1].elevation - samples[0].elevation;
          grads.push(dist > 0 ? (elevDiff / dist) * 100 : 0);
        } else if (i === samples.length - 1) {
          const dist = samples[i].distance - samples[i - 1].distance;
          const elevDiff = samples[i].elevation - samples[i - 1].elevation;
          grads.push(dist > 0 ? (elevDiff / dist) * 100 : 0);
        } else {
          const dist = samples[i + 1].distance - samples[i - 1].distance;
          const elevDiff = samples[i + 1].elevation - samples[i - 1].elevation;
          grads.push(dist > 0 ? (elevDiff / dist) * 100 : 0);
        }
      }

      // Build gradient stops
      const stops: { offset: string; color: string }[] = [];
      for (let i = 0; i < samples.length; i++) {
        const fraction = totalD > 0 ? samples[i].distance / totalD : 0;
        stops.push({
          offset: fraction.toFixed(4),
          color: gradientColor(grads[i]),
        });
      }

      // Build line path
      let lineD = "";
      for (let i = 0; i < samples.length; i++) {
        const x = xs(samples[i].distance);
        const y = ys(samples[i].elevation);
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
        totalDist: totalD,
        xScale: xs,
        yScale: ys,
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

  if (points.length === 0) {
    return (
      <View className="bg-surface" style={{ width, height }}>
        <Text className="text-center text-muted-foreground mt-10">
          No elevation data
        </Text>
      </View>
    );
  }

  const elevRange = maxElev - minElev;
  const yLabels = [minElev, minElev + elevRange / 2, maxElev].map((e) => ({
    value: e,
    y: PADDING.top + chartHeight - ((e - minElev) / elevRange) * chartHeight,
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
