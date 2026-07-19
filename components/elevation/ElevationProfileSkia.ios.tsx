import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View, type ScrollView } from "react-native";
import {
  Canvas,
  Circle,
  DashPathEffect,
  Group,
  Line,
  Picture,
  vec,
  type Transforms3d,
} from "@shopify/react-native-skia";
import Animated, {
  useAnimatedScrollHandler,
  useDerivedValue,
  useSharedValue,
  type SharedValue,
} from "react-native-reanimated";
import { POI_ICON_MAP } from "@/constants/poiIcons";
import { getCategoryMeta } from "@/constants/poiHelpers";
import { Text } from "@/components/ui/text";
import { ELEVATION_STOPS, useThemeColors } from "@/theme";
import { formatDistance } from "@/utils/formatters";
import { buildElevationProfileFerryMarkers } from "@/utils/elevationProfileFerries";
import {
  buildElevationPOIMarkers,
  buildElevationXTicks,
  buildElevationYTicks,
  computeElevationProfileLayout,
  computeElevationYDomain,
  resolveElevationCurrentPosition,
  scaleElevationDistanceToX,
  scaleElevationToY,
  type ElevationCurrentPosition,
  type ElevationPOIMarker,
  type ElevationProfileLayout,
  type ElevationYDomain,
  type ElevationYTick,
  type ElevationXTick,
} from "@/utils/elevationProfileModel";
import {
  downsampleElevationExtrema,
  interpolateElevationAtDistance,
  sampleElevationProfileForPixels,
  type ElevationProfileSample,
} from "@/utils/elevationProfileSampling";
import type { RoutePoint } from "@/types";
import { measureAsync, measureSync } from "@/utils/perfMarks";
import { yieldToUI } from "@/utils/yieldToUI";
import ElevationProfileOverview from "./ElevationProfileOverview";
import {
  buildElevationRenderGradeSegments,
  prepareElevationProfilePictures,
  type ElevationProfilePictureSet,
  type ElevationRenderGradeSegment,
} from "./elevationProfileSkiaPictures.ios";
import ElevationProfileSvg from "./ElevationProfileSvg";
import type { ElevationProfileProps } from "./elevationProfileTypes";

const MAX_DETAIL_SAMPLES = 12_000;
const SAMPLES_PER_PIXEL = 1.5;
const OVERVIEW_MAX_SAMPLES = 220;
const MAX_SVG_FALLBACK_SAMPLES = 1_200;
const CURRENT_MARKER_RADIUS = 5;
const POI_MARKER_RADIUS = 6;
const POI_ICON_SIZE = 10;
const POI_ICON_STROKE_WIDTH = 2.5;
const POI_HIT_SIZE = 48;
const X_LABEL_WIDTH = 48;
const CLIMB_X_LABEL_WIDTH = 20;
const Y_LABEL_OFFSET_Y = 7;
const SEGMENT_LABEL_WIDTH = 64;
const STANDARD_GRADE_LABEL_WIDTH = 34;

interface PreparedElevationProfile {
  samples: ElevationProfileSample[];
  overviewSamples: ElevationProfileSample[];
  layout: ElevationProfileLayout;
  domain: ElevationYDomain;
  yTicks: ElevationYTick[];
  xTicks: ElevationXTick[];
  gradeSegments: ElevationRenderGradeSegment[];
  pictureSet: ElevationProfilePictureSet;
}

type PreparationProgress =
  | { phase: "sampling"; completed: 0; total: 0 }
  | { phase: "drawing"; completed: number; total: number };

interface StaticElevationCanvasProps {
  pictureSet: ElevationProfilePictureSet;
  viewportWidthPixels: number;
  heightPixels: number;
  scrollX: SharedValue<number>;
}

const StaticElevationCanvas = memo(function StaticElevationCanvas({
  pictureSet,
  viewportWidthPixels,
  heightPixels,
  scrollX,
}: StaticElevationCanvasProps) {
  const contentTransform = useDerivedValue<Transforms3d>(() => [{ translateX: -scrollX.value }]);

  return (
    <Canvas
      pointerEvents="none"
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: viewportWidthPixels,
        height: heightPixels,
      }}
    >
      <Group transform={contentTransform}>
        {pictureSet.tiles.map((tile) => (
          <Picture
            key={tile.index}
            picture={tile.picture}
            transform={[{ translateX: tile.xPixels }]}
          />
        ))}
      </Group>
    </Canvas>
  );
});

