import React, { useMemo } from "react";
import { View } from "react-native";
import { Text } from "@/components/ui/text";
import ElevationProfile from "@/components/elevation/ElevationProfile";
import {
  extractRouteSlice,
  findFirstPointAtOrAfterDistance,
  findNearestPointIndexAtDistance,
} from "@/utils/geo";
import { filterCollectionSegmentProfileBoundariesForRange } from "@/utils/collectionSegmentDisplay";
import { bucketDistanceForDerivedWork } from "@/utils/distanceBuckets";
import { LOOK_BACK_RATIO } from "@/constants";
import type { RoutePoint, UnitSystem, DisplayPOI, DisplayClimb } from "@/types";
import type { CollectionSegmentProfileBoundary } from "@/utils/collectionSegmentDisplay";
import type { ElevationProfileFerrySpan } from "@/utils/elevationProfileFerries";

interface UpcomingElevationProps {
  points: RoutePoint[];
  currentDistanceMeters: number | null;
  /** Look-ahead distance in meters */
  lookAhead: number;
  units: UnitSystem;
  width: number;
  height: number;
  /** POIs to display on the elevation chart */
  pois?: DisplayPOI[];
  /** Called when a POI marker is tapped */
  onPOIPress?: (poi: DisplayPOI) => void;
  /** Climbs to render as shading */
  climbs?: DisplayClimb[];
  /** Ferry intervals in the same absolute distance space as points. */
  ferries?: readonly ElevationProfileFerrySpan[];
  /** Absolute-distance collection segment boundaries to render on the chart */
  segmentBoundaries?: CollectionSegmentProfileBoundary[];
  /** Force fit-to-width — disables horizontal scrolling and the overview minimap */
  fitToWidth?: boolean;
}

export default function UpcomingElevation({
  points,
  currentDistanceMeters,
  lookAhead,
  units,
  width,
  height,
  pois,
  onPOIPress,
  climbs,
  ferries,
  segmentBoundaries,
  fitToWidth,
}: UpcomingElevationProps) {
  const derivedCurrentDistanceMeters = bucketDistanceForDerivedWork(currentDistanceMeters) ?? 0;
  const { slicedPoints, offsetMeters, sliceEndDist } = useMemo(() => {
    if (points.length < 2)
      return {
        slicedPoints: [] as RoutePoint[],
        offsetMeters: 0,
        sliceEndDist: 0,
      };

    const windowAnchorDistanceMeters = Math.max(
      0,
      Math.min(points[points.length - 1].distanceFromStartMeters, derivedCurrentDistanceMeters),
    );
    const totalDist = points[points.length - 1].distanceFromStartMeters;

    // Keep the selected horizon as the upcoming distance, with a smaller
    // lookback for context: 10 km => 2 km back, 100 km => 20 km back, etc.
    const desiredBack = lookAhead * LOOK_BACK_RATIO;
    const startDist = Math.max(0, windowAnchorDistanceMeters - desiredBack);
    const endDist = Math.min(totalDist, windowAnchorDistanceMeters + lookAhead);

    const firstAtOrAfterStart = findFirstPointAtOrAfterDistance(points, startDist);
    const startIdx =
      points[firstAtOrAfterStart]?.distanceFromStartMeters === startDist
        ? firstAtOrAfterStart
        : Math.max(0, firstAtOrAfterStart - 1);

    const sliceOffsetMeters = points[startIdx].distanceFromStartMeters;
    const totalSliceM = Math.max(0, endDist - sliceOffsetMeters);
    const sliced = extractRouteSlice(points, startIdx, totalSliceM);

    return {
      slicedPoints: sliced,
      offsetMeters: sliceOffsetMeters,
      sliceEndDist: endDist,
    };
  }, [points, derivedCurrentDistanceMeters, lookAhead]);

  // Keep the marker exact while the expensive route slice changes only when
  // progress crosses a derived-work bucket boundary.
  const currentDistanceInSliceMeters =
    currentDistanceMeters != null && points.length > 0
      ? Math.max(
          0,
          Math.min(points[points.length - 1].distanceFromStartMeters, currentDistanceMeters),
        ) - offsetMeters
      : undefined;
  const currentIdxInSlice =
    currentDistanceInSliceMeters != null && slicedPoints.length > 0
      ? findNearestPointIndexAtDistance(slicedPoints, currentDistanceInSliceMeters)
      : undefined;

  // Filter POIs to visible slice range
  const visiblePOIs = useMemo(() => {
    if (!pois) return undefined;
    return pois.filter(
      (p) => p.effectiveDistanceMeters >= offsetMeters && p.effectiveDistanceMeters <= sliceEndDist,
    );
  }, [pois, offsetMeters, sliceEndDist]);

  // Filter climbs to visible slice range
  const visibleClimbs = useMemo(() => {
    if (!climbs) return undefined;
    return climbs.filter(
      (c) =>
        c.effectiveEndDistanceMeters >= offsetMeters &&
        c.effectiveStartDistanceMeters <= sliceEndDist,
    );
  }, [climbs, offsetMeters, sliceEndDist]);

  const visibleFerries = useMemo(() => {
    if (!ferries) return undefined;
    return ferries.filter(
      (ferry) =>
        ferry.endDistanceMeters >= offsetMeters && ferry.startDistanceMeters <= sliceEndDist,
    );
  }, [ferries, offsetMeters, sliceEndDist]);

  const visibleSegmentBoundaries = useMemo(
    () =>
      filterCollectionSegmentProfileBoundariesForRange(
        segmentBoundaries,
        offsetMeters,
        sliceEndDist,
      ),
    [segmentBoundaries, offsetMeters, sliceEndDist],
  );

  if (slicedPoints.length <= 1) {
    return (
      <View className="flex-1 items-center justify-center">
        <Text className="text-sm text-muted-foreground">Near the end of your route</Text>
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
      currentDistanceMeters={currentDistanceInSliceMeters}
      showLegend={false}
      distanceOffsetMeters={offsetMeters}
      pois={visiblePOIs}
      onPOIPress={onPOIPress}
      climbs={visibleClimbs}
      ferries={visibleFerries}
      segmentBoundaries={visibleSegmentBoundaries}
      fitToWidth={fitToWidth}
    />
  );
}
