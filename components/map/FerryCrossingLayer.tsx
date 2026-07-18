import React, { useMemo } from "react";
import { CircleLayer, LineLayer, ShapeSource, SymbolLayer } from "@rnmapbox/maps";
import { MAP_LAYER_ANCHOR_IDS, MAP_LAYER_IDS } from "@/constants/mapLayers";
import { useThemeColors } from "@/theme";
import { buildFerryMapFeatureCollections } from "@/utils/ferryMapFeatures";
import type { DisplayFerryCrossing } from "@/types";

interface FerryCrossingLayerProps {
  ferries: readonly DisplayFerryCrossing[];
  dimmed?: boolean;
}

const SORT_KEY_FIELD = ["get", "sortKey"] as const;

export default function FerryCrossingLayer({ ferries, dimmed = false }: FerryCrossingLayerProps) {
  const colors = useThemeColors();
  const features = useMemo(() => buildFerryMapFeatureCollections(ferries), [ferries]);
  if (features.lines.features.length === 0) return null;

  return (
    <>
      <ShapeSource id="ferry-crossing-line-source" shape={features.lines}>
        <LineLayer
          id={MAP_LAYER_IDS.ferryCrossingOutline}
          aboveLayerID={MAP_LAYER_ANCHOR_IDS.ferryLine}
          style={{
            lineColor: colors.surface,
            lineWidth: 10,
            lineOpacity: dimmed ? 0.48 : 0.9,
            lineCap: "round",
            lineJoin: "round",
            lineSortKey: SORT_KEY_FIELD as never,
          }}
        />
        <LineLayer
          id={MAP_LAYER_IDS.ferryCrossingLine}
          aboveLayerID={MAP_LAYER_IDS.ferryCrossingOutline}
          style={{
            lineColor: colors.info,
            lineWidth: 6,
            lineOpacity: dimmed ? 0.58 : 0.98,
            lineDasharray: [1.25, 1],
            lineCap: "round",
            lineJoin: "round",
            lineSortKey: SORT_KEY_FIELD as never,
          }}
        />
      </ShapeSource>

      <ShapeSource id="ferry-crossing-name-source" shape={features.labels}>
        <SymbolLayer
          id={MAP_LAYER_IDS.ferryNameLabel}
          aboveLayerID={MAP_LAYER_ANCHOR_IDS.ferrySymbol}
          minZoomLevel={9}
          style={{
            textField: ["get", "label"],
            textSize: 12,
            textColor: dimmed ? colors.textSecondary : colors.textPrimary,
            textHaloColor: colors.surface,
            textHaloWidth: 2.5,
            textOffset: [0, -1.15],
            textMaxWidth: 14,
            textAllowOverlap: false,
            textIgnorePlacement: false,
            symbolSortKey: SORT_KEY_FIELD as never,
          }}
        />
      </ShapeSource>

      <ShapeSource id="ferry-crossing-endpoint-source" shape={features.endpoints}>
        <CircleLayer
          id={MAP_LAYER_IDS.ferryEndpointCircle}
          aboveLayerID={MAP_LAYER_IDS.ferryNameLabel}
          minZoomLevel={7}
          style={{
            circleColor: colors.info,
            circleRadius: 9,
            circleOpacity: dimmed ? 0.62 : 0.96,
            circleStrokeColor: colors.surface,
            circleStrokeWidth: 3,
            circleSortKey: SORT_KEY_FIELD as never,
          }}
        />
        <SymbolLayer
          id={MAP_LAYER_IDS.ferryEndpointLabel}
          aboveLayerID={MAP_LAYER_IDS.ferryEndpointCircle}
          minZoomLevel={7}
          style={{
            textField: ["get", "label"],
            textSize: 11,
            textColor: colors.surface,
            textAllowOverlap: true,
            textIgnorePlacement: true,
            symbolSortKey: SORT_KEY_FIELD as never,
          }}
        />
        <SymbolLayer
          id={MAP_LAYER_IDS.ferryEndpointRoleLabel}
          aboveLayerID={MAP_LAYER_IDS.ferryEndpointLabel}
          minZoomLevel={12}
          style={{
            textField: ["get", "roleLabel"],
            textSize: 11,
            textColor: dimmed ? colors.textSecondary : colors.textPrimary,
            textHaloColor: colors.surface,
            textHaloWidth: 2.5,
            textOffset: [0, 1.45],
            textAnchor: "top",
            textAllowOverlap: false,
            textIgnorePlacement: false,
            symbolSortKey: SORT_KEY_FIELD as never,
          }}
        />
      </ShapeSource>
    </>
  );
}
