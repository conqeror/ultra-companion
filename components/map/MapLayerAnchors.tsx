import React from "react";
import { CircleLayer, ShapeSource } from "@rnmapbox/maps";
import { MAP_BASE_LAYER_IDS, MAP_LAYER_ANCHOR_IDS } from "@/constants/mapLayers";

const EMPTY_ANCHOR_SOURCE: GeoJSON.FeatureCollection<GeoJSON.Point> = {
  type: "FeatureCollection",
  features: [],
};

const HIDDEN_ANCHOR_STYLE = {
  circleRadius: 0,
  circleOpacity: 0,
};

// Invisible layers that give every custom overlay a stable Mapbox insertion target.
export default function MapLayerAnchors() {
  return (
    <ShapeSource id="ultra-map-layer-anchor-source" shape={EMPTY_ANCHOR_SOURCE}>
      <CircleLayer
        id={MAP_LAYER_ANCHOR_IDS.routeLine}
        belowLayerID={MAP_BASE_LAYER_IDS.firstTextLabel}
        style={HIDDEN_ANCHOR_STYLE}
      />
      <CircleLayer
        id={MAP_LAYER_ANCHOR_IDS.variantLine}
        aboveLayerID={MAP_LAYER_ANCHOR_IDS.routeLine}
        style={HIDDEN_ANCHOR_STYLE}
      />
      <CircleLayer
        id={MAP_LAYER_ANCHOR_IDS.weatherLine}
        aboveLayerID={MAP_LAYER_ANCHOR_IDS.variantLine}
        style={HIDDEN_ANCHOR_STYLE}
      />
      <CircleLayer
        id={MAP_LAYER_ANCHOR_IDS.climbLine}
        aboveLayerID={MAP_LAYER_ANCHOR_IDS.weatherLine}
        style={HIDDEN_ANCHOR_STYLE}
      />
      <CircleLayer
        id={MAP_LAYER_ANCHOR_IDS.weatherSymbol}
        aboveLayerID={MAP_BASE_LAYER_IDS.topTextLabel}
        style={HIDDEN_ANCHOR_STYLE}
      />
      <CircleLayer
        id={MAP_LAYER_ANCHOR_IDS.variantSymbol}
        aboveLayerID={MAP_LAYER_ANCHOR_IDS.weatherSymbol}
        style={HIDDEN_ANCHOR_STYLE}
      />
      <CircleLayer
        id={MAP_LAYER_ANCHOR_IDS.routeMarkerSymbol}
        aboveLayerID={MAP_LAYER_ANCHOR_IDS.variantSymbol}
        style={HIDDEN_ANCHOR_STYLE}
      />
      <CircleLayer
        id={MAP_LAYER_ANCHOR_IDS.poiSymbol}
        aboveLayerID={MAP_LAYER_ANCHOR_IDS.routeMarkerSymbol}
        style={HIDDEN_ANCHOR_STYLE}
      />
    </ShapeSource>
  );
}
