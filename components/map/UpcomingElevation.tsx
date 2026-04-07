import React, { useMemo } from "react";
import { View } from "react-native";
import { Text } from "@/components/ui/text";
import ElevationProfile from "@/components/elevation/ElevationProfile";
import { extractRouteSlice } from "@/utils/geo";
import { LOOK_BACK_RATIO } from "@/constants";
import type { RoutePoint, UnitSystem, POI, Climb } from "@/types";

interface UpcomingElevationProps {
  points: RoutePoint[];
  currentPointIndex: number;
  /** Look-ahead distance in meters */
  lookAhead: number;
  units: UnitSystem;
  width: number;
  height: number;
  /** POIs to display on the elevation chart */
  pois?: POI[];
  /** Called when a POI marker is tapped */
  onPOIPress?: (poi: POI) => void;
  /** Climbs to render as shading */
  climbs?: Climb[];
}

export default function UpcomingElevation({
  points,
  currentPointIndex,
  lookAhead,
  units,
  width,
  height,
  pois,
  onPOIPress,
  climbs,
}: UpcomingElevationProps) {
  const { slicedPoints, currentIdxInSlice, offsetMeters, sliceEndDist } = useMemo(() => {
    if (points.length < 2)
      return { slicedPoints: [] as RoutePoint[], currentIdxInSlice: 0, offsetMeters: 0, sliceEndDist: 0 };

    const currentDist = points[currentPointIndex].distanceFromStartMeters;
    const totalDist = points[points.length - 1].distanceFromStartMeters;

    // Look-back: ~20% of visible chart is behind current position
    const lookBackM = lookAhead * LOOK_BACK_RATIO;

    // Find start index by scanning backwards
    const startDist = Math.max(0, currentDist - lookBackM);
    let startIdx = currentPointIndex;
    while (startIdx > 0 && points[startIdx - 1].distanceFromStartMeters >= startDist) {
      startIdx--;
    }

    const sliceOffsetMeters = points[startIdx].distanceFromStartMeters;
    const totalSliceM = (currentDist - sliceOffsetMeters) + lookAhead;
    const sliced = extractRouteSlice(points, startIdx, totalSliceM);
    const idxInSlice = currentPointIndex - startIdx;

    return {
      slicedPoints: sliced,
      currentIdxInSlice: idxInSlice,
      offsetMeters: sliceOffsetMeters,
      sliceEndDist: sliceOffsetMeters + totalSliceM,
    };
  }, [points, currentPointIndex, lookAhead]);

  // Filter POIs to visible slice range
  const visiblePOIs = useMemo(() => {
    if (!pois) return undefined;
    return pois.filter(
      (p) =>
        p.distanceAlongRouteMeters >= offsetMeters &&
        p.distanceAlongRouteMeters <= sliceEndDist,
    );
  }, [pois, offsetMeters, sliceEndDist]);

  // Filter climbs to visible slice range
  const visibleClimbs = useMemo(() => {
    if (!climbs) return undefined;
    return climbs.filter(
      (c) =>
        c.endDistanceMeters >= offsetMeters &&
        c.startDistanceMeters <= sliceEndDist,
    );
  }, [climbs, offsetMeters, sliceEndDist]);

  if (slicedPoints.length <= 1) {
    return (
      <View className="flex-1 items-center justify-center">
        <Text className="text-sm text-muted-foreground">
          Near the end of your route
        </Text>
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
      pois={visiblePOIs}
      onPOIPress={onPOIPress}
      climbs={visibleClimbs}
    />
  );
}
