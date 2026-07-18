import React, { useCallback, useMemo } from "react";
import { PanResponder, type ScrollView, View } from "react-native";
import {
  createAnimatedComponent,
  useAnimatedProps,
  type SharedValue,
} from "react-native-reanimated";
import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from "react-native-svg";

import { Text } from "@/components/ui/text";
import { useThemeColors } from "@/theme";
import { formatDistance } from "@/utils/formatters";
import {
  buildElevationProfileFerryMarkers,
  type ElevationProfileFerrySpan,
} from "@/utils/elevationProfileFerries";
import {
  splitElevationProfileSamplesAtBreaks,
  type ElevationProfileSample,
} from "@/utils/elevationProfileSampling";
import type { UnitSystem } from "@/types";

const PADDING = { left: 48, right: 16 };
const OVERVIEW_HEIGHT = 52;
const OVERVIEW_BAR_HEIGHT = 32;
const OVERVIEW_PADDING_V = 4;
const OVERVIEW_MARKER_RADIUS = 3;

const AnimatedRect = createAnimatedComponent(Rect);

interface ElevationProfileOverviewProps {
  samples: readonly ElevationProfileSample[];
  width: number;
  totalMeters: number;
  contentWidth: number;
  viewportWidth: number;
  currentDistanceMeters?: number;
  ferries?: readonly ElevationProfileFerrySpan[];
  distanceOffsetMeters: number;
  xAxisLabelOffsetMeters: number;
  units: UnitSystem;
  scrollRef: React.RefObject<ScrollView | null>;
  scrollX: SharedValue<number>;
}

function buildPath(
  samples: readonly ElevationProfileSample[],
  xScale: (distanceMeters: number) => number,
  yScale: (elevationMeters: number) => number,
): string {
  let path = "";
  for (let index = 0; index < samples.length; index++) {
    const x = xScale(samples[index].distanceMeters);
    const y = yScale(samples[index].elevationMeters);
    path += index === 0 || samples[index].breakBefore ? `M${x},${y}` : ` L${x},${y}`;
  }
  return path;
}

function buildFillPath(
  samples: readonly ElevationProfileSample[],
  xScale: (distanceMeters: number) => number,
  yScale: (elevationMeters: number) => number,
  axisY: number,
): string {
  return splitElevationProfileSamplesAtBreaks(samples)
    .map((segment) => {
      const line = buildPath(segment, xScale, yScale);
      const firstX = xScale(segment[0].distanceMeters);
      const lastX = xScale(segment[segment.length - 1].distanceMeters);
      return `${line} L${lastX},${axisY} L${firstX},${axisY} Z`;
    })
    .join(" ");
}

