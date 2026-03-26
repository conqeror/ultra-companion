import React, { useMemo } from "react";
import { View, Text, StyleSheet } from "react-native";
import ElevationProfile from "@/components/elevation/ElevationProfile";
import { extractRouteSlice } from "@/utils/geo";
import { LOOK_BACK_RATIO } from "@/constants";
import type { RoutePoint, UnitSystem } from "@/types";

/** Max look-back distance in meters (cap for "remaining" mode) */
const MAX_LOOK_BACK_M = 5_000;

interface UpcomingElevationProps {
  points: RoutePoint[];
  currentPointIndex: number;
  /** Look-ahead distance in meters, or "remaining" for rest of route */
  lookAhead: number | "remaining";
  units: UnitSystem;
  width: number;
  height: number;
}

export default function UpcomingElevation({
  points,
  currentPointIndex,
  lookAhead,
  units,
  width,
  height,
}: UpcomingElevationProps) {
  const { slicedPoints, currentIdxInSlice, offsetMeters } = useMemo(() => {
    if (points.length < 2)
      return { slicedPoints: [] as RoutePoint[], currentIdxInSlice: 0, offsetMeters: 0 };

    const currentDist = points[currentPointIndex].distanceFromStartMeters;
    const totalDist = points[points.length - 1].distanceFromStartMeters;

    const lookAheadM =
      lookAhead === "remaining" ? totalDist - currentDist : lookAhead;

    // Look-back: ~20% of visible chart is behind current position
    const rawLookBackM = lookAheadM * LOOK_BACK_RATIO;
    const lookBackM =
      lookAhead === "remaining"
        ? Math.min(rawLookBackM, MAX_LOOK_BACK_M)
        : rawLookBackM;

    // Find start index by scanning backwards
    const startDist = Math.max(0, currentDist - lookBackM);
    let startIdx = currentPointIndex;
    while (startIdx > 0 && points[startIdx - 1].distanceFromStartMeters >= startDist) {
      startIdx--;
    }

    const sliceOffsetMeters = points[startIdx].distanceFromStartMeters;
    const totalSliceM = (currentDist - sliceOffsetMeters) + lookAheadM;
    const sliced = extractRouteSlice(points, startIdx, totalSliceM);
    const idxInSlice = currentPointIndex - startIdx;

    return { slicedPoints: sliced, currentIdxInSlice: idxInSlice, offsetMeters: sliceOffsetMeters };
  }, [points, currentPointIndex, lookAhead]);

  if (slicedPoints.length <= 1) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>Near the end of your route</Text>
      </View>
    );
  }

  return (
    <ElevationProfile
      points={slicedPoints}
      units={units}
      width={width}
      height={height}
      currentPointIndex={currentIdxInSlice}
      showLegend={false}
      distanceOffsetMeters={offsetMeters}
    />
  );
}

const styles = StyleSheet.create({
  emptyContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyText: {
    fontSize: 14,
    color: "#8E8E93",
  },
});
