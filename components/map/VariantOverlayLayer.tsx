import React, { useMemo } from "react";
import { ShapeSource, LineLayer, SymbolLayer } from "@rnmapbox/maps";
import { INACTIVE_ROUTE_COLOR } from "@/constants";
import { useThemeColors } from "@/theme";

export interface VariantOverlay {
  id: string;
  geoJSON: GeoJSON.Feature<GeoJSON.LineString>;
  labelCoordinate: [number, number] | null;
  label: string;
}

interface VariantOverlayLayerProps {
  overlays: VariantOverlay[];
  lineAboveLayerID?: string;
  symbolAboveLayerID?: string;
}

export default function VariantOverlayLayer({
  overlays,
  lineAboveLayerID,
  symbolAboveLayerID,
}: VariantOverlayLayerProps) {
  const colors = useThemeColors();

  const { lineGeoJSON, labelGeoJSON } = useMemo(() => {
    const visible = overlays.filter((overlay) => overlay.geoJSON.geometry.coordinates.length >= 2);
    const lines: GeoJSON.Feature<GeoJSON.LineString>[] = visible.map((overlay) => ({
      type: "Feature",
      properties: { id: overlay.id },
      geometry: overlay.geoJSON.geometry,
    }));
    const labels: GeoJSON.Feature<GeoJSON.Point>[] = visible.flatMap((overlay) => {
      const coordinates = overlay.labelCoordinate;
      if (!coordinates) return [];
      return [
        {
          type: "Feature",
          properties: { id: overlay.id, label: overlay.label },
          geometry: { type: "Point", coordinates },
        },
      ];
    });

    return {
      lineGeoJSON: { type: "FeatureCollection", features: lines } as GeoJSON.FeatureCollection,
      labelGeoJSON: { type: "FeatureCollection", features: labels } as GeoJSON.FeatureCollection,
    };
  }, [overlays]);

  if (lineGeoJSON.features.length === 0) return null;

  return (
    <>
      <ShapeSource id="collection-variant-overlay-source" shape={lineGeoJSON}>
        <LineLayer
          id="collection-variant-overlay-outline"
          aboveLayerID={lineAboveLayerID}
          style={{
            lineColor: colors.surface,
            lineWidth: ["interpolate", ["linear"], ["zoom"], 8, 4.5, 13, 7],
            lineOpacity: 0.45,
            lineCap: "round",
            lineJoin: "round",
          }}
        />
        <LineLayer
          id="collection-variant-overlay-line"
          aboveLayerID="collection-variant-overlay-outline"
          style={{
            lineColor: INACTIVE_ROUTE_COLOR,
            lineWidth: ["interpolate", ["linear"], ["zoom"], 8, 3, 13, 5],
            lineOpacity: 0.65,
            lineCap: "round",
            lineJoin: "round",
          }}
        />
      </ShapeSource>
      {labelGeoJSON.features.length > 0 && (
        <ShapeSource id="collection-variant-overlay-label-source" shape={labelGeoJSON}>
          <SymbolLayer
            id="collection-variant-overlay-labels"
            aboveLayerID={symbolAboveLayerID}
            style={{
              textField: ["get", "label"],
              textSize: ["interpolate", ["linear"], ["zoom"], 8, 0, 9, 10, 13, 11],
              textOpacity: ["interpolate", ["linear"], ["zoom"], 8, 0, 9, 0.82],
              textColor: colors.textSecondary,
              textHaloColor: colors.surface,
              textHaloWidth: 2,
              textLineHeight: 1.12,
              textAllowOverlap: false,
              textIgnorePlacement: false,
              textOffset: [0, -1],
            }}
          />
        </ShapeSource>
      )}
    </>
  );
}
