/* oxlint-disable react/style-prop-object -- Skia's Path style is a paint enum, not a React Native style object. */
import React from "react";
import {
  DashPathEffect,
  Group,
  Line,
  LinearGradient,
  Path,
  Skia,
  drawAsPicture,
  rect,
  vec,
  type SkColor,
  type SkPicture,
} from "@shopify/react-native-skia";

import { climbDifficultyColor } from "@/constants/climbHelpers";
import type { ThemeColors } from "@/theme";
import { gradientColor } from "@/theme";
import type { DisplayClimb } from "@/types";
import { buildClimbTickBoundaries, type ClimbProfileSegment } from "@/utils/climbProfile";
import type { CollectionSegmentProfileBoundary } from "@/utils/collectionSegmentDisplay";
import {
  buildElevationTileDescriptors,
  scaleElevationDistanceToX,
  scaleElevationToY,
  type ElevationProfileLayout,
  type ElevationYDomain,
  type ElevationYTick,
  type ElevationXTick,
} from "@/utils/elevationProfileModel";
import {
  interpolateElevationAtDistance,
  sliceElevationSamples,
  splitElevationProfileSamplesAtBreaks,
  type ElevationProfileSample,
} from "@/utils/elevationProfileSampling";
import { yieldToUI } from "@/utils/yieldToUI";

const MAX_GRADIENT_STOPS_PER_TILE = 64;
const GRADIENT_SAMPLE_WINDOW_PIXELS = 12;
const X_TICK_HEIGHT = 8;

type ElevationThemeColors = { readonly [Key in keyof ThemeColors]: string };

export interface ElevationRenderGradeSegment {
  id: string;
  startDistanceMeters: number;
  endDistanceMeters: number;
  averageGradientPercent: number;
}

export interface ElevationPictureTile {
  index: number;
  xPixels: number;
  widthPixels: number;
  picture: SkPicture;
}

export interface ElevationProfilePictureSet {
  readonly tiles: readonly ElevationPictureTile[];
  dispose(): void;
}

interface PrepareElevationPicturesOptions {
  samples: readonly ElevationProfileSample[];
  layout: ElevationProfileLayout;
  domain: ElevationYDomain;
  yTicks: readonly ElevationYTick[];
  xTicks: readonly ElevationXTick[];
  colors: ElevationThemeColors;
  distanceOffsetMeters: number;
  climbs?: readonly DisplayClimb[];
  segmentBoundaries?: readonly CollectionSegmentProfileBoundary[];
  gradeSegments: readonly ElevationRenderGradeSegment[];
  gradientAreaFill: boolean;
  gradientAreaOpacity: number;
  lineStrokeColor?: string;
  lineStrokeWidth: number;
  isCancelled: () => boolean;
  onProgress: (completed: number, total: number) => void;
}

interface ProfilePaths {
  linePath: string;
  fillPath: string;
}

interface GradientStops {
  colors: string[];
  positions: number[];
}

interface TileBoundary {
  id: string;
  xPixels: number;
}

function colorWithOpacity(color: string, opacity: number): SkColor {
  const parsed = Skia.Color(color);
  parsed[3] = Math.max(0, Math.min(1, opacity));
  return parsed;
}

function buildPaths(
  samples: readonly ElevationProfileSample[],
  tileXPixels: number,
  layout: ElevationProfileLayout,
  domain: ElevationYDomain,
): ProfilePaths {
  let linePath = "";
  let fillPath = "";
  for (const segment of splitElevationProfileSamplesAtBreaks(samples)) {
    let segmentLinePath = "";
    let firstX = 0;
    let lastX = 0;
    for (let index = 0; index < segment.length; index++) {
      const sample = segment[index];
      const x =
        scaleElevationDistanceToX(
          sample.distanceMeters,
          layout.totalDistanceMeters,
          layout.contentWidthPixels,
        ) - tileXPixels;
      const y = scaleElevationToY(
        sample.elevationMeters,
        domain,
        layout.plotHeightPixels,
        layout.plotTopPixels,
      );
      if (index === 0) firstX = x;
      lastX = x;
      segmentLinePath += index === 0 ? `M${x},${y}` : ` L${x},${y}`;
    }
    if (!segmentLinePath) continue;
    linePath += `${linePath ? " " : ""}${segmentLinePath}`;
    fillPath += `${fillPath ? " " : ""}${segmentLinePath} L${lastX},${
      layout.axisYPixels
    } L${firstX},${layout.axisYPixels} Z`;
  }

  return { linePath, fillPath };
}