interface CurrentMarkerCanvasProps {
  position: ElevationCurrentPosition;
  layout: ElevationProfileLayout;
  color: string;
  scrollX: SharedValue<number>;
}

const CurrentMarkerCanvas = memo(function CurrentMarkerCanvas({
  position,
  layout,
  color,
  scrollX,
}: CurrentMarkerCanvasProps) {
  const contentTransform = useDerivedValue<Transforms3d>(() => [{ translateX: -scrollX.value }]);

  return (
    <Canvas
      pointerEvents="none"
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: layout.viewportWidthPixels,
        height: layout.mainChartHeightPixels,
      }}
    >
      <Group transform={contentTransform}>
        <Line
          p1={vec(position.xPixels, layout.plotTopPixels)}
          p2={vec(position.xPixels, layout.axisYPixels)}
          color={color}
          strokeWidth={1}
        >
          <DashPathEffect intervals={[4, 4]} />
        </Line>
        <Circle
          cx={position.xPixels}
          cy={position.yPixels}
          r={CURRENT_MARKER_RADIUS}
          color={color}
        />
      </Group>
    </Canvas>
  );
});

function progressPercentage(progress: PreparationProgress): number | undefined {
  if (progress.phase !== "drawing" || progress.total <= 0) return undefined;
  return Math.round((progress.completed / progress.total) * 100);
}

function buildBoundedSvgFallbackPoints(samples: readonly ElevationProfileSample[]): RoutePoint[] {
  const boundedSamples = downsampleElevationExtrema(
    samples,
    Math.max(2, Math.min(MAX_SVG_FALLBACK_SAMPLES, samples.length)),
  );
  const points: RoutePoint[] = [];
  for (const sample of boundedSamples) {
    if (sample.breakBefore && points.length > 0) {
      const previous = points[points.length - 1];
      points.push({
        ...previous,
        elevationMeters: null,
        idx: points.length,
      });
    }
    points.push({
      latitude: 0,
      longitude: 0,
      elevationMeters: sample.elevationMeters,
      distanceFromStartMeters: sample.distanceMeters,
      idx: points.length,
    });
  }
  return points;
}

function PreparationState({
  width,
  height,
  progress,
  accentColor,
}: {
  width: number;
  height: number;
  progress: PreparationProgress;
  accentColor: string;
}) {
  const percentage = progressPercentage(progress);
  return (
    <View
      className="bg-surface items-center justify-center px-6"
      style={{ width, height }}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel="Preparing elevation profile"
      accessibilityValue={percentage == null ? undefined : { min: 0, max: 100, now: percentage }}
    >
      <ActivityIndicator color={accentColor} />
      <Text className="mt-3 text-sm font-barlow-medium text-foreground text-center">
        Preparing elevation profile…
      </Text>
      <Text className="mt-1 text-xs text-muted-foreground text-center">
        {progress.phase === "sampling"
          ? "Sampling route terrain"
          : `Drawing terrain ${progress.completed}/${progress.total}`}
      </Text>
    </View>
  );
}

function YAxisLabels({
  ticks,
  layout,
}: {
  ticks: readonly ElevationYTick[];
  layout: ElevationProfileLayout;
}) {
  return (
    <View style={{ width: layout.yAxisWidthPixels, height: layout.mainChartHeightPixels }}>
      {ticks.map((tick) => (
        <Text
          key={`yl-${tick.valueMeters}`}
          className={
            layout.axisStyle === "climb"
              ? "font-barlow-sc-semibold text-[10px] text-foreground"
              : "font-barlow-sc-medium text-[10px] text-muted-foreground"
          }
          style={{
            position: "absolute",
            left: layout.yAxisSide === "right" ? 4 : 2,
            top: tick.yPixels - Y_LABEL_OFFSET_Y,
          }}
        >
          {tick.label}
        </Text>
      ))}
    </View>
  );
}

