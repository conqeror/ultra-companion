import React, { useMemo, useCallback, useRef } from "react";
import { ShapeSource, CircleLayer, SymbolLayer } from "@rnmapbox/maps";
import { usePoiStore } from "@/store/poiStore";
import { usePanelStore } from "@/store/panelStore";
import { useThemeColors } from "@/theme";
import {
  POI_BEHIND_THRESHOLD_M,
  POI_CLUSTER_HITBOX,
  POI_CLUSTER_MAX_ZOOM,
  POI_CLUSTER_MIN_ZOOM,
  POI_CLUSTER_RADIUS,
  POI_CLUSTER_SUMMARY_CATEGORIES,
  POI_CLUSTER_SUMMARY_ICON_SYMBOL_SIZE,
  POI_CLUSTER_SUMMARY_PRIORITY_PROPERTY,
  POI_MAP_ICON_SYMBOL_SIZE,
  poiClusterSummaryProperty,
  poiMapIconImageId,
  poiMapIconImageIdForCategory,
} from "@/constants";
import { haversineDistance } from "@/utils/geo";
import { toDisplayPOIs } from "@/services/displayDistance";
import { stitchPOIs } from "@/services/stitchingService";
import { buildPOIClusterProperties, buildPOIMapFeatureCollections } from "@/utils/poiMapFeatures";
import POIMapImages from "./POIMapImages";
import {
  createRidingHorizonWindow,
  isDistanceInWindow,
  ridingHorizonMetersForMode,
} from "@/utils/ridingHorizon";
import type { DisplayPOI, POI, StitchedSegmentInfo } from "@/types";

const CLUSTER_FILTER = ["has", "point_count"] as const;
const UNCLUSTERED_FILTER = ["!", ["has", "point_count"]] as const;
const POI_ICON_COLOR = "#FFFFFF";
const CLUSTER_OVERFLOW_TEXT_OFFSET = [0.45, 0];
const POI_CLUSTER_PROPERTIES = buildPOIClusterProperties();

type MapboxExpression = unknown[];

interface ShapeSourcePressEvent {
  features?: GeoJSON.Feature[];
  coordinates?: {
    latitude: number;
    longitude: number;
  };
}

interface POILayerProps {
  routeIds: string[];
  segments: StitchedSegmentInfo[] | null;
  currentDistanceMeters: number | null;
  onClusterPress: (center: [number, number], zoomLevel: number) => void;
  showOnlySelected?: boolean;
}

function isClusterFeature(feature: GeoJSON.Feature): boolean {
  const props = feature.properties;
  if (!props) return false;
  return props.cluster === true || props.cluster === 1 || props.point_count != null;
}

function pointCoordinates(feature: GeoJSON.Feature): [number, number] | null {
  if (feature.geometry?.type !== "Point") return null;
  const [longitude, latitude] = feature.geometry.coordinates;
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
  return [longitude, latitude];
}

function findPressedPOI(
  features: GeoJSON.Feature[],
  tapCoord: ShapeSourcePressEvent["coordinates"],
  pois: DisplayPOI[],
): DisplayPOI | undefined {
  if (tapCoord && features.length > 1) {
    let bestPoi: DisplayPOI | undefined;
    let bestDist = Infinity;

    for (const feature of features) {
      const id = feature.properties?.poiId;
      if (!id || typeof id !== "string") continue;
      const poi = pois.find((p) => p.id === id);
      if (!poi) continue;
      const dist = haversineDistance(
        tapCoord.latitude,
        tapCoord.longitude,
        poi.latitude,
        poi.longitude,
      );
      if (dist < bestDist) {
        bestDist = dist;
        bestPoi = poi;
      }
    }

    return bestPoi;
  }

  const id = features[0]?.properties?.poiId;
  return typeof id === "string" ? pois.find((p) => p.id === id) : undefined;
}

function clusterCategoryCountExpression(category: (typeof POI_CLUSTER_SUMMARY_CATEGORIES)[number]) {
  return ["coalesce", ["get", poiClusterSummaryProperty(category)], 0];
}

function clusterHasCategoryExpression(category: (typeof POI_CLUSTER_SUMMARY_CATEGORIES)[number]) {
  return [">", clusterCategoryCountExpression(category), 0];
}

function countExpressions(expressions: MapboxExpression[]): number | MapboxExpression {
  if (expressions.length === 0) return 0;
  if (expressions.length === 1) return expressions[0];
  return ["+", ...expressions];
}

function clusterPresentCategoryCountExpression(): number | MapboxExpression {
  return countExpressions(
    POI_CLUSTER_SUMMARY_CATEGORIES.map((category) => [
      "case",
      clusterHasCategoryExpression(category),
      1,
      0,
    ]),
  );
}

