import React, { useMemo, useCallback } from "react";
import { ShapeSource, CircleLayer } from "@rnmapbox/maps";
import { usePoiStore } from "@/store/poiStore";
import { useThemeColors } from "@/theme";
import { POI_CATEGORIES } from "@/constants";
import { haversineDistance } from "@/utils/geo";
import { toDisplayPOIs } from "@/services/displayDistance";
import { stitchPOIs } from "@/services/stitchingService";
import type { DisplayPOI, POI, StitchedSegmentInfo } from "@/types";

const categoryColorMap = Object.fromEntries(POI_CATEGORIES.map((c) => [c.key, c.color]));

interface POILayerProps {
  routeIds: string[];
  segments: StitchedSegmentInfo[] | null;
}

export default function POILayer({ routeIds, segments }: POILayerProps) {
  const getVisiblePOIs = usePoiStore((s) => s.getVisiblePOIs);
  const enabledCategories = usePoiStore((s) => s.enabledCategories);
  const starredPOIIds = usePoiStore((s) => s.starredPOIIds);
  const allPois = usePoiStore((s) => s.pois);
  const setSelectedPOI = usePoiStore((s) => s.setSelectedPOI);
  const colors = useThemeColors();

  const visiblePOIs = useMemo(() => {
    if (segments) {
      const poisByRoute: Record<string, POI[]> = {};
      for (const routeId of routeIds) {
        poisByRoute[routeId] = getVisiblePOIs(routeId);
      }
      return stitchPOIs(segments, poisByRoute);
    }

    const combined: DisplayPOI[] = [];
    for (const routeId of routeIds) {
      combined.push(...toDisplayPOIs(getVisiblePOIs(routeId)));
    }
    return combined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeIds, segments, allPois, enabledCategories, starredPOIIds]);

  const geoJSON = useMemo(
    (): GeoJSON.FeatureCollection => ({
      type: "FeatureCollection",
      features: visiblePOIs.map((poi) => ({
        type: "Feature",
        properties: {
          poiId: poi.id,
          category: poi.category,
          color: categoryColorMap[poi.category] ?? "#888888",
          name: poi.name ?? "",
          starred: starredPOIIds.has(poi.id) ? 1 : 0,
        },
        geometry: {
          type: "Point",
          coordinates: [poi.longitude, poi.latitude],
        },
      })),
    }),
    [visiblePOIs, starredPOIIds],
  );

  const handlePress = useCallback(
    (event: any) => {
      const features = event?.features;
      if (!features?.length) return;

      // When multiple features overlap, pick the one closest to the tap point
      const tapCoord = event?.coordinates;
      let bestPoi: DisplayPOI | undefined;

      if (tapCoord && features.length > 1) {
        let bestDist = Infinity;
        for (const feature of features) {
          const id = feature?.properties?.poiId;
          if (!id) continue;
          const poi = visiblePOIs.find((p) => p.id === id);
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
      } else {
        const id = features[0]?.properties?.poiId;
        if (id) bestPoi = visiblePOIs.find((p) => p.id === id);
      }

      if (bestPoi) setSelectedPOI(bestPoi);
    },
    [visiblePOIs, setSelectedPOI],
  );

  if (visiblePOIs.length === 0) return null;

  return (
    <ShapeSource
      id="poi-source"
      shape={geoJSON}
      onPress={handlePress}
      hitbox={{ width: 16, height: 16 }}
    >
      {/* Regular POIs: surface-colored ring, visible from zoom 10 */}
      <CircleLayer
        id="poi-circles-outline"
        filter={["==", ["get", "starred"], 0]}
        style={{
          circleRadius: 7,
          circleColor: colors.surface,
        }}
        minZoomLevel={10}
      />
      <CircleLayer
        id="poi-circles"
        filter={["==", ["get", "starred"], 0]}
        style={{
          circleRadius: 5,
          circleColor: ["get", "color"],
        }}
        minZoomLevel={10}
      />

      {/* Starred POIs: gold ring, larger, visible from zoom 8 — rendered last to be on top */}
      <CircleLayer
        id="poi-starred-outline"
        filter={["==", ["get", "starred"], 1]}
        style={{
          circleRadius: 10,
          circleColor: colors.warning,
        }}
        minZoomLevel={8}
      />
      <CircleLayer
        id="poi-starred-fill"
        filter={["==", ["get", "starred"], 1]}
        style={{
          circleRadius: 7,
          circleColor: ["get", "color"],
        }}
        minZoomLevel={8}
      />
    </ShapeSource>
  );
}
