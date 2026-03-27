import React, { useMemo, useCallback } from "react";
import { ShapeSource, CircleLayer } from "@rnmapbox/maps";
import { usePoiStore } from "@/store/poiStore";
import { useThemeColors } from "@/theme";
import { POI_CATEGORIES } from "@/constants";
import { haversineDistance } from "@/utils/geo";
import type { POI } from "@/types";

const categoryColorMap = Object.fromEntries(
  POI_CATEGORIES.map((c) => [c.key, c.color]),
);

interface POILayerProps {
  routeId: string;
}

export default function POILayer({ routeId }: POILayerProps) {
  const getVisiblePOIs = usePoiStore((s) => s.getVisiblePOIs);
  const enabledCategories = usePoiStore((s) => s.enabledCategories);
  const starredPOIIds = usePoiStore((s) => s.starredPOIIds);
  const pois = usePoiStore((s) => s.pois[routeId]);
  const setSelectedPOI = usePoiStore((s) => s.setSelectedPOI);
  const colors = useThemeColors();

  const visiblePOIs = useMemo(
    () => getVisiblePOIs(routeId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [routeId, pois, enabledCategories, starredPOIIds],
  );

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
        },
        geometry: {
          type: "Point",
          coordinates: [poi.longitude, poi.latitude],
        },
      })),
    }),
    [visiblePOIs],
  );

  const handlePress = useCallback(
    (event: any) => {
      const features = event?.features;
      if (!features?.length) return;

      // When multiple features overlap, pick the one closest to the tap point
      const tapCoord = event?.coordinates;
      let bestPoi: POI | undefined;

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
      <CircleLayer
        id="poi-circles-outline"
        style={{
          circleRadius: 7,
          circleColor: colors.surface,
        }}
        minZoomLevel={10}
      />
      <CircleLayer
        id="poi-circles"
        style={{
          circleRadius: 5,
          circleColor: ["get", "color"],
        }}
        minZoomLevel={10}
      />
    </ShapeSource>
  );
}