const CLUSTER_SUMMARY_TOTAL_EXPRESSION = clusterPresentCategoryCountExpression();
const CLUSTER_SUMMARY_PRIORITY_EXPRESSION = [
  "coalesce",
  ["get", POI_CLUSTER_SUMMARY_PRIORITY_PROPERTY],
  POI_CLUSTER_SUMMARY_CATEGORIES.length,
];
const CLUSTER_SUMMARY_ICON_OFFSET = [
  "case",
  [">", CLUSTER_SUMMARY_TOTAL_EXPRESSION, 1],
  ["literal", [-4, 0]],
  ["literal", [0, 0]],
];

function clusterSummaryIconExpression(): MapboxExpression {
  const expression: MapboxExpression = ["match", CLUSTER_SUMMARY_PRIORITY_EXPRESSION];

  POI_CLUSTER_SUMMARY_CATEGORIES.forEach((category, index) => {
    expression.push(index);
    expression.push(poiMapIconImageIdForCategory(category));
  });

  expression.push(poiMapIconImageId("MapPin"));
  return expression;
}

function renderClusterSummaryIconLayer(): React.ReactElement {
  return (
    <SymbolLayer
      id="poi-cluster-summary-icon"
      filter={CLUSTER_FILTER}
      style={{
        iconImage: clusterSummaryIconExpression() as never,
        iconSize: POI_CLUSTER_SUMMARY_ICON_SYMBOL_SIZE,
        iconOffset: CLUSTER_SUMMARY_ICON_OFFSET as never,
        iconColor: POI_ICON_COLOR,
        iconAllowOverlap: true,
        iconIgnorePlacement: true,
      }}
      minZoomLevel={POI_CLUSTER_MIN_ZOOM}
    />
  );
}