function XAxisLabels({
  ticks,
  layout,
}: {
  ticks: readonly ElevationXTick[];
  layout: ElevationProfileLayout;
}) {
  const labelWidth = layout.axisStyle === "climb" ? CLIMB_X_LABEL_WIDTH : X_LABEL_WIDTH;
  return (
    <>
      {ticks.map((tick) => {
        const left =
          layout.axisStyle === "climb"
            ? Math.max(
                0,
                Math.min(layout.contentWidthPixels - labelWidth, tick.xPixels - labelWidth / 2),
              )
            : tick.xPixels - labelWidth / 2;
        return (
          <Text
            key={`xl-${tick.valueMeters}`}
            pointerEvents="none"
            className={
              layout.axisStyle === "climb"
                ? "font-barlow-sc-semibold text-[10px] text-foreground text-center"
                : "font-barlow-sc-medium text-[10px] text-muted-foreground text-center"
            }
            style={{
              position: "absolute",
              left,
              bottom: layout.axisStyle === "climb" ? 7 : 4,
              width: labelWidth,
            }}
          >
            {tick.label}
          </Text>
        );
      })}
    </>
  );
}

function SegmentLabels({
  boundaries,
  distanceOffsetMeters,
  layout,
  color,
}: {
  boundaries: ElevationProfileProps["segmentBoundaries"];
  distanceOffsetMeters: number;
  layout: ElevationProfileLayout;
  color: string;
}) {
  if (!boundaries) return null;
  return boundaries.map((boundary) => {
    const distanceMeters = boundary.distanceMeters - distanceOffsetMeters;
    if (distanceMeters <= 0 || distanceMeters >= layout.totalDistanceMeters) return null;
    const x = scaleElevationDistanceToX(
      distanceMeters,
      layout.totalDistanceMeters,
      layout.contentWidthPixels,
    );
    return (
      <Text
        key={`segment-label-${boundary.distanceMeters}-${boundary.label}`}
        pointerEvents="none"
        className="font-barlow-sc-semibold text-[10px] text-center"
        style={{
          position: "absolute",
          left: Math.max(0, Math.min(layout.contentWidthPixels - SEGMENT_LABEL_WIDTH, x - 32)),
          top: layout.plotTopPixels,
          width: SEGMENT_LABEL_WIDTH,
          color,
        }}
      >
        {boundary.label}
      </Text>
    );
  });
}

function GradeLabels({
  gradeSegments,
  samples,
  domain,
  layout,
  textColor,
}: {
  gradeSegments: readonly ElevationRenderGradeSegment[];
  samples: readonly ElevationProfileSample[];
  domain: ElevationYDomain;
  layout: ElevationProfileLayout;
  textColor: string;
}) {
  return gradeSegments.map((segment) => {
    const start = Math.max(0, Math.min(layout.totalDistanceMeters, segment.startDistanceMeters));
    const end = Math.max(start, Math.min(layout.totalDistanceMeters, segment.endDistanceMeters));
    const startX = scaleElevationDistanceToX(
      start,
      layout.totalDistanceMeters,
      layout.contentWidthPixels,
    );
    const endX = scaleElevationDistanceToX(
      end,
      layout.totalDistanceMeters,
      layout.contentWidthPixels,
    );
    const width = endX - startX;
    const label =
      layout.axisStyle === "climb"
        ? `${Math.round(segment.averageGradientPercent)}`
        : `${Math.round(segment.averageGradientPercent)}%`;
    const labelColor = segment.averageGradientPercent >= 4 ? "#FFFFFF" : textColor;

    if (layout.axisStyle === "climb") {
      if (width < 11) return null;
      return (
        <Text
          key={`grade-label-${segment.id}`}
          pointerEvents="none"
          className="font-barlow-sc-semibold text-[9.5px] text-center"
          style={{
            position: "absolute",
            left: startX,
            top: layout.axisYPixels - 13,
            width,
            color: labelColor,
          }}
        >
          {label}
        </Text>
      );
    }

    const labelDistance = start + (end - start) / 2;
    const labelTopY = scaleElevationToY(
      interpolateElevationAtDistance(samples, labelDistance),
      domain,
      layout.plotHeightPixels,
      layout.plotTopPixels,
    );
    const height = layout.axisYPixels - labelTopY;
    if (width < STANDARD_GRADE_LABEL_WIDTH || height < 18) return null;
    const labelY = Math.min(
      layout.axisYPixels - 8,
      Math.max(layout.plotTopPixels + 12, (labelTopY + layout.axisYPixels) / 2 + 4),
    );
    return (
      <Text
        key={`grade-label-${segment.id}`}
        pointerEvents="none"
        className="font-barlow-sc-semibold text-[11px] text-center"
        style={{
          position: "absolute",
          left: startX + width / 2 - STANDARD_GRADE_LABEL_WIDTH / 2,
          top: labelY - 10,
          width: STANDARD_GRADE_LABEL_WIDTH,
          color: labelColor,
        }}
      >
        {label}
      </Text>
    );
  });
}