function buildGradientStops(
  samples: readonly ElevationProfileSample[],
  tileXPixels: number,
  tileWidthPixels: number,
  layout: ElevationProfileLayout,
): GradientStops {
  if (samples.length < 2 || tileWidthPixels <= 0) {
    const color = gradientColor(0);
    return { colors: [color, color], positions: [0, 1] };
  }

  const segmentCount = Math.max(
    1,
    Math.min(
      MAX_GRADIENT_STOPS_PER_TILE - 1,
      Math.ceil(tileWidthPixels / GRADIENT_SAMPLE_WINDOW_PIXELS),
    ),
  );
  const metersPerPixel = layout.totalDistanceMeters / Math.max(1, layout.contentWidthPixels);
  const halfWindowMeters = Math.max(
    metersPerPixel,
    (metersPerPixel * GRADIENT_SAMPLE_WINDOW_PIXELS) / 2,
  );
  const colors: string[] = [];
  const positions: number[] = [];
  for (let index = 0; index <= segmentCount; index++) {
    const position = index / segmentCount;
    const globalX = tileXPixels + position * tileWidthPixels;
    const centerDistanceMeters = Math.max(
      0,
      Math.min(
        layout.totalDistanceMeters,
        (globalX / Math.max(1, layout.contentWidthPixels)) * layout.totalDistanceMeters,
      ),
    );
    const startDistanceMeters = Math.max(0, centerDistanceMeters - halfWindowMeters);
    const endDistanceMeters = Math.min(
      layout.totalDistanceMeters,
      centerDistanceMeters + halfWindowMeters,
    );
    const distance = endDistanceMeters - startDistanceMeters;
    const gradient =
      distance > 0
        ? ((interpolateElevationAtDistance(samples, endDistanceMeters) -
            interpolateElevationAtDistance(samples, startDistanceMeters)) /
            distance) *
          100
        : 0;
    colors.push(gradientColor(gradient));
    positions.push(position);
  }
  return { colors, positions };
}

function buildAreaPath(
  samples: readonly ElevationProfileSample[],
  startDistanceMeters: number,
  endDistanceMeters: number,
  tileXPixels: number,
  layout: ElevationProfileLayout,
  domain: ElevationYDomain,
): string {
  const visibleSamples = sliceElevationSamples(samples, startDistanceMeters, endDistanceMeters);
  return buildPaths(visibleSamples, tileXPixels, layout, domain).fillPath;
}

function localBoundaryLines(
  boundaries: readonly CollectionSegmentProfileBoundary[] | undefined,
  distanceOffsetMeters: number,
  tileStartDistanceMeters: number,
  tileEndDistanceMeters: number,
  tileXPixels: number,
  layout: ElevationProfileLayout,
): TileBoundary[] {
  if (!boundaries) return [];
  const result: TileBoundary[] = [];
  for (const boundary of boundaries) {
    const distanceMeters = boundary.distanceMeters - distanceOffsetMeters;
    if (
      distanceMeters <= 0 ||
      distanceMeters >= layout.totalDistanceMeters ||
      distanceMeters < tileStartDistanceMeters ||
      distanceMeters > tileEndDistanceMeters
    ) {
      continue;
    }
    result.push({
      id: `${boundary.distanceMeters}-${boundary.label}`,
      xPixels:
        scaleElevationDistanceToX(
          distanceMeters,
          layout.totalDistanceMeters,
          layout.contentWidthPixels,
        ) - tileXPixels,
    });
  }
  return result;
}

function buildClimbAreas(
  climbs: readonly DisplayClimb[] | undefined,
  samples: readonly ElevationProfileSample[],
  distanceOffsetMeters: number,
  tileStartDistanceMeters: number,
  tileEndDistanceMeters: number,
  tileXPixels: number,
  layout: ElevationProfileLayout,
  domain: ElevationYDomain,
) {
  if (!climbs) return [];
  return climbs.flatMap((climb) => {
    const startDistanceMeters = Math.max(
      tileStartDistanceMeters,
      climb.effectiveStartDistanceMeters - distanceOffsetMeters,
      0,
    );
    const endDistanceMeters = Math.min(
      tileEndDistanceMeters,
      climb.effectiveEndDistanceMeters - distanceOffsetMeters,
      layout.totalDistanceMeters,
    );
    if (startDistanceMeters >= endDistanceMeters) return [];
    return [
      {
        id: climb.id,
        color: climbDifficultyColor(climb.difficultyScore),
        path: buildAreaPath(
          samples,
          startDistanceMeters,
          endDistanceMeters,
          tileXPixels,
          layout,
          domain,
        ),
      },
    ];
  });
}

