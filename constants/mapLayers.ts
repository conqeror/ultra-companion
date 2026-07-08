export const MAP_BASE_LAYER_IDS = {
  firstTextLabel: "contour-label",
  topTextLabel: "continent-label",
} as const;

export const MAP_LAYER_ANCHOR_IDS = {
  routeLine: "ultra-route-line-anchor",
  variantLine: "ultra-variant-line-anchor",
  weatherLine: "ultra-weather-line-anchor",
  climbLine: "ultra-climb-line-anchor",
  weatherSymbol: "ultra-weather-symbol-anchor",
  variantSymbol: "ultra-variant-symbol-anchor",
  routeMarkerSymbol: "ultra-route-marker-symbol-anchor",
  poiSymbol: "ultra-poi-symbol-anchor",
} as const;

export const MAP_LAYER_IDS = {
  collectionSegmentBoundaryFill: "collection-segment-boundary-fill",
  collectionSegmentBoundaryLabel: "collection-segment-boundary-label",
  collectionSegmentBoundaryOutline: "collection-segment-boundary-outline",
  collectionSegmentRouteLine: "collection-segment-route-line",
  collectionSegmentRouteOutline: "collection-segment-route-outline",
  routeEndpointLabel: "route-endpoint-label",
  weatherTemperatureLabels: "weather-temperature-labels",
  poiIcons: "poi-icons",
} as const;

export function routeDistanceMarkerLayerId(intervalKm: number): string {
  return `route-distance-${intervalKm}`;
}
