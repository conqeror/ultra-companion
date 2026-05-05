import React, { useMemo } from "react";
import { ShapeSource, LineLayer } from "@rnmapbox/maps";
import { routeToMapGeoJSON } from "@/utils/geo";
import { useThemeColors } from "@/theme";
import { ACTIVE_ROUTE_COLOR, INACTIVE_ROUTE_COLOR } from "@/constants";
import type { Route, RoutePoint } from "@/types";

interface RouteLayerProps {
  route: Route;
  points: RoutePoint[];
  zoomLevel?: number;
  /** Dim the route line (e.g. when a climb highlight is shown on top) */
  dimmed?: boolean;
}

export default function RouteLayer({ route, points, zoomLevel, dimmed }: RouteLayerProps) {
  const colors = useThemeColors();
  const geoJSON = useMemo(() => routeToMapGeoJSON(points, zoomLevel), [points, zoomLevel]);
  const isDark = colors.background === "#0E0E0C";

  const outlineStyle = useMemo(
    () => ({
      lineColor: route.isActive && isDark ? colors.background : colors.surface,
      lineWidth: route.isActive ? (isDark ? 9 : 7) : 6,
      lineOpacity: route.isActive ? (isDark ? 0.95 : 0.85) : 0.4,
      lineCap: "round" as const,
      lineJoin: "round" as const,
    }),
    [colors.background, colors.surface, isDark, route.isActive],
  );

  const lineStyle = useMemo(
    () => ({
      lineColor: route.isActive && !dimmed ? ACTIVE_ROUTE_COLOR : INACTIVE_ROUTE_COLOR,
      lineWidth: route.isActive ? (isDark ? 5.5 : 4.5) : 4,
      lineOpacity: route.isActive && !dimmed ? 1 : 0.6,
      lineCap: "round" as const,
      lineJoin: "round" as const,
    }),
    [route.isActive, dimmed, isDark],
  );

  if (points.length < 2) return null;

  return (
    <ShapeSource id={`route-source-${route.id}`} shape={geoJSON}>
      <LineLayer id={`route-outline-${route.id}`} style={outlineStyle} />
      <LineLayer
        id={`route-line-${route.id}`}
        style={lineStyle}
        aboveLayerID={`route-outline-${route.id}`}
      />
    </ShapeSource>
  );
}
