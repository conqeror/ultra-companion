import React, { useMemo } from "react";
import { ShapeSource, LineLayer } from "@rnmapbox/maps";
import { routeToGeoJSON } from "@/utils/geo";
import type { Route, RoutePoint } from "@/types";

interface RouteLayerProps {
  route: Route;
  points: RoutePoint[];
}

export default function RouteLayer({ route, points }: RouteLayerProps) {
  const geoJSON = useMemo(() => routeToGeoJSON(points), [points]);

  if (points.length < 2) return null;

  return (
    <ShapeSource id={`route-source-${route.id}`} shape={geoJSON}>
      {/* Outline for contrast */}
      <LineLayer
        id={`route-outline-${route.id}`}
        style={{
          lineColor: "#FFFFFF",
          lineWidth: 6,
          lineOpacity: route.isActive ? 0.8 : 0.4,
          lineCap: "round",
          lineJoin: "round",
        }}
      />
      {/* Main route line */}
      <LineLayer
        id={`route-line-${route.id}`}
        style={{
          lineColor: route.color,
          lineWidth: 4,
          lineOpacity: route.isActive ? 1 : 0.6,
          lineCap: "round",
          lineJoin: "round",
        }}
        aboveLayerID={`route-outline-${route.id}`}
      />
    </ShapeSource>
  );
}
