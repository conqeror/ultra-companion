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
  POI_MAP_ICON_SYMBOL_SIZE,
} from "@/constants";
import { haversineDistance } from "@/utils/geo";
import { toDisplayPOIs } from "@/services/displayDistance";
import { stitchPOIs } from "@/services/stitchingService";
import { buildPOIMapFeatureCollections } from "@/utils/poiMapFeatures";
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

export default function POILayer({
  routeIds,
  segments,
  currentDistanceMeters,
  onClusterPress,
}: POILayerProps) {
  const clusteredSourceRef = useRef<ShapeSource>(null);
  const getVisiblePOIs = usePoiStore((s) => s.getVisiblePOIs);
  const enabledCategories = usePoiStore((s) => s.enabledCategories);
  const starredPOIIds = usePoiStore((s) => s.starredPOIIds);
  const allPois = usePoiStore((s) => s.pois);
  const setSelectedPOI = usePoiStore((s) => s.setSelectedPOI);
  const panelMode = usePanelStore((s) => s.panelMode);
  const colors = useThemeColors();

  const visiblePOIs = useMemo(() => {
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
      return stitchPOIs(segments, poisByRoute, distanceWindow);
    }

    const combined: DisplayPOI[] = [];
    for (const routeId of routeIds) {
      const routePois = getVisiblePOIs(routeId).filter((poi) =>
        isDistanceInWindow(poi.distanceAlongRouteMeters, distanceWindow),
      );
      combined.push(...toDisplayPOIs(routePois));
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
          onPress={handleClusteredPress}
          hitbox={{ width: POI_CLUSTER_HITBOX, height: POI_CLUSTER_HITBOX }}
        >
          <CircleLayer
            id="poi-clusters"
            filter={CLUSTER_FILTER}
            style={{
              circleRadius: ["step", ["get", "point_count"], 13, 10, 16, 50, 19],
              circleColor: colors.accent,
              circleStrokeWidth: 2,
              circleStrokeColor: colors.surface,
            }}
            minZoomLevel={POI_CLUSTER_MIN_ZOOM}
          />
          <SymbolLayer
            id="poi-cluster-count"
            filter={CLUSTER_FILTER}
            style={{
              textField: ["get", "point_count_abbreviated"],
              textSize: 12,
              textColor: colors.accentForeground,
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
