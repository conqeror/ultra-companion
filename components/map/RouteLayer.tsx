import React, { useMemo } from "react";
import { ShapeSource, LineLayer } from "@rnmapbox/maps";
import { routeToGeoJSON } from "@/utils/geo";
import { useThemeColors } from "@/theme";
import { ACTIVE_ROUTE_COLOR, INACTIVE_ROUTE_COLOR } from "@/constants";
import type { Route, RoutePoint } from "@/types";

interface RouteLayerProps {
  route: Route;
  points: RoutePoint[];
  /** Dim the route line (e.g. when a climb highlight is shown on top) */
  dimmed?: boolean;
}

export default function RouteLayer({ route, points, dimmed }: RouteLayerProps) {
  const colors = useThemeColors();
  const geoJSON = useMemo(() => routeToGeoJSON(points), [points]);

  const outlineStyle = useMemo(
    () => ({
      lineColor: colors.surface,
      lineWidth: 6,
      lineOpacity: route.isActive ? 0.8 : 0.4,
      lineCap: "round" as const,
      lineJoin: "round" as const,
    }),
    [colors.surface, route.isActive],
  );

  const lineStyle = useMemo(
    () => ({
      lineColor: route.isActive && !dimmed ? ACTIVE_ROUTE_COLOR : INACTIVE_ROUTE_COLOR,
      lineWidth: 4,
      lineOpacity: route.isActive && !dimmed ? 1 : 0.6,
      lineCap: "round" as const,
      lineJoin: "round" as const,
    }),
    [route.isActive, dimmed],
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
