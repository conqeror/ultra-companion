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
 * Renders a climb segment on the map with a smooth gradient-colored line.
 * Uses Mapbox lineGradient on a single LineString for seamless color blending.
 */
export default function ClimbHighlightLayer({
  climb,
  points,
  distanceOffset = 0,
}: ClimbHighlightLayerProps) {
  const colors = useThemeColors();
  const climbStart = climb.startDistanceMeters + distanceOffset;
  const climbEnd = climb.endDistanceMeters + distanceOffset;

  const { geoJSON, gradientExpr } = useMemo(() => {
    if (points.length < 2) return { geoJSON: null, gradientExpr: null };

    // Find points within the climb range
    const climbPoints: RoutePoint[] = [];
    for (const p of points) {
      if (p.distanceFromStartMeters >= climbStart && p.distanceFromStartMeters <= climbEnd) {
        climbPoints.push(p);
      }
      if (p.distanceFromStartMeters > climbEnd) break;
    }

    if (climbPoints.length < 2) return { geoJSON: null, gradientExpr: null };

    // Build a single LineString with all climb coordinates
    const coordinates = climbPoints.map((p) => [p.longitude, p.latitude]);

    const lineGeoJSON: GeoJSON.Feature<GeoJSON.LineString> = {
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates },
    };

    // Build lineGradient stops: for each segment midpoint, assign a gradient color.
    // line-progress goes from 0 (start) to 1 (end) based on projected line length.
    // We approximate using distance along the route.
    const totalDist =
      climbPoints[climbPoints.length - 1].distanceFromStartMeters -
      climbPoints[0].distanceFromStartMeters;

    if (totalDist <= 0) return { geoJSON: null, gradientExpr: null };

    const startDist = climbPoints[0].distanceFromStartMeters;
    const stops: (number | string)[] = [];

    for (let i = 0; i < climbPoints.length - 1; i++) {
      const a = climbPoints[i];
      const b = climbPoints[i + 1];
      const segDist = b.distanceFromStartMeters - a.distanceFromStartMeters;
      if (segDist <= 0) continue;

      const elevA = a.elevationMeters ?? 0;
      const elevB = b.elevationMeters ?? 0;
      const grad = ((elevB - elevA) / segDist) * 100;
      const color = gradientColor(grad);

      // Add a stop at the start of this segment
      const t = (a.distanceFromStartMeters - startDist) / totalDist;
      stops.push(Math.min(Math.max(t, 0), 1), color);
    }

    // Add final stop at 1.0
    const lastA = climbPoints[climbPoints.length - 2];
    const lastB = climbPoints[climbPoints.length - 1];
    const lastSegDist = lastB.distanceFromStartMeters - lastA.distanceFromStartMeters;
    const lastGrad =
      lastSegDist > 0
        ? (((lastB.elevationMeters ?? 0) - (lastA.elevationMeters ?? 0)) / lastSegDist) * 100
        : 0;
    stops.push(1, gradientColor(lastGrad));

    // Deduplicate stops at the same progress value (keep the last one)
    const dedupedStops: (number | string)[] = [];
    for (let i = 0; i < stops.length; i += 2) {
      const t = stops[i] as number;
      const c = stops[i + 1] as string;
      // If next stop has the same t, skip this one
      if (i + 2 < stops.length && stops[i + 2] === t) continue;
      dedupedStops.push(t, c);
    }

    const expr = ["interpolate", ["linear"], ["line-progress"], ...dedupedStops];

    return { geoJSON: lineGeoJSON, gradientExpr: expr };
  }, [points, climbStart, climbEnd]);

  if (!geoJSON || !gradientExpr) return null;

  return (
    <ShapeSource id="climb-highlight-source" shape={geoJSON} lineMetrics>
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
      {/* Smooth gradient-colored line */}
      <LineLayer
        id="climb-highlight-line"
        aboveLayerID="climb-highlight-outline"
        style={{
          lineGradient: gradientExpr as any,
          lineWidth: 6,
          lineOpacity: 1,
          lineCap: "round",
          lineJoin: "round",
        }}
      />
    </ShapeSource>
  );
}