function buildGradeAreas(
  gradeSegments: readonly ElevationRenderGradeSegment[],
  samples: readonly ElevationProfileSample[],
  tileStartDistanceMeters: number,
  tileEndDistanceMeters: number,
  tileXPixels: number,
  layout: ElevationProfileLayout,
  domain: ElevationYDomain,
) {
  return gradeSegments.flatMap((segment) => {
    const startDistanceMeters = Math.max(tileStartDistanceMeters, segment.startDistanceMeters, 0);
    const endDistanceMeters = Math.min(
      tileEndDistanceMeters,
      segment.endDistanceMeters,
      layout.totalDistanceMeters,
    );
    if (startDistanceMeters >= endDistanceMeters) return [];
    return [
      {
        id: segment.id,
        color: gradientColor(segment.averageGradientPercent),
        path: buildAreaPath(
          samples,
          startDistanceMeters,
          endDistanceMeters,
          tileXPixels,
          layout,
          domain,
        ),
      },
    ];
  });
}

async function recordTile(
  descriptor: ReturnType<typeof buildElevationTileDescriptors>[number],
  options: PrepareElevationPicturesOptions,
): Promise<SkPicture> {
  const tileSamples = sliceElevationSamples(
    options.samples,
    descriptor.startDistanceMeters,
    descriptor.endDistanceMeters,
  );
  const paths = buildPaths(tileSamples, descriptor.xPixels, options.layout, options.domain);
  const gradientStops = buildGradientStops(
    options.samples,
    descriptor.xPixels,
    descriptor.widthPixels,
    options.layout,
  );
  const climbAreas = buildClimbAreas(
    options.climbs,
    options.samples,
    options.distanceOffsetMeters,
    descriptor.startDistanceMeters,
    descriptor.endDistanceMeters,
    descriptor.xPixels,
    options.layout,
    options.domain,
  );
  const gradeAreas = buildGradeAreas(
    options.gradeSegments,
    options.samples,
    descriptor.startDistanceMeters,
    descriptor.endDistanceMeters,
    descriptor.xPixels,
    options.layout,
    options.domain,
  );
  const boundaries = localBoundaryLines(
    options.segmentBoundaries,
    options.distanceOffsetMeters,
    descriptor.startDistanceMeters,
    descriptor.endDistanceMeters,
    descriptor.xPixels,
    options.layout,
  );
  const bounds = rect(0, 0, descriptor.widthPixels, options.layout.mainChartHeightPixels);
  const lastTile =
    descriptor.xPixels + descriptor.widthPixels >= options.layout.contentWidthPixels - 0.5;

  return drawAsPicture(
    <Group clip={bounds}>
      {options.yTicks.map((tick) => (
        <Line
          key={`grid-${tick.valueMeters}`}
          p1={vec(0, tick.yPixels)}
          p2={vec(descriptor.widthPixels, tick.yPixels)}
          color={options.colors.border}
          strokeWidth={0.5}
        />
      ))}

      <Path path={paths.fillPath} style="fill">
        <LinearGradient
          start={vec(0, options.layout.plotTopPixels)}
          end={vec(0, options.layout.axisYPixels)}
          colors={[
            colorWithOpacity(options.colors.textTertiary, 0.15),
            colorWithOpacity(options.colors.textTertiary, 0.03),
          ]}
          positions={[0, 1]}
        />
      </Path>

      {options.gradientAreaFill && (
        <Path path={paths.fillPath} style="fill" opacity={options.gradientAreaOpacity}>
          <LinearGradient
            start={vec(0, 0)}
            end={vec(descriptor.widthPixels, 0)}
            colors={gradientStops.colors}
            positions={gradientStops.positions}
          />
        </Path>
      )}

      {climbAreas.map((area) => (
        <Path key={`climb-${area.id}`} path={area.path} color={area.color} opacity={0.2} />
      ))}

      {gradeAreas.map((area) => (
        <Path key={`grade-${area.id}`} path={area.path} color={area.color} opacity={0.92} />
      ))}

      {options.layout.axisStyle === "climb" && (
        <>
          <Line
            p1={vec(0, options.layout.axisYPixels)}
            p2={vec(descriptor.widthPixels, options.layout.axisYPixels)}
            color={options.colors.textPrimary}
            strokeWidth={1.5}
          />
          {options.xTicks
            .filter(
              (tick) =>
                tick.xPixels >= descriptor.xPixels &&
                tick.xPixels <= descriptor.xPixels + descriptor.widthPixels,
            )
            .map((tick) => {
              const x = tick.xPixels - descriptor.xPixels;
              return (
                <Line
                  key={`x-tick-${tick.valueMeters}`}
                  p1={vec(x, options.layout.axisYPixels)}
                  p2={vec(
                    x,
                    Math.min(
                      options.layout.mainChartHeightPixels,
                      options.layout.axisYPixels + X_TICK_HEIGHT,
                    ),
                  )}
                  color={options.colors.textPrimary}
                  strokeWidth={1.5}
                />
              );
            })}
          {lastTile && (
            <>
              <Line
                p1={vec(descriptor.widthPixels, options.layout.plotTopPixels)}
                p2={vec(descriptor.widthPixels, options.layout.axisYPixels)}
                color={options.colors.textPrimary}
                strokeWidth={1.5}
              />
              {options.yTicks.map((tick) => (
                <Line
                  key={`y-tick-${tick.valueMeters}`}
                  p1={vec(Math.max(0, descriptor.widthPixels - X_TICK_HEIGHT), tick.yPixels)}
                  p2={vec(descriptor.widthPixels, tick.yPixels)}
                  color={options.colors.textPrimary}
                  strokeWidth={1.5}
                />
              ))}
            </>
          )}
        </>
      )}

      <Path
        path={paths.linePath}
        style="stroke"
        color={options.lineStrokeColor}
        strokeWidth={options.lineStrokeWidth}
        strokeJoin="round"
      >
        {!options.lineStrokeColor && (
          <LinearGradient
            start={vec(0, 0)}
            end={vec(descriptor.widthPixels, 0)}
            colors={gradientStops.colors}
            positions={gradientStops.positions}
          />
        )}
      </Path>

      {boundaries.map((boundary) => (
        <Line
          key={`boundary-${boundary.id}`}
          p1={vec(boundary.xPixels, options.layout.plotTopPixels)}
          p2={vec(boundary.xPixels, options.layout.axisYPixels)}
          color={options.colors.info}
          opacity={0.78}
          strokeWidth={1.4}
        >
          <DashPathEffect intervals={[4, 3]} />
        </Line>
      ))}
    </Group>,
    bounds,
  );
}

