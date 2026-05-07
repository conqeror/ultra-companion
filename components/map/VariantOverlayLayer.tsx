import React, { useMemo } from "react";
import { ShapeSource, LineLayer, SymbolLayer } from "@rnmapbox/maps";
import { INACTIVE_ROUTE_COLOR } from "@/constants";
import { useThemeColors } from "@/theme";
import type { RoutePoint } from "@/types";

export interface VariantOverlay {
  id: string;
  points: RoutePoint[];
  label: string;
}

function labelCoordinate(points: RoutePoint[]): [number, number] | null {
  if (points.length === 0) return null;
  const targetDistance = (points[points.length - 1]?.distanceFromStartMeters ?? 0) / 2;
  const point =
    points.find((pt) => pt.distanceFromStartMeters >= targetDistance) ??
    points[Math.floor(points.length / 2)];
  return point ? [point.longitude, point.latitude] : null;
}

export default function VariantOverlayLayer({ overlays }: { overlays: VariantOverlay[] }) {
  const colors = useThemeColors();

  const { lineGeoJSON, labelGeoJSON } = useMemo(() => {
    const visible = overlays.filter((overlay) => overlay.points.length >= 2);
    const lines: GeoJSON.Feature<GeoJSON.LineString>[] = visible.map((overlay) => ({
      type: "Feature",
      properties: { id: overlay.id },
      geometry: {
        type: "LineString",
        coordinates: overlay.points.map((point) => [point.longitude, point.latitude]),
      },
    }));
    const labels: GeoJSON.Feature<GeoJSON.Point>[] = visible.flatMap((overlay) => {
      const coordinates = labelCoordinate(overlay.points);
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
