import React from "react";
import { CircleLayer, LineLayer, ShapeSource, SymbolLayer } from "@rnmapbox/maps";
import { ACTIVE_ROUTE_COLOR, COLLECTION_SEGMENT_ALTERNATE_ROUTE_COLOR } from "@/constants";
import { MAP_LAYER_IDS } from "@/constants/mapLayers";
import { useThemeColors } from "@/theme";
import type { CollectionSegmentMapFeatureCollections } from "@/utils/collectionSegmentDisplay";

interface CollectionSegmentLayerProps {
  features: CollectionSegmentMapFeatureCollections;
  lineAboveLayerID?: string;
  symbolAboveLayerID?: string;
  dimmed?: boolean;
}

const COLOR_ROLE_FIELD = ["get", "colorRole"] as const;
const SORT_KEY_FIELD = ["get", "sortKey"] as const;

export default function CollectionSegmentLayer({
  features,
  lineAboveLayerID,
  symbolAboveLayerID,
  dimmed = false,
}: CollectionSegmentLayerProps) {
  const colors = useThemeColors();
  const hasLines = features.lines.features.length > 0;
  const hasBoundaries = features.boundaries.features.length > 0;
  if (!hasLines && !hasBoundaries) return null;
  const isDark = colors.background === "#0E0E0C";

  const lineColorExpression = [
    "match",
    COLOR_ROLE_FIELD,
    "primary",
    ACTIVE_ROUTE_COLOR,
    "alternate",
    COLLECTION_SEGMENT_ALTERNATE_ROUTE_COLOR,
    ACTIVE_ROUTE_COLOR,
  ] as const;

  return (
    <>
      {hasLines && (
        <ShapeSource id="collection-segment-line-source" shape={features.lines}>
          <LineLayer
            id={MAP_LAYER_IDS.collectionSegmentRouteOutline}
            aboveLayerID={lineAboveLayerID}
            style={{
              lineColor: isDark ? colors.background : colors.surface,
              lineWidth: isDark ? 9 : 7,
              lineOpacity: isDark ? 0.95 : 0.85,
              lineCap: "round",
              lineJoin: "round",
              lineSortKey: SORT_KEY_FIELD as never,
            }}
          />
          <LineLayer
            id={MAP_LAYER_IDS.collectionSegmentRouteLine}
            aboveLayerID={MAP_LAYER_IDS.collectionSegmentRouteOutline}
            style={{
              lineColor: lineColorExpression as never,
              lineWidth: isDark ? 5.5 : 4.5,
              lineOpacity: dimmed ? 0.6 : 1,
              lineCap: "round",
              lineJoin: "round",
              lineSortKey: SORT_KEY_FIELD as never,
            }}
          />
        </ShapeSource>
      )}
      {hasBoundaries && (
        <ShapeSource id="collection-segment-boundary-source" shape={features.boundaries}>
          <CircleLayer
            id={MAP_LAYER_IDS.collectionSegmentBoundaryOutline}
            aboveLayerID={symbolAboveLayerID}
            style={{
              circleRadius: 13,
              circleColor: colors.surface,
              circleOpacity: 0.94,
              circleSortKey: SORT_KEY_FIELD as never,
            }}
          />
          <CircleLayer
            id={MAP_LAYER_IDS.collectionSegmentBoundaryFill}
            aboveLayerID={MAP_LAYER_IDS.collectionSegmentBoundaryOutline}
            style={{
              circleRadius: 10,
              circleColor: colors.info,
              circleOpacity: dimmed ? 0.58 : 0.92,
              circleSortKey: SORT_KEY_FIELD as never,
            }}
          />
          <SymbolLayer
            id={MAP_LAYER_IDS.collectionSegmentBoundaryLabel}
            aboveLayerID={MAP_LAYER_IDS.collectionSegmentBoundaryFill}
            style={{
              textField: ["get", "label"],
              textSize: 10.5,
              textColor: colors.surface,
              textAllowOverlap: true,
              textIgnorePlacement: true,
              symbolSortKey: SORT_KEY_FIELD as never,
            }}
          />
        </ShapeSource>
      )}
    </>
  );
}