function POIMarkers({
  markers,
  units,
  onPOIPress,
}: {
  markers: readonly ElevationPOIMarker[];
  units: ElevationProfileProps["units"];
  onPOIPress: ElevationProfileProps["onPOIPress"];
}) {
  return markers.map((marker) => {
    const Icon = POI_ICON_MAP[marker.iconName] ?? POI_ICON_MAP.MapPin;
    const markerVisual = (
      <View
        style={{
          width: POI_MARKER_RADIUS * 2,
          height: POI_MARKER_RADIUS * 2,
          borderRadius: POI_MARKER_RADIUS,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: marker.color,
        }}
      >
        <Icon color="white" size={POI_ICON_SIZE} strokeWidth={POI_ICON_STROKE_WIDTH} />
      </View>
    );
    const style = {
      position: "absolute" as const,
      left: marker.xPixels - POI_HIT_SIZE / 2,
      top: marker.yPixels - POI_HIT_SIZE / 2,
      width: POI_HIT_SIZE,
      height: POI_HIT_SIZE,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    };
    if (!onPOIPress) {
      return (
        <View key={marker.poi.id} pointerEvents="none" style={style}>
          {markerVisual}
        </View>
      );
    }

    const categoryLabel = getCategoryMeta(marker.poi.category)?.label ?? "Point of interest";
    return (
      <Pressable
        key={marker.poi.id}
        style={style}
        accessibilityRole="button"
        accessibilityLabel={`${marker.poi.name ?? categoryLabel}, ${formatDistance(
          marker.poi.effectiveDistanceMeters,
          units,
        )}`}
        onPress={() => onPOIPress(marker.poi)}
      >
        {markerVisual}
      </Pressable>
    );
  });
}

function FerryMarkers({
  ferries,
  distanceOffsetMeters,
  layout,
  ferryColor,
  surfaceColor,
}: {
  ferries: ElevationProfileProps["ferries"];
  distanceOffsetMeters: number;
  layout: ElevationProfileLayout;
  ferryColor: string;
  surfaceColor: string;
}) {
  const markers = useMemo(
    () =>
      buildElevationProfileFerryMarkers(ferries, {
        totalDistanceMeters: layout.totalDistanceMeters,
        contentWidthPixels: layout.contentWidthPixels,
        distanceOffsetMeters,
      }),
    [distanceOffsetMeters, ferries, layout.contentWidthPixels, layout.totalDistanceMeters],
  );

  return markers.map((marker) => (
    <View
      key={`ferry-${marker.id}-${marker.centerXPixels}`}
      pointerEvents="none"
      accessible
      accessibilityRole="image"
      accessibilityLabel={`${marker.name}, ferry crossing; elevation excluded`}
      style={{
        position: "absolute",
        left: marker.leftPixels,
        top: layout.plotTopPixels,
        width: marker.widthPixels,
        height: Math.max(0, layout.axisYPixels - layout.plotTopPixels),
        overflow: "visible",
        backgroundColor: surfaceColor,
        borderLeftColor: ferryColor,
        borderRightColor: ferryColor,
        borderLeftWidth: 1,
        borderRightWidth: 1,
      }}
    >
      <View
        style={[StyleSheet.absoluteFillObject, { backgroundColor: ferryColor, opacity: 0.14 }]}
      />
    </View>
  ));
}

interface ElevationContentOverlayProps {
  prepared: PreparedElevationProfile;
  segmentBoundaries: ElevationProfileProps["segmentBoundaries"];
  ferries: ElevationProfileProps["ferries"];
  distanceOffsetMeters: number;
  segmentColor: string;
  ferryColor: string;
  surfaceColor: string;
  textColor: string;
  poiMarkers: readonly ElevationPOIMarker[];
  units: ElevationProfileProps["units"];
  onPOIPress: ElevationProfileProps["onPOIPress"];
}