export function buildElevationRenderGradeSegments(
  axisStyle: ElevationProfileLayout["axisStyle"],
  samples: readonly ElevationProfileSample[],
  totalDistanceMeters: number,
  xTickIntervalMeters: number | undefined,
  gradientSegments: readonly ClimbProfileSegment[] | undefined,
): ElevationRenderGradeSegment[] {
  if (totalDistanceMeters <= 0 || samples.length === 0) return [];
  if (axisStyle !== "climb") {
    return (gradientSegments ?? []).map((segment, index) => ({
      id: `${index}-${segment.startDistanceMeters}-${segment.endDistanceMeters}`,
      startDistanceMeters: segment.startDistanceMeters,
      endDistanceMeters: segment.endDistanceMeters,
      averageGradientPercent: segment.averageGradientPercent,
    }));
  }

  const boundaries = buildClimbTickBoundaries(totalDistanceMeters, xTickIntervalMeters);
  return boundaries.slice(1).map((endDistanceMeters, index) => {
    const startDistanceMeters = boundaries[index];
    const startElevation = interpolateElevationAtDistance(samples, startDistanceMeters);
    const endElevation = interpolateElevationAtDistance(samples, endDistanceMeters);
    return {
      id: `${index}-${startDistanceMeters}-${endDistanceMeters}`,
      startDistanceMeters,
      endDistanceMeters,
      averageGradientPercent:
        endDistanceMeters > startDistanceMeters
          ? ((endElevation - startElevation) / (endDistanceMeters - startDistanceMeters)) * 100
          : 0,
    };
  });
}

export async function prepareElevationProfilePictures(
  options: PrepareElevationPicturesOptions,
): Promise<ElevationProfilePictureSet | null> {
  const descriptors = buildElevationTileDescriptors({
    contentWidthPixels: options.layout.contentWidthPixels,
    viewportWidthPixels: options.layout.contentWidthPixels,
    scrollOffsetPixels: 0,
    contentStartDistanceMeters: 0,
    contentEndDistanceMeters: options.layout.totalDistanceMeters,
    samples: options.samples,
  });
  const tiles: ElevationPictureTile[] = [];
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const tile of tiles.splice(0)) tile.picture.dispose();
  };

  try {
    options.onProgress(0, descriptors.length);
    for (let index = 0; index < descriptors.length; index++) {
      await yieldToUI();
      if (options.isCancelled()) {
        dispose();
        return null;
      }
      const descriptor = descriptors[index];
      const picture = await recordTile(descriptor, options);
      if (options.isCancelled()) {
        picture.dispose();
        dispose();
        return null;
      }
      tiles.push({
        index: descriptor.index,
        xPixels: descriptor.xPixels,
        widthPixels: descriptor.widthPixels,
        picture,
      });
      options.onProgress(index + 1, descriptors.length);
    }

    return { tiles, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}