export default function ElevationProfileOverview({
  samples,
  width,
  totalMeters,
  contentWidth,
  viewportWidth,
  currentDistanceMeters,
  ferries,
  distanceOffsetMeters,
  xAxisLabelOffsetMeters,
  units,
  scrollRef,
  scrollX,
}: ElevationProfileOverviewProps) {
  const colors = useThemeColors();
  const innerWidth = Math.max(0, width - PADDING.left - PADDING.right);
  const plotHeight = OVERVIEW_BAR_HEIGHT - OVERVIEW_PADDING_V * 2;
  const ferryMarkers = useMemo(
    () =>
      buildElevationProfileFerryMarkers(ferries, {
        totalDistanceMeters: totalMeters,
        contentWidthPixels: innerWidth,
        distanceOffsetMeters,
        minimumWidthPixels: 3,
      }),
    [distanceOffsetMeters, ferries, innerWidth, totalMeters],
  );

  const { linePath, fillPath } = useMemo(() => {
    if (samples.length < 2 || innerWidth <= 0 || totalMeters <= 0) {
      return { linePath: "", fillPath: "" };
    }

    let minimum = Infinity;
    let maximum = -Infinity;
    for (const sample of samples) {
      minimum = Math.min(minimum, sample.elevationMeters);
      maximum = Math.max(maximum, sample.elevationMeters);
    }
    const range = maximum - minimum || 100;
    const minimumWithPadding = minimum - range * 0.1;
    const maximumWithPadding = maximum + range * 0.1;
    const xScale = (distanceMeters: number) =>
      PADDING.left + (distanceMeters / totalMeters) * innerWidth;
    const yScale = (elevationMeters: number) =>
      OVERVIEW_PADDING_V +
      plotHeight -
      ((elevationMeters - minimumWithPadding) /
        Math.max(1e-6, maximumWithPadding - minimumWithPadding)) *
        plotHeight;
    const line = buildPath(samples, xScale, yScale);
    const axisY = OVERVIEW_PADDING_V + plotHeight;
    return {
      linePath: line,
      fillPath: buildFillPath(samples, xScale, yScale, axisY),
    };
  }, [innerWidth, plotHeight, samples, totalMeters]);

  const seek = useCallback(
    (touchX: number) => {
      const localX = Math.max(0, Math.min(innerWidth, touchX - PADDING.left));
      const fraction = innerWidth > 0 ? localX / innerWidth : 0;
      const targetContentX = fraction * contentWidth;
      const target = Math.max(
        0,
        Math.min(contentWidth - viewportWidth, targetContentX - viewportWidth / 2),
      );
      scrollRef.current?.scrollTo({ x: target, animated: false });
      scrollX.value = target;
    },
    [contentWidth, innerWidth, scrollRef, scrollX, viewportWidth],
  );

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (event) => seek(event.nativeEvent.locationX),
        onPanResponderMove: (event) => seek(event.nativeEvent.locationX),
      }),
    [seek],
  );

  const viewportIndicatorAnimatedProps = useAnimatedProps(() => {
    const startFraction = contentWidth > 0 ? scrollX.value / contentWidth : 0;
    const endFraction =
      contentWidth > 0 ? Math.min(1, (scrollX.value + viewportWidth) / contentWidth) : 1;
    return {
      x: PADDING.left + startFraction * innerWidth,
      width: Math.max(4, (endFraction - startFraction) * innerWidth),
    };
  }, [contentWidth, innerWidth, scrollX, viewportWidth]);

  const currentX = useMemo(() => {
    if (
      currentDistanceMeters == null ||
      !Number.isFinite(currentDistanceMeters) ||
      currentDistanceMeters < 0 ||
      currentDistanceMeters > totalMeters ||
      totalMeters <= 0
    ) {
      return null;
    }
    return PADDING.left + (currentDistanceMeters / totalMeters) * innerWidth;
  }, [currentDistanceMeters, innerWidth, totalMeters]);

  return (
    <View style={{ height: OVERVIEW_HEIGHT, width }} {...panResponder.panHandlers}>
      <Svg width={width} height={OVERVIEW_BAR_HEIGHT}>
        <Defs>
          <LinearGradient id="profile-overview-fill" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={colors.textTertiary} stopOpacity="0.25" />
            <Stop offset="1" stopColor={colors.textTertiary} stopOpacity="0.05" />
          </LinearGradient>
        </Defs>
        <Path d={fillPath} fill="url(#profile-overview-fill)" />
        <Path d={linePath} stroke={colors.textTertiary} strokeWidth={1} fill="none" />
        {ferryMarkers.map((marker) => (
          <Rect
            key={`overview-ferry-${marker.id}-${marker.centerXPixels}`}
            x={PADDING.left + marker.leftPixels}
            y={OVERVIEW_PADDING_V}
            width={marker.widthPixels}
            height={plotHeight}
            rx={1}
            fill={colors.info}
            opacity={0.72}
          />
        ))}
        <AnimatedRect
          animatedProps={viewportIndicatorAnimatedProps}
          y={OVERVIEW_PADDING_V - 2}
          height={plotHeight + 4}
          fill={colors.accent}
          fillOpacity={0.18}
          stroke={colors.accent}
          strokeWidth={1}
          rx={2}
        />
        {currentX != null && (
          <Circle
            cx={currentX}
            cy={OVERVIEW_PADDING_V + plotHeight / 2}
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
          {formatDistance(xAxisLabelOffsetMeters, units)}
        </Text>
        <Text className="font-barlow-sc-medium text-[10px] text-muted-foreground">
          {formatDistance(xAxisLabelOffsetMeters + totalMeters, units)}
        </Text>
      </View>
    </View>
  );
}
