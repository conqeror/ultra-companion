import React, { useMemo } from "react";
import { ShapeSource, LineLayer } from "@rnmapbox/maps";
import { useThemeColors } from "@/theme";
import { ACTIVE_ROUTE_COLOR, INACTIVE_ROUTE_COLOR } from "@/constants";

interface RouteLayerProps {
  routeId: string;
  geoJSON: GeoJSON.Feature<GeoJSON.LineString>;
  isActive: boolean;
  aboveLayerID?: string;
  /** Dim the route line (e.g. when a climb highlight is shown on top) */
  dimmed?: boolean;
}

function RouteLayer({ routeId, geoJSON, isActive, aboveLayerID, dimmed }: RouteLayerProps) {
  const colors = useThemeColors();
  const isDark = colors.background === "#0E0E0C";

  const outlineStyle = useMemo(
    () => ({
      lineColor: isActive && isDark ? colors.background : colors.surface,
      lineWidth: isActive ? (isDark ? 9 : 7) : 6,
      lineOpacity: isActive ? (isDark ? 0.95 : 0.85) : 0.4,
      lineCap: "round" as const,
      lineJoin: "round" as const,
    }),
    [colors.background, colors.surface, isDark, isActive],
  );

  const lineStyle = useMemo(
    () => ({
      lineColor: isActive && !dimmed ? ACTIVE_ROUTE_COLOR : INACTIVE_ROUTE_COLOR,
      lineWidth: isActive ? (isDark ? 5.5 : 4.5) : 4,
      lineOpacity: isActive && !dimmed ? 1 : 0.6,
      lineCap: "round" as const,
      lineJoin: "round" as const,
    }),
    [isActive, dimmed, isDark],
  );

  if (geoJSON.geometry.coordinates.length < 2) return null;

  return (
    <ShapeSource id={`route-source-${routeId}`} shape={geoJSON}>
      <LineLayer id={`route-outline-${routeId}`} aboveLayerID={aboveLayerID} style={outlineStyle} />
      <LineLayer
        id={`route-line-${routeId}`}
        style={lineStyle}
        aboveLayerID={`route-outline-${routeId}`}
      />
    </ShapeSource>
  );
}

export default React.memo(RouteLayer, (prev, next) => {
  return (
    prev.routeId === next.routeId &&
    prev.geoJSON === next.geoJSON &&
    prev.isActive === next.isActive &&
    prev.aboveLayerID === next.aboveLayerID &&
    prev.dimmed === next.dimmed
  );
});
