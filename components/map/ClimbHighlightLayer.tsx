import React, { useMemo } from "react";
import { ShapeSource, LineLayer } from "@rnmapbox/maps";
import { gradientColor } from "@/theme/elevation";
import { useThemeColors } from "@/theme";
import type { Climb, RoutePoint } from "@/types";

interface ClimbHighlightLayerProps {
  climb: Climb;
  points: RoutePoint[];
  /** Offset to add to climb distances (for collections) */
  distanceOffset?: number;
}

/**
 * Renders a climb segment on the map with gradient-colored line segments.
 * Each sub-segment is colored by its slope percentage.
 */
export default function ClimbHighlightLayer({
  climb,
  points,
  distanceOffset = 0,
}: ClimbHighlightLayerProps) {
  const colors = useThemeColors();
  const climbStart = climb.startDistanceMeters + distanceOffset;
  const climbEnd = climb.endDistanceMeters + distanceOffset;

  const geoJSON = useMemo(() => {
    if (points.length < 2) return null;

    // Find points within the climb range
    const climbPoints: RoutePoint[] = [];
    for (const p of points) {
      if (p.distanceFromStartMeters >= climbStart && p.distanceFromStartMeters <= climbEnd) {
        climbPoints.push(p);
      }
      if (p.distanceFromStartMeters > climbEnd) break;
    }

    if (climbPoints.length < 2) return null;

    // Build a FeatureCollection of short line segments, each colored by gradient
    const features: GeoJSON.Feature<GeoJSON.LineString>[] = [];

    for (let i = 0; i < climbPoints.length - 1; i++) {
      const a = climbPoints[i];
      const b = climbPoints[i + 1];
      const dist = b.distanceFromStartMeters - a.distanceFromStartMeters;
      if (dist <= 0) continue;

      const elevA = a.elevationMeters ?? 0;
      const elevB = b.elevationMeters ?? 0;
      const grad = ((elevB - elevA) / dist) * 100;

      features.push({
        type: "Feature",
        properties: { color: gradientColor(grad) },
        geometry: {
          type: "LineString",
          coordinates: [
            [a.longitude, a.latitude],
            [b.longitude, b.latitude],
          ],
        },
      });
    }

    return {
      type: "FeatureCollection" as const,
      features,
    };
  }, [points, climbStart, climbEnd]);

  if (!geoJSON || geoJSON.features.length === 0) return null;

  return (
    <ShapeSource id="climb-highlight-source" shape={geoJSON}>
      {/* Outline for contrast */}
      <LineLayer
        id="climb-highlight-outline"
        style={{
          lineColor: colors.surface,
          lineWidth: 8,
          lineOpacity: 0.9,
          lineCap: "round",
          lineJoin: "round",
        }}
      />
      {/* Gradient-colored line */}
      <LineLayer
        id="climb-highlight-line"
        aboveLayerID="climb-highlight-outline"
        style={{
          lineColor: ["get", "color"] as any,
          lineWidth: 6,
          lineOpacity: 1,
          lineCap: "round",
          lineJoin: "round",
        }}
      />
    </ShapeSource>
  );
}
