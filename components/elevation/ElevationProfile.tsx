import React, { useMemo } from "react";
import { View, StyleSheet, Text } from "react-native";
import Svg, { Path, Circle, Defs, LinearGradient, Stop, Line } from "react-native-svg";
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

// Ascent gradient → color. Descent is always green.
function gradientColor(gradientPercent: number): string {
  if (gradientPercent <= 0) return "#4CAF50"; // descent — green
  if (gradientPercent < 1) return "#4CAF50"; // flat — green
  if (gradientPercent < 2) return "#8BC34A"; // light green
  if (gradientPercent < 3) return "#CDDC39"; // lime
  if (gradientPercent < 4) return "#FDD835"; // yellow
  if (gradientPercent < 5) return "#FFB300"; // amber
  if (gradientPercent < 7) return "#FB8C00"; // orange
  if (gradientPercent < 9) return "#F4511E"; // deep orange
  if (gradientPercent < 12) return "#E53935"; // red
  if (gradientPercent < 15) return "#B71C1C"; // dark red
  if (gradientPercent < 18) return "#5D4037"; // brown
  return "#3E2723"; // dark brown
}

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

      // Compute gradient at each sample point (average of adjacent segments)
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

      // Build gradient stops — each sample maps to a fractional position
      const stops: { offset: string; color: string }[] = [];
      for (let i = 0; i < samples.length; i++) {
        const fraction = totalD > 0 ? samples[i].distance / totalD : 0;
        stops.push({
          offset: fraction.toFixed(4),
          color: gradientColor(grads[i]),
        });
      }

      // Build single line path
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

  if (points.length === 0) {
    return (
      <View style={[styles.container, { width, height }]}>
        <Text style={styles.noData}>No elevation data</Text>
      </View>
    );
  }

  const currentPos = useMemo(() => {
    if (currentPointIndex == null || currentPointIndex < 0 || currentPointIndex >= points.length)
      return null;
    const p = points[currentPointIndex];
    return {
      x: xScale(p.distanceFromStartMeters),
      y: yScale(p.elevationMeters ?? 0),
    };
  }, [currentPointIndex, points, xScale, yScale]);

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
    <View style={[styles.container, { width, height }]}>
      <Svg width={width} height={height}>
        <Defs>
          <LinearGradient id="elevFill" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#8E8E93" stopOpacity="0.15" />
            <Stop offset="1" stopColor="#8E8E93" stopOpacity="0.03" />
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
            stroke="#E5E5EA"
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
              stroke="#007AFF"
              strokeWidth={1}
              strokeDasharray="4,4"
            />
            <Circle cx={currentPos.x} cy={currentPos.y} r={5} fill="#007AFF" />
          </>
        )}
      </Svg>

      {/* Y-axis labels */}
      {yLabels.map((l, i) => (
        <Text
          key={`yl-${i}`}
          style={[styles.axisLabel, { position: "absolute", left: 2, top: l.y - 7 }]}
        >
          {formatElevation(l.value, units)}
        </Text>
      ))}

      {/* X-axis labels */}
      {xLabels.map((l, i) => (
        <Text
          key={`xl-${i}`}
          style={[
            styles.axisLabel,
            {
              position: "absolute",
              left: l.x - 20,
              bottom: 4,
              width: 40,
              textAlign: "center",
            },
          ]}
        >
          {formatDistance(l.value + distanceOffsetMeters, units)}
        </Text>
      ))}

      {/* Gradient legend */}
      {showLegend && (
        <View style={styles.legend}>
          <View style={[styles.legendDot, { backgroundColor: "#4CAF50" }]} />
          <Text style={styles.legendText}>0%</Text>
          <View style={[styles.legendDot, { backgroundColor: "#CDDC39" }]} />
          <Text style={styles.legendText}>3</Text>
          <View style={[styles.legendDot, { backgroundColor: "#FFB300" }]} />
          <Text style={styles.legendText}>5</Text>
          <View style={[styles.legendDot, { backgroundColor: "#F4511E" }]} />
          <Text style={styles.legendText}>7</Text>
          <View style={[styles.legendDot, { backgroundColor: "#E53935" }]} />
          <Text style={styles.legendText}>9</Text>
          <View style={[styles.legendDot, { backgroundColor: "#B71C1C" }]} />
          <Text style={styles.legendText}>12</Text>
          <View style={[styles.legendDot, { backgroundColor: "#5D4037" }]} />
          <Text style={styles.legendText}>15%+</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: "#fff",
  },
  noData: {
    textAlign: "center",
    color: "#8E8E93",
    marginTop: 40,
  },
  axisLabel: {
    fontSize: 10,
    color: "#8E8E93",
  },
  legend: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingBottom: 4,
    gap: 4,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginLeft: 6,
  },
  legendText: {
    fontSize: 9,
    color: "#8E8E93",
  },
});