export default function POILayer({
  routeIds,
  segments,
  currentDistanceMeters,
  onClusterPress,
  showOnlySelected = false,
}: POILayerProps) {
  const clusteredSourceRef = useRef<ShapeSource>(null);
  const getVisiblePOIs = usePoiStore((s) => s.getVisiblePOIs);
  const enabledCategories = usePoiStore((s) => s.enabledCategories);
  const starredPOIIds = usePoiStore((s) => s.starredPOIIds);
  const allPois = usePoiStore((s) => s.pois);
  const selectedPOI = usePoiStore((s) => s.selectedPOI);
  const setSelectedPOI = usePoiStore((s) => s.setSelectedPOI);
  const panelMode = usePanelStore((s) => s.panelMode);
  const colors = useThemeColors();

  const visiblePOIs = useMemo(() => {
    const canShowSelected =
      selectedPOI != null && (routeIds.length === 0 || routeIds.includes(selectedPOI.routeId));

    if (showOnlySelected) {
      return canShowSelected ? [selectedPOI] : [];
    }

    const distanceWindow = createRidingHorizonWindow(
      currentDistanceMeters,
      ridingHorizonMetersForMode(panelMode),
      { behindMeters: POI_BEHIND_THRESHOLD_M },
    );

    if (segments) {
      const poisByRoute: Record<string, POI[]> = {};
      for (const routeId of routeIds) {
        poisByRoute[routeId] = getVisiblePOIs(routeId);
      }
      const stitched = stitchPOIs(segments, poisByRoute, distanceWindow);
      if (canShowSelected && !stitched.some((poi) => poi.id === selectedPOI.id)) {
        return [...stitched, selectedPOI];
      }
      return stitched;
    }

    const combined: DisplayPOI[] = [];
    for (const routeId of routeIds) {
      const routePois = getVisiblePOIs(routeId).filter((poi) =>
        isDistanceInWindow(poi.distanceAlongRouteMeters, distanceWindow),
      );
      combined.push(...toDisplayPOIs(routePois));
    }
    if (canShowSelected && !combined.some((poi) => poi.id === selectedPOI.id)) {
      combined.push(selectedPOI);
    }
    return combined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    routeIds,
    segments,
    currentDistanceMeters,
    panelMode,
    allPois,
    enabledCategories,
    starredPOIIds,
    selectedPOI,
    showOnlySelected,
  ]);

  const { clustered, starred } = useMemo(
    () => buildPOIMapFeatureCollections(visiblePOIs, starredPOIIds),
    [visiblePOIs, starredPOIIds],
  );

  const handleClusteredPress = useCallback(
    async (event: ShapeSourcePressEvent) => {
      const features = event?.features;
      if (!features?.length) return;

      const clusterFeature = features.find(isClusterFeature);
      if (clusterFeature) {
        const center = pointCoordinates(clusterFeature);
        if (!center) return;

        let zoomLevel = POI_CLUSTER_MAX_ZOOM + 1;
        try {
          const expansionZoom =
            await clusteredSourceRef.current?.getClusterExpansionZoom(clusterFeature);
          if (typeof expansionZoom === "number" && Number.isFinite(expansionZoom)) {
            zoomLevel = expansionZoom;
          }
        } catch {}

        onClusterPress(center, zoomLevel);
        return;
      }

      const bestPoi = findPressedPOI(features, event?.coordinates, visiblePOIs);
      if (bestPoi) setSelectedPOI(bestPoi);
    },
    [visiblePOIs, setSelectedPOI, onClusterPress],
  );

  const handleStarredPress = useCallback(
    (event: ShapeSourcePressEvent) => {
      const features = event?.features;
      if (!features?.length) return;

      const bestPoi = findPressedPOI(features, event?.coordinates, visiblePOIs);
      if (bestPoi) setSelectedPOI(bestPoi);
    },
    [visiblePOIs, setSelectedPOI],
  );

  if (visiblePOIs.length === 0) return null;

  return (
    <>
      <POIMapImages />

      {clustered.features.length > 0 && (
        <ShapeSource
          id="poi-clustered-source"
          ref={clusteredSourceRef}
          shape={clustered}
          cluster
          clusterRadius={POI_CLUSTER_RADIUS}
          clusterMaxZoomLevel={POI_CLUSTER_MAX_ZOOM}
          clusterProperties={POI_CLUSTER_PROPERTIES}
          onPress={handleClusteredPress}
          hitbox={{ width: POI_CLUSTER_HITBOX, height: POI_CLUSTER_HITBOX }}
        >
          <CircleLayer
            id="poi-clusters-outline"
            filter={CLUSTER_FILTER}
            style={{
              circleRadius: ["step", ["get", "point_count"], 17, 10, 20, 50, 23],
              circleColor: colors.surface,
            }}
            minZoomLevel={POI_CLUSTER_MIN_ZOOM}
          />
          <CircleLayer
            id="poi-clusters-fill"
            filter={CLUSTER_FILTER}
            style={{
              circleRadius: ["step", ["get", "point_count"], 14, 10, 17, 50, 20],
              circleColor: colors.accent,
            }}
            minZoomLevel={POI_CLUSTER_MIN_ZOOM}
          />
          {renderClusterSummaryIconLayer()}
          <SymbolLayer
            id="poi-cluster-summary-overflow"
            filter={["all", CLUSTER_FILTER, [">", CLUSTER_SUMMARY_TOTAL_EXPRESSION, 1]] as never}
            style={{
              textField: "+",
              textSize: 13,
              textColor: colors.accentForeground,
              textOffset: CLUSTER_OVERFLOW_TEXT_OFFSET,
              textAllowOverlap: true,
              textIgnorePlacement: true,
            }}
            minZoomLevel={POI_CLUSTER_MIN_ZOOM}
          />

          {/* Regular POIs: surface-colored ring, visible from zoom 10 */}
          <CircleLayer
            id="poi-circles-outline"
            filter={UNCLUSTERED_FILTER}
            style={{
              circleRadius: 13,
              circleColor: colors.surface,
            }}
            minZoomLevel={10}
          />
          <CircleLayer
            id="poi-circles"
            filter={UNCLUSTERED_FILTER}
            style={{
              circleRadius: 10,
              circleColor: ["get", "color"],
            }}
            minZoomLevel={10}
          />
          <SymbolLayer
            id="poi-icons"
            filter={UNCLUSTERED_FILTER}
            style={{
              iconImage: ["get", "iconImage"],
              iconSize: POI_MAP_ICON_SYMBOL_SIZE,
              iconColor: POI_ICON_COLOR,
              iconHaloColor: colors.surface,
              iconHaloWidth: 1,
              iconAllowOverlap: true,
              iconIgnorePlacement: true,
            }}
            minZoomLevel={10}
          />
        </ShapeSource>
      )}

      {starred.features.length > 0 && (
        <ShapeSource
          id="poi-starred-source"
          shape={starred}
          onPress={handleStarredPress}
          hitbox={{ width: POI_CLUSTER_HITBOX, height: POI_CLUSTER_HITBOX }}
        >
          {/* Starred POIs: gold ring, larger, visible from zoom 8 — rendered last to be on top */}
          <CircleLayer
            id="poi-starred-outline"
            style={{
              circleRadius: 14,
              circleColor: colors.warning,
            }}
            minZoomLevel={8}
          />
          <CircleLayer
            id="poi-starred-fill"
            style={{
              circleRadius: 10,
              circleColor: ["get", "color"],
            }}
            minZoomLevel={8}
          />
          <SymbolLayer
            id="poi-starred-icons"
            style={{
              iconImage: ["get", "iconImage"],
              iconSize: POI_MAP_ICON_SYMBOL_SIZE,
              iconColor: POI_ICON_COLOR,
              iconHaloColor: colors.surface,
              iconHaloWidth: 1,
              iconAllowOverlap: true,
              iconIgnorePlacement: true,
            }}
            minZoomLevel={8}
          />
        </ShapeSource>
      )}
    </>
  );
}
