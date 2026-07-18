import React, { useMemo } from "react";
import { CircleLayer, ShapeSource, SymbolLayer } from "@rnmapbox/maps";
import {
  buildRouteMarkerFeatureCollection,
  DISTANCE_MARKER_BUCKETS,
  type DistanceMarkerDistanceRange,
  type DistanceMarkerInterval,
} from "@/utils/routeMarkers";
import { useThemeColors } from "@/theme";
import { routeDistanceMarkerLayerId } from "@/constants/mapLayers";
import type { DistanceMarkerMode, RoutePoint } from "@/types";

interface RouteMarkerLayerProps {
  points: RoutePoint[];
  distanceMarkerMode: DistanceMarkerMode;
  markerIntervalKm?: DistanceMarkerInterval;
  markerDistanceRange?: DistanceMarkerDistanceRange | null;
  etaLabelForDistanceMeters?: (distanceMeters: number) => string | null;
  etaLabelVersion?: string | number | null;
  excludedDistanceSpans?: readonly {
    startDistanceMeters: number;
    endDistanceMeters: number;
  }[];
  aboveLayerID?: string;
  hiddenDistanceRange?: {
    startDistanceMeters: number;
    endDistanceMeters: number;
  } | null;
}

const KIND_FIELD = ["get", "kind"] as const;
const DISTANCE_KM_FIELD = ["get", "distanceKm"] as const;
const IS_OVERVIEW_MARKER_FIELD = ["get", "isOverviewMarker"] as const;
const SORT_KEY_FIELD = ["get", "sortKey"] as const;

const START_FILTER = ["==", KIND_FIELD, "start"] as const;
const FINISH_FILTER = ["==", KIND_FIELD, "finish"] as const;
const ENDPOINT_FILTER = ["any", START_FILTER, FINISH_FILTER] as const;
const DISTANCE_FILTER = ["==", KIND_FIELD, "distance"] as const;

function distanceBucketFilter(
  intervalKm: number,
  hiddenDistanceRange?: RouteMarkerLayerProps["hiddenDistanceRange"],
) {
  const intervalFilter = ["==", ["%", DISTANCE_KM_FIELD, intervalKm], 0] as const;

  const visibleRangeFilter =
    hiddenDistanceRange == null
      ? null
      : ([
          "any",
          ["<", ["get", "distanceMeters"], hiddenDistanceRange.startDistanceMeters],
          [">", ["get", "distanceMeters"], hiddenDistanceRange.endDistanceMeters],
        ] as const);

  const withHiddenRange = <T extends readonly unknown[]>(filter: T) =>
    visibleRangeFilter == null ? filter : (["all", filter, visibleRangeFilter] as const);

  if (intervalKm === 100) {
    return withHiddenRange([
      "all",
      DISTANCE_FILTER,
      ["any", intervalFilter, ["==", IS_OVERVIEW_MARKER_FIELD, true]],
    ] as const);
  }

  return withHiddenRange(["all", DISTANCE_FILTER, intervalFilter] as const);
}

export default function RouteMarkerLayer({
  points,
  distanceMarkerMode,
  markerIntervalKm,
  markerDistanceRange,
  etaLabelForDistanceMeters,
  etaLabelVersion,
  excludedDistanceSpans,
  aboveLayerID,
  hiddenDistanceRange,
}: RouteMarkerLayerProps) {
  const colors = useThemeColors();
  const showDistanceMarkers = distanceMarkerMode !== "off";

  const shape = useMemo(() => {
    void etaLabelVersion;
    return buildRouteMarkerFeatureCollection({
      points,
      distanceMarkerMode,
      markerIntervalKm,
      markerDistanceRange,
      etaLabelForDistanceMeters,
      excludedDistanceSpans,
    });
  }, [
    points,
    distanceMarkerMode,
    markerIntervalKm,
    markerDistanceRange,
    etaLabelForDistanceMeters,
    etaLabelVersion,
    excludedDistanceSpans,
  ]);

  const layers = useMemo(() => {
    let previousLayerID = aboveLayerID;
    const distanceLayers = DISTANCE_MARKER_BUCKETS.map((bucket) => {
      const layerID = routeDistanceMarkerLayerId(bucket.intervalKm);
      const layerAboveID = previousLayerID;
      previousLayerID = layerID;

      return (
        <SymbolLayer
          key={layerID}
          id={layerID}
          aboveLayerID={layerAboveID}
          filter={distanceBucketFilter(bucket.intervalKm, hiddenDistanceRange) as never}
          minZoomLevel={bucket.minZoom}
          maxZoomLevel={bucket.maxZoom}
          style={{
            textField: ["get", "markerLabel"],
            textSize: 12,
            textColor: "#FFFFFF",
            textHaloColor: "#1C1A18",
            textHaloWidth: 4,
            textHaloBlur: 0.5,
            textAllowOverlap: true,
            textIgnorePlacement: true,
            symbolSortKey: SORT_KEY_FIELD as never,
            visibility: showDistanceMarkers ? "visible" : "none",
          }}
        />
      );
    });

    const endpointOutlineAboveLayerID = previousLayerID;

    return [
      ...distanceLayers,
      <CircleLayer
        key="endpoint-outline"
        id="route-endpoint-outline"
        aboveLayerID={endpointOutlineAboveLayerID}
        filter={ENDPOINT_FILTER as never}
        style={{
          circleRadius: 15,
          circleColor: colors.surface,
          circleOpacity: 0.95,
        }}
      />,
      <CircleLayer
        key="start-marker"
        id="route-start-marker"
        aboveLayerID="route-endpoint-outline"
        filter={START_FILTER as never}
        style={{
          circleRadius: 11,
          circleColor: colors.positive,
        }}
      />,
      <CircleLayer
        key="finish-marker"
        id="route-finish-marker"
        aboveLayerID="route-start-marker"
        filter={FINISH_FILTER as never}
        style={{
          circleRadius: 11,
          circleColor: colors.textPrimary,
        }}
      />,
      <SymbolLayer
        key="endpoint-label"
        id="route-endpoint-label"
        aboveLayerID="route-finish-marker"
        filter={ENDPOINT_FILTER as never}
        style={{
          textField: ["get", "markerLabel"],
          textSize: 11,
          textColor: colors.surface,
          textAllowOverlap: true,
          textIgnorePlacement: true,
          symbolSortKey: SORT_KEY_FIELD as never,
        }}
      />,
    ];
  }, [
    aboveLayerID,
    colors.positive,
    colors.surface,
    colors.textPrimary,
    hiddenDistanceRange,
    showDistanceMarkers,
  ]);

  if (points.length < 2) return null;

  return (
    <ShapeSource id="route-marker-source" shape={shape}>
      {layers}
    </ShapeSource>
  );
}