const ElevationContentOverlay = memo(function ElevationContentOverlay({
  prepared,
  segmentBoundaries,
  ferries,
  distanceOffsetMeters,
  segmentColor,
  ferryColor,
  surfaceColor,
  textColor,
  poiMarkers,
  units,
  onPOIPress,
}: ElevationContentOverlayProps) {
  const { layout } = prepared;
  return (
    <View style={{ width: layout.contentWidthPixels, height: layout.mainChartHeightPixels }}>
      <FerryMarkers
        ferries={ferries}
        distanceOffsetMeters={distanceOffsetMeters}
        layout={layout}
        ferryColor={ferryColor}
        surfaceColor={surfaceColor}
      />
      <XAxisLabels ticks={prepared.xTicks} layout={layout} />
      <SegmentLabels
        boundaries={segmentBoundaries}
        distanceOffsetMeters={distanceOffsetMeters}
        layout={layout}
        color={segmentColor}
      />
      <GradeLabels
        gradeSegments={prepared.gradeSegments}
        samples={prepared.samples}
        domain={prepared.domain}
        layout={layout}
        textColor={textColor}
      />
      <POIMarkers markers={poiMarkers} units={units} onPOIPress={onPOIPress} />
    </View>
  );
});

export default function ElevationProfileSkia(props: ElevationProfileProps) {
  const {
    points,
    units,
    width,
    height,
    currentPointIndex,
    currentDistanceMeters,
    showLegend = true,
    distanceOffsetMeters = 0,
    xAxisLabelOffsetMeters = distanceOffsetMeters,
    xTickIntervalMeters,
    axisStyle = "standard",
    yAxisSide = axisStyle === "climb" ? "right" : "left",
    minPixelsPerKm,
    pois = [],
    onPOIPress,
    segmentBoundaries,
    climbs,
    ferries,
    fitToWidth = false,
    showScrollOverview = true,
    gradientAreaFill = false,
    gradientAreaOpacity = 0.16,
    gradientSegments,
    lineStrokeColor,
    lineStrokeWidth = 2.5,
  } = props;
  const colors = useThemeColors();
  const [prepared, setPrepared] = useState<PreparedElevationProfile | null>(null);
  const [svgFallbackPoints, setSvgFallbackPoints] = useState<RoutePoint[] | null>(null);
  const [preparationError, setPreparationError] = useState<unknown>(null);
  const [progress, setProgress] = useState<PreparationProgress>({
    phase: "sampling",
    completed: 0,
    total: 0,
  });
  const generationRef = useRef(0);
  const scrollRef = useRef<ScrollView | null>(null);
  const scrollX = useSharedValue(0);
  const onPOIPressRef = useRef(onPOIPress);
  useEffect(() => {
    onPOIPressRef.current = onPOIPress;
  }, [onPOIPress]);
  const handlePOIPress = useCallback<NonNullable<ElevationProfileProps["onPOIPress"]>>((poi) => {
    onPOIPressRef.current?.(poi);
  }, []);

  useEffect(() => {
    const generation = ++generationRef.current;
    let cancelled = false;
    let ownedPictureSet: ElevationProfilePictureSet | null = null;
    let sampledFallback: ElevationProfileSample[] | null = null;
    const isCancelled = () => cancelled || generationRef.current !== generation;

    setPreparationError(null);
    setPrepared(null);
    setSvgFallbackPoints(null);
    setProgress({ phase: "sampling", completed: 0, total: 0 });

    void (async () => {
      try {
        await yieldToUI();
        if (isCancelled()) return;

        const model = measureSync("profile.skia.model", () => {
          const totalDistanceMeters =
            points.length > 0 ? points[points.length - 1].distanceFromStartMeters : 0;
          const layout = computeElevationProfileLayout({
            totalDistanceMeters,
            widthPixels: width,
            heightPixels: height,
            axisStyle,
            yAxisSide,
            fitToWidth,
            minPixelsPerKm,
            showScrollOverview,
            showLegend,
          });
          const samples = sampleElevationProfileForPixels(points, {
            pixelWidth: Math.max(layout.contentWidthPixels, layout.viewportWidthPixels),
            samplesPerPixel: SAMPLES_PER_PIXEL,
            maxSamples: MAX_DETAIL_SAMPLES,
            startDistanceMeters: 0,
            endDistanceMeters: layout.totalDistanceMeters,
          });
          const domain = computeElevationYDomain({
            samples,
            contentWidthPixels: layout.contentWidthPixels,
            plotHeightPixels: layout.plotHeightPixels,
            axisStyle,
          });
          const yTicks = buildElevationYTicks({
            domain,
            plotHeightPixels: layout.plotHeightPixels,
            units,
            axisStyle,
            plotTopPixels: layout.plotTopPixels,
          });
          const xTicks = buildElevationXTicks({
            totalDistanceMeters: layout.totalDistanceMeters,
            contentWidthPixels: layout.contentWidthPixels,
            units,
            axisStyle,
            isScrollable: layout.isScrollable,
            xTickIntervalMeters,
            xAxisLabelOffsetMeters,
          });
          const gradeSegments = buildElevationRenderGradeSegments(
            axisStyle,
            samples,
            layout.totalDistanceMeters,
            xTickIntervalMeters,
            gradientSegments,
          );
          const overviewSamples = layout.overviewShown
            ? downsampleElevationExtrema(
                samples,
                Math.max(2, Math.min(OVERVIEW_MAX_SAMPLES, samples.length)),
              )
            : [];
          return { samples, overviewSamples, layout, domain, yTicks, xTicks, gradeSegments };
        });
        sampledFallback = model.samples;

        if (isCancelled()) return;
        setProgress({ phase: "drawing", completed: 0, total: 0 });
        const pictureSet = await measureAsync("profile.skia.pictures", () =>
          prepareElevationProfilePictures({
            ...model,
            colors,
            distanceOffsetMeters,
            climbs,
            segmentBoundaries,
            gradientAreaFill,
            gradientAreaOpacity: Math.max(0, Math.min(1, gradientAreaOpacity)),
            lineStrokeColor,
            lineStrokeWidth,
            isCancelled,
            onProgress: (completed, total) => {
              if (!isCancelled()) setProgress({ phase: "drawing", completed, total });
            },
          }),
        );
        if (!pictureSet) return;
        ownedPictureSet = pictureSet;
        if (isCancelled()) {
          pictureSet.dispose();
          ownedPictureSet = null;
          return;
        }
        setPrepared({ ...model, pictureSet });
      } catch (error) {
        if (isCancelled()) return;
        console.warn("Skia elevation profile preparation failed; using SVG fallback.", error);
        try {
          const fallbackSamples =
            sampledFallback ??
            sampleElevationProfileForPixels(points, {
              pixelWidth: Math.max(1, width),
              samplesPerPixel: 1,
              maxSamples: MAX_SVG_FALLBACK_SAMPLES,
            });
          setSvgFallbackPoints(buildBoundedSvgFallbackPoints(fallbackSamples));
        } catch (fallbackError) {
          console.warn("Bounded SVG elevation fallback preparation also failed.", fallbackError);
          setSvgFallbackPoints([]);
        }
        setPreparationError(error);
      }
    })();

    return () => {
      cancelled = true;
      ownedPictureSet?.dispose();
      ownedPictureSet = null;
    };
  }, [
    axisStyle,
    climbs,
    colors,
    distanceOffsetMeters,
    fitToWidth,
    gradientAreaFill,
    gradientAreaOpacity,
    gradientSegments,
    height,
    lineStrokeColor,
    lineStrokeWidth,
    minPixelsPerKm,
    points,
    segmentBoundaries,
    showLegend,
    showScrollOverview,
    units,
    width,
    xAxisLabelOffsetMeters,
    xTickIntervalMeters,
    yAxisSide,
  ]);

  const currentPosition = useMemo(() => {
    if (!prepared) return null;
    return resolveElevationCurrentPosition({
      samples: prepared.samples,
      points,
      totalDistanceMeters: prepared.layout.totalDistanceMeters,
      contentWidthPixels: prepared.layout.contentWidthPixels,
      plotHeightPixels: prepared.layout.plotHeightPixels,
      domain: prepared.domain,
      currentDistanceMeters,
      currentPointIndex,
      plotTopPixels: prepared.layout.plotTopPixels,
    });
  }, [currentDistanceMeters, currentPointIndex, points, prepared]);

  const poiMarkers = useMemo(() => {
    if (!prepared) return [];
    return buildElevationPOIMarkers({
      pois,
      samples: prepared.samples,
      totalDistanceMeters: prepared.layout.totalDistanceMeters,
      contentWidthPixels: prepared.layout.contentWidthPixels,
      plotHeightPixels: prepared.layout.plotHeightPixels,
      domain: prepared.domain,
      distanceOffsetMeters,
      plotTopPixels: prepared.layout.plotTopPixels,
    });
  }, [distanceOffsetMeters, pois, prepared]);

  const onScroll = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollX.value = event.contentOffset.x;
    },
  });

  const autoScrolledPictureSetRef = useRef<ElevationProfilePictureSet | null>(null);
  useEffect(() => {
    if (!prepared || autoScrolledPictureSetRef.current === prepared.pictureSet) return;
    autoScrolledPictureSetRef.current = prepared.pictureSet;
    const target =
      prepared.layout.isScrollable && currentPosition
        ? Math.max(
            0,
            Math.min(
              prepared.layout.contentWidthPixels - prepared.layout.viewportWidthPixels,
              currentPosition.xPixels - prepared.layout.viewportWidthPixels / 2,
            ),
          )
        : 0;
    const frame = requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ x: target, animated: false });
      scrollX.value = target;
    });
    return () => cancelAnimationFrame(frame);
  }, [currentPosition, prepared, scrollX]);

  if (points.length === 0) {
    return (
      <View className="bg-surface" style={{ width, height }}>
        <Text className="text-center text-muted-foreground mt-10">No elevation data</Text>
      </View>
    );
  }

  if (preparationError) {
    const fallbackCurrentDistanceMeters =
      currentDistanceMeters ??
      (currentPointIndex != null && currentPointIndex >= 0 && currentPointIndex < points.length
        ? points[currentPointIndex].distanceFromStartMeters
        : undefined);
    return (
      <ElevationProfileSvg
        {...props}
        points={svgFallbackPoints ?? []}
        detailSampleLimit={MAX_SVG_FALLBACK_SAMPLES}
        currentPointIndex={undefined}
        currentDistanceMeters={fallbackCurrentDistanceMeters}
        fitToWidth
        showScrollOverview={false}
        pois={[]}
        onPOIPress={undefined}
        segmentBoundaries={undefined}
        climbs={undefined}
        gradientAreaFill={false}
        gradientSegments={undefined}
      />
    );
  }
  if (!prepared) {
    return (
      <PreparationState
        width={width}
        height={height}
        progress={progress}
        accentColor={colors.accent}
      />
    );
  }

  const { layout } = prepared;
  const contentOverlay = (
    <ElevationContentOverlay
      prepared={prepared}
      segmentBoundaries={segmentBoundaries}
      ferries={ferries}
      distanceOffsetMeters={distanceOffsetMeters}
      segmentColor={colors.info}
      ferryColor={colors.info}
      surfaceColor={colors.surface}
      textColor={colors.textPrimary}
      poiMarkers={poiMarkers}
      units={units}
      onPOIPress={onPOIPress ? handlePOIPress : undefined}
    />
  );

  const chartPane = (
    <View
      style={{
        position: "relative",
        width: layout.viewportWidthPixels,
        height: layout.mainChartHeightPixels,
        overflow: "hidden",
      }}
    >
      <StaticElevationCanvas
        pictureSet={prepared.pictureSet}
        viewportWidthPixels={layout.viewportWidthPixels}
        heightPixels={layout.mainChartHeightPixels}
        scrollX={scrollX}
      />
      {layout.isScrollable ? (
        <Animated.ScrollView
          ref={scrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          scrollEventThrottle={16}
          onScroll={onScroll}
          bounces={false}
          overScrollMode="never"
          style={StyleSheet.absoluteFill}
        >
          {contentOverlay}
        </Animated.ScrollView>
      ) : (
        <View style={StyleSheet.absoluteFill}>{contentOverlay}</View>
      )}
      {currentPosition && (
        <CurrentMarkerCanvas
          position={currentPosition}
          layout={layout}
          color={colors.accent}
          scrollX={scrollX}
        />
      )}
    </View>
  );

  return (
    <View className="bg-surface" style={{ width, height }}>
      {layout.overviewShown && (
        <ElevationProfileOverview
          samples={prepared.overviewSamples}
          width={width}
          totalMeters={layout.totalDistanceMeters}
          contentWidth={layout.contentWidthPixels}
          viewportWidth={layout.viewportWidthPixels}
          currentDistanceMeters={currentPosition?.distanceMeters}
          ferries={ferries}
          distanceOffsetMeters={distanceOffsetMeters}
          xAxisLabelOffsetMeters={xAxisLabelOffsetMeters}
          units={units}
          scrollRef={scrollRef}
          scrollX={scrollX}
        />
      )}

      <View style={{ flexDirection: "row", height: layout.mainChartHeightPixels }}>
        {layout.yAxisSide === "left" && <YAxisLabels ticks={prepared.yTicks} layout={layout} />}
        {chartPane}
        {layout.yAxisSide === "right" && <YAxisLabels ticks={prepared.yTicks} layout={layout} />}
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
