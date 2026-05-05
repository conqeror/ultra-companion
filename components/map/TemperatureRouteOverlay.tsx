import React, { useMemo } from "react";
import { ShapeSource, LineLayer, SymbolLayer } from "@rnmapbox/maps";
import { useThemeColors } from "@/theme";
import { displayTemperatureC, temperatureGradientColor } from "@/utils/temperatureOverlay";
import type { RoutePoint, WeatherPoint, WeatherTemperatureDisplayMode } from "@/types";

const MIN_LABEL_DISTANCE_M = 15_000;
const MIN_LABEL_TEMP_CHANGE_C = 3;
const MAX_LABELS = 6;
const LINE_GRADIENT_PROGRESS_EPSILON = 0.0001;

function buildTemperatureLineGradientStops(
  samples: WeatherPoint[],
  startDist: number,
  endDist: number,
  temperatureMode: WeatherTemperatureDisplayMode,
): (number | string)[] {
  const distanceRange = endDist - startDist;
  if (distanceRange <= 0) return [];

  const rawStops = samples
    .map((sample) => ({
      progress: Math.max(0, Math.min(1, (sample.routeDistanceMeters - startDist) / distanceRange)),
      color: temperatureGradientColor(displayTemperatureC(sample, temperatureMode)),
    }))
    .filter((stop) => Number.isFinite(stop.progress))
    .sort((a, b) => a.progress - b.progress);

  const deduped: typeof rawStops = [];
  for (const stop of rawStops) {
    const previous = deduped[deduped.length - 1];
    if (previous && Math.abs(previous.progress - stop.progress) < LINE_GRADIENT_PROGRESS_EPSILON) {
      previous.color = stop.color;
      continue;
    }
    deduped.push(stop);
  }

  if (deduped[0]?.progress !== 0) {
    deduped.unshift({
      progress: 0,
      color: temperatureGradientColor(displayTemperatureC(samples[0], temperatureMode)),
    });
  }
  if (deduped[deduped.length - 1]?.progress !== 1) {
    deduped.push({
      progress: 1,
      color: temperatureGradientColor(
        displayTemperatureC(samples[samples.length - 1], temperatureMode),
      ),
    });
  }

  return deduped.flatMap((stop) => [stop.progress, stop.color]);
}

interface TemperatureRouteOverlayProps {
  points: RoutePoint[];
  timeline: WeatherPoint[];
  temperatureMode: WeatherTemperatureDisplayMode;
}

export default function TemperatureRouteOverlay({
  points,
  timeline,
  temperatureMode,
}: TemperatureRouteOverlayProps) {
  const colors = useThemeColors();

  const { geoJSON, labelGeoJSON, gradientExpr } = useMemo(() => {
    if (points.length < 2 || timeline.length < 2) {
      return { geoJSON: null, labelGeoJSON: null, gradientExpr: null };
    }
    const sorted = timeline
      .filter((point) => point.phase === "route" && Number.isFinite(point.routeDistanceMeters))
      .slice()
      .sort((a, b) => a.routeDistanceMeters - b.routeDistanceMeters);
    if (sorted.length < 2) return { geoJSON: null, labelGeoJSON: null, gradientExpr: null };

    const startDist = sorted[0].routeDistanceMeters;
    const endDist = sorted[sorted.length - 1].routeDistanceMeters;
    const overlayPoints = points.filter(
      (point) =>
        point.distanceFromStartMeters >= startDist && point.distanceFromStartMeters <= endDist,
    );
    if (overlayPoints.length < 2 || endDist <= startDist) {
      return { geoJSON: null, labelGeoJSON: null, gradientExpr: null };
    }

    const lineGeoJSON: GeoJSON.Feature<GeoJSON.LineString> = {
      type: "Feature",
      properties: {},
      geometry: {
        type: "LineString",
        coordinates: overlayPoints.map((point) => [point.longitude, point.latitude]),
      },
    };

    const stops = buildTemperatureLineGradientStops(sorted, startDist, endDist, temperatureMode);
    if (stops.length < 4) return { geoJSON: null, labelGeoJSON: null, gradientExpr: null };

    const labelCandidates: WeatherPoint[] = [sorted[0]];
    let lastLabel = sorted[0];
    for (let index = 1; index < sorted.length - 1; index++) {
      const sample = sorted[index];
      const distanceDelta = sample.routeDistanceMeters - lastLabel.routeDistanceMeters;
      const tempDelta = Math.abs(
        displayTemperatureC(sample, temperatureMode) -
          displayTemperatureC(lastLabel, temperatureMode),
      );
      if (distanceDelta >= MIN_LABEL_DISTANCE_M && tempDelta >= MIN_LABEL_TEMP_CHANGE_C) {
        labelCandidates.push(sample);
        lastLabel = sample;
        if (labelCandidates.length >= MAX_LABELS - 1) break;
      }
    }
    const finalSample = sorted[sorted.length - 1];
    if (finalSample.routeDistanceMeters - lastLabel.routeDistanceMeters >= MIN_LABEL_DISTANCE_M) {
      labelCandidates.push(finalSample);
    }

    const labelFeatureCollection: GeoJSON.FeatureCollection<GeoJSON.Point> = {
      type: "FeatureCollection",
      features: labelCandidates.slice(0, MAX_LABELS).map((sample) => {
        const displayTempC = displayTemperatureC(sample, temperatureMode);
        return {
          type: "Feature",
          properties: {
            label: `${Math.round(displayTempC)}°`,
            temperatureC: displayTempC,
          },
          geometry: {
            type: "Point",
            coordinates: [sample.longitude, sample.latitude],
          },
        };
      }),
    };

    return {
      geoJSON: lineGeoJSON,
      labelGeoJSON: labelFeatureCollection,
      gradientExpr: ["interpolate", ["linear"], ["line-progress"], ...stops],
    };
  }, [points, timeline, temperatureMode]);

  if (!geoJSON || !gradientExpr) return null;

  return (
    <>
      <ShapeSource id="weather-temperature-route-source" shape={geoJSON} lineMetrics>
        <LineLayer
          id="weather-temperature-route-outline"
          style={{
            lineColor: colors.surface,
            lineWidth: ["interpolate", ["linear"], ["zoom"], 8, 6, 13, 10],
            lineOpacity: 0.9,
            lineCap: "round",
            lineJoin: "round",
          }}
        />
        <LineLayer
          id="weather-temperature-route-line"
          aboveLayerID="weather-temperature-route-outline"
          style={{
            lineGradient: gradientExpr as any,
            lineWidth: ["interpolate", ["linear"], ["zoom"], 8, 4, 13, 7],
            lineOpacity: 1,
            lineCap: "round",
            lineJoin: "round",
          }}
        />
      </ShapeSource>
      {labelGeoJSON && labelGeoJSON.features.length > 1 && (
        <ShapeSource id="weather-temperature-label-source" shape={labelGeoJSON}>
          <SymbolLayer
            id="weather-temperature-labels"
            style={{
              textField: ["get", "label"],
              textSize: ["interpolate", ["linear"], ["zoom"], 9, 0, 10, 11, 14, 13],
              textOpacity: ["interpolate", ["linear"], ["zoom"], 9, 0, 10, 1],
              textColor: colors.textPrimary,
              textHaloColor: colors.surface,
              textHaloWidth: 2,
              textAllowOverlap: false,
              textIgnorePlacement: false,
              textOffset: [0, -1.15],
            }}
          />
        </ShapeSource>
      )}
    </>
  );
}
