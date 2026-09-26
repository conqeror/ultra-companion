import React, { useMemo } from "react";
import { View } from "react-native";
import Svg, { Line, Path } from "react-native-svg";
import { Text } from "@/components/ui/text";
import { useThemeColors } from "@/theme";
import type { RoutePlannerCandidate, RoutePoint } from "@/types";

export interface PlannerElevationDomain {
  maxDistanceMeters: number;
  minElevationMeters: number;
  maxElevationMeters: number;
}

export function getPlannerElevationDomain(
  candidates: readonly RoutePlannerCandidate[],
): PlannerElevationDomain {
  let maxDistanceMeters = 1;
  let minElevationMeters = Infinity;
  let maxElevationMeters = -Infinity;
  for (const candidate of candidates) {
    maxDistanceMeters = Math.max(maxDistanceMeters, candidate.route.totalDistanceMeters);
    for (const point of candidate.route.points) {
      if (point.elevationMeters == null) continue;
      minElevationMeters = Math.min(minElevationMeters, point.elevationMeters);
      maxElevationMeters = Math.max(maxElevationMeters, point.elevationMeters);
    }
  }
  if (!Number.isFinite(minElevationMeters) || !Number.isFinite(maxElevationMeters)) {
    return { maxDistanceMeters, minElevationMeters: 0, maxElevationMeters: 1 };
  }
  const range = Math.max(20, maxElevationMeters - minElevationMeters);
  return {
    maxDistanceMeters,
    minElevationMeters: minElevationMeters - range * 0.08,
    maxElevationMeters: maxElevationMeters + range * 0.08,
  };
}

function sampledPoints(points: readonly RoutePoint[], limit = 220): RoutePoint[] {
  if (points.length <= limit) return [...points];
  const result: RoutePoint[] = [];
  const step = (points.length - 1) / (limit - 1);
  for (let index = 0; index < limit; index++) {
    result.push(points[Math.min(points.length - 1, Math.round(index * step))]);
  }
  return result;
}

export default function RouteCandidateElevationChart({
  points,
  domain,
  color,
  width,
  height,
}: {
  points: readonly RoutePoint[];
  domain: PlannerElevationDomain;
  color: string;
  width: number;
  height: number;
}) {
  const colors = useThemeColors();
  const padding = 4;
  const path = useMemo(() => {
    const xRange = Math.max(1, width - padding * 2);
    const yRange = Math.max(1, height - padding * 2);
    const elevationRange = Math.max(1, domain.maxElevationMeters - domain.minElevationMeters);
    let result = "";
    let needsMove = true;
    for (const point of sampledPoints(points)) {
      if (point.elevationMeters == null) {
        needsMove = true;
        continue;
      }
      const x = padding + (point.distanceFromStartMeters / domain.maxDistanceMeters) * xRange;
      const y =
        padding +
        (1 - (point.elevationMeters - domain.minElevationMeters) / elevationRange) * yRange;
      result += `${needsMove ? "M" : " L"}${x.toFixed(1)},${y.toFixed(1)}`;
      needsMove = false;
    }
    return result;
  }, [domain, height, points, width]);

  if (!path) {
    return (
      <View style={{ width, height }} className="items-center justify-center">
        <Text className="text-[11px] text-muted-foreground">No elevation</Text>
      </View>
    );
  }

  return (
    <Svg width={width} height={height} accessibilityLabel="Elevation graph">
      <Line
        x1={padding}
        y1={height - padding}
        x2={width - padding}
        y2={height - padding}
        stroke={colors.border}
        strokeWidth={1}
      />
      <Path d={path} stroke={color} strokeWidth={2.25} fill="none" />
    </Svg>
  );
}
