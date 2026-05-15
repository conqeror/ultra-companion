import React, { useMemo } from "react";
import { ShapeSource, SymbolLayer } from "@rnmapbox/maps";
import { buildClimbDistanceMarkerFeatureCollection } from "@/utils/climbDistanceMarkers";
import type { DisplayClimb, RoutePoint } from "@/types";

interface ClimbDistanceMarkerLayerProps {
  climb: DisplayClimb;
  points: RoutePoint[];
  aboveLayerID?: string;
}

const SORT_KEY_FIELD = ["get", "sortKey"] as const;

export default function ClimbDistanceMarkerLayer({
  climb,
  points,
  aboveLayerID,
}: ClimbDistanceMarkerLayerProps) {
  const shape = useMemo(
    () =>
      buildClimbDistanceMarkerFeatureCollection({
        points,
        startDistanceMeters: climb.effectiveStartDistanceMeters,
        endDistanceMeters: climb.effectiveEndDistanceMeters,
      }),
    [points, climb.effectiveStartDistanceMeters, climb.effectiveEndDistanceMeters],
  );

  if (shape.features.length === 0) return null;

  return (
    <ShapeSource id="climb-distance-marker-source" shape={shape}>
      <SymbolLayer
        id="climb-distance-marker-label"
        aboveLayerID={aboveLayerID}
        style={{
          textField: ["get", "markerLabel"],
          textSize: 12,
          textColor: "#FFFFFF",
          textHaloColor: "#1C1A18",
          textHaloWidth: 4,
          textHaloBlur: 0.5,
          textAllowOverlap: true,
          textIgnorePlacement: true,
          symbolSortKey: SORT_KEY_FIELD as never,
        }}
      />
    </ShapeSource>
  );
}
