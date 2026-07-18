import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { ActivityIndicator, View } from "react-native";
import Mapbox, {
  Camera,
  CircleLayer,
  LineLayer,
  MapView as MapboxMapView,
  ShapeSource,
  SymbolLayer,
} from "@rnmapbox/maps";
import Constants from "expo-constants";
import { MAP_LAYER_ANCHOR_IDS } from "@/constants/mapLayers";
import { useMapStyle } from "@/hooks/useMapStyle";
import {
  isRouteGeometryRequestRenderable,
  preparedRouteGeometryHasError,
  preparedRouteGeometryMatchesSource,
  preparedRouteGeometryRequestListsMatchSource,
  usePreparedRouteGeometries,
  type PreparedRouteGeometryRequest,
} from "@/hooks/usePreparedRouteGeometries";
import { useRouteGeometryZoom } from "@/hooks/useRouteGeometryZoom";
import { allocateMapCoordinateBudget, MAX_ROUTE_MAP_GEOJSON_POINTS } from "@/utils/geo";
import { buildFerryMapFeatureCollections } from "@/utils/ferryMapFeatures";
import { ferryMapGeometrySignature } from "@/services/ferryGeometry";
import type { DisplayFerryCrossing, RoutePoint } from "@/types";
import { Text } from "@/components/ui/text";
import { useThemeColors } from "@/theme";
import FerryCrossingLayer from "./FerryCrossingLayer";
import MapLayerAnchors from "./MapLayerAnchors";
import RouteLayer from "./RouteLayer";

try {
  const mapboxToken = Constants.expoConfig?.extra?.mapboxAccessToken;
  if (mapboxToken) {
    Mapbox.setAccessToken(mapboxToken);
  }
} catch (e) {
  console.warn("Failed to set Mapbox access token:", e);
}

export interface RoutePreviewMapLayer {
  id: string;
  points: RoutePoint[];
  isActive: boolean;
  cacheKey?: string;
  /** Already bounded display geometry, used for collection variant overlays. */
  geoJSON?: GeoJSON.Feature<GeoJSON.LineString>;
}

interface RoutePreviewMapProps {
  layers: RoutePreviewMapLayer[];
  ferries?: readonly DisplayFerryCrossing[];
  onMapPress?: (coordinate: { latitude: number; longitude: number }) => void;
  selectionPoints?: RoutePoint[];
  accessibilityLabel?: string;
}

const FIT_PADDING = 40;
const EMPTY_SELECTION_POINTS: RoutePoint[] = [];
const EMPTY_FERRIES: DisplayFerryCrossing[] = [];

interface PreviewFitSource {
  preparedRequests: PreparedRouteGeometryRequest[];
  directGeometryKey: string;
  ferryGeometryKey: string;
}

function previewFitSourcesMatch(a: PreviewFitSource, b: PreviewFitSource): boolean {
  return (
    a.directGeometryKey === b.directGeometryKey &&
    a.ferryGeometryKey === b.ferryGeometryKey &&
    preparedRouteGeometryRequestListsMatchSource(a.preparedRequests, b.preparedRequests)
  );
}

export default function RoutePreviewMap({
  layers,
  ferries = EMPTY_FERRIES,
  onMapPress,
  selectionPoints = EMPTY_SELECTION_POINTS,
  accessibilityLabel = "Route preview map",
}: RoutePreviewMapProps) {
  const cameraRef = useRef<Camera>(null);
  const fittedSourceRef = useRef<PreviewFitSource | null>(null);
  const mapStyle = useMapStyle();
  const colors = useThemeColors();
  const { routeGeometryToleranceMeters, updateRouteGeometryZoom } = useRouteGeometryZoom();

  const visibleLayers = useMemo(
    () =>
      layers.filter(
        (layer) =>
          layer.points.length >= 2 || (layer.geoJSON?.geometry.coordinates.length ?? 0) >= 2,
      ),
    [layers],
  );
  const ferryMapFeatures = useMemo(() => buildFerryMapFeatureCollections(ferries), [ferries]);

  const routeGeometryRequests = useMemo<PreparedRouteGeometryRequest[]>(() => {
    const layersToPrepare = visibleLayers.filter((layer) => !layer.geoJSON);
    const budgets = allocateMapCoordinateBudget(
      layersToPrepare.map((layer) => layer.points.length),
      MAX_ROUTE_MAP_GEOJSON_POINTS,
    );
    return layersToPrepare.map((layer, index) => ({
      id: layer.id,
      cacheKey: layer.cacheKey ?? layer.id,
      points: layer.points,
      toleranceMeters: routeGeometryToleranceMeters,
      maxPoints: budgets[index],
    }));
  }, [routeGeometryToleranceMeters, visibleLayers]);
  const preparedRouteGeometries = usePreparedRouteGeometries(routeGeometryRequests);
  const isPreparing = routeGeometryRequests.some(
    (request) =>
      isRouteGeometryRequestRenderable(request) &&
      !preparedRouteGeometryMatchesSource(preparedRouteGeometries[request.id], request),
  );
  const hasPreparationError = routeGeometryRequests.some((request) =>
    preparedRouteGeometryHasError(preparedRouteGeometries[request.id], request),
  );
  const renderedRouteGeometries = useMemo(
    () =>
      Object.fromEntries(
        visibleLayers.flatMap((layer) => {
          const geoJSON = layer.geoJSON ?? preparedRouteGeometries[layer.id]?.geoJSON;
          return geoJSON ? [[layer.id, geoJSON] as const] : [];
        }),
      ),
    [preparedRouteGeometries, visibleLayers],
  );
  const fitSource = useMemo<PreviewFitSource>(
    () => ({
      preparedRequests: routeGeometryRequests,
      directGeometryKey: visibleLayers
        .filter((layer) => layer.geoJSON)
        .map((layer) => `${layer.id}:${layer.cacheKey ?? layer.id}`)
        .join("|"),
      ferryGeometryKey: ferryMapGeometrySignature(ferries),
    }),
    [ferries, routeGeometryRequests, visibleLayers],
  );
  const bounds = useMemo(() => {
    let minLongitude = Infinity;
    let minLatitude = Infinity;
    let maxLongitude = -Infinity;
    let maxLatitude = -Infinity;
    for (const layer of visibleLayers) {
      const coordinates = renderedRouteGeometries[layer.id]?.geometry.coordinates ?? [];
      for (const coordinate of coordinates) {
        if (!Number.isFinite(coordinate[0]) || !Number.isFinite(coordinate[1])) continue;
        minLongitude = Math.min(minLongitude, coordinate[0]);
        minLatitude = Math.min(minLatitude, coordinate[1]);
        maxLongitude = Math.max(maxLongitude, coordinate[0]);
        maxLatitude = Math.max(maxLatitude, coordinate[1]);
      }
    }
    for (const feature of ferryMapFeatures.lines.features) {
      for (const coordinate of feature.geometry.coordinates) {
        if (!Number.isFinite(coordinate[0]) || !Number.isFinite(coordinate[1])) continue;
        minLongitude = Math.min(minLongitude, coordinate[0]);
        minLatitude = Math.min(minLatitude, coordinate[1]);
        maxLongitude = Math.max(maxLongitude, coordinate[0]);
        maxLatitude = Math.max(maxLatitude, coordinate[1]);
      }
    }
    if (!Number.isFinite(minLongitude) || !Number.isFinite(minLatitude)) return null;
    return {
      ne: [maxLongitude, maxLatitude] as [number, number],
      sw: [minLongitude, minLatitude] as [number, number],
    };
  }, [ferryMapFeatures.lines.features, renderedRouteGeometries, visibleLayers]);

  useEffect(() => {
    if (!bounds || isPreparing) return;
    const fittedSource = fittedSourceRef.current;
    if (fittedSource && previewFitSourcesMatch(fittedSource, fitSource)) return;
    cameraRef.current?.setCamera({
      bounds: {
        ne: bounds.ne,
        sw: bounds.sw,
        paddingLeft: FIT_PADDING,
        paddingRight: FIT_PADDING,
        paddingTop: FIT_PADDING,
        paddingBottom: FIT_PADDING,
      },
      animationDuration: 300,
    });
    fittedSourceRef.current = fitSource;
  }, [bounds, fitSource, isPreparing]);

  const handleCameraChanged = useCallback(
    (state: { properties: { zoom: number } }) => {
      updateRouteGeometryZoom(state.properties.zoom);
    },
    [updateRouteGeometryZoom],
  );

  const selectionLine = useMemo<GeoJSON.Feature<GeoJSON.LineString> | null>(
    () =>
      selectionPoints.length >= 2
        ? {
            type: "Feature",
            properties: {},
            geometry: {
              type: "LineString",
              coordinates: selectionPoints.map((point) => [point.longitude, point.latitude]),
            },
          }
        : null,
    [selectionPoints],
  );
  const selectionEndpoints = useMemo<GeoJSON.FeatureCollection<GeoJSON.Point> | null>(() => {
    if (selectionPoints.length === 0) return null;
    const points =
      selectionPoints.length === 1
        ? [selectionPoints[0]]
        : [selectionPoints[0], selectionPoints[selectionPoints.length - 1]];
    return {
      type: "FeatureCollection",
      features: points.map((point, index) => ({
        type: "Feature",
        properties: { order: index + 1, label: index === 0 ? "B" : "L" },
        geometry: { type: "Point", coordinates: [point.longitude, point.latitude] },
      })),
    };
  }, [selectionPoints]);

  return (
    <View className="flex-1">
      <MapboxMapView
        style={{ flex: 1 }}
        {...mapStyle.props}
        compassEnabled={false}
        scaleBarEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
        scrollEnabled={true}
        zoomEnabled={true}
        onCameraChanged={handleCameraChanged}
        accessible
        accessibilityLabel={accessibilityLabel}
        onPress={(event) => {
          if (!onMapPress || event.geometry.type !== "Point") return;
          const coordinates = event.geometry.coordinates;
          onMapPress({ latitude: coordinates[1], longitude: coordinates[0] });
        }}
      >
        <Camera ref={cameraRef} />
        <MapLayerAnchors key={`map-layer-anchors-${mapStyle.styleKey}`} />
        {visibleLayers.map((layer) => {
          const geoJSON = renderedRouteGeometries[layer.id];
          if (!geoJSON) return null;
          return (
            <RouteLayer
              key={`${layer.id}-${mapStyle.styleKey}`}
              routeId={layer.id}
              geoJSON={geoJSON}
              isActive={layer.isActive}
              aboveLayerID={MAP_LAYER_ANCHOR_IDS.routeLine}
            />
          );
        })}
        <FerryCrossingLayer ferries={ferries} />
        {selectionLine && (
          <ShapeSource id="ferry-selection-line-source" shape={selectionLine}>
            <LineLayer
              id="ferry-selection-line"
              aboveLayerID={MAP_LAYER_ANCHOR_IDS.routeLine}
              style={{
                lineColor: colors.info,
                lineWidth: 7,
                lineOpacity: 0.95,
                lineDasharray: [1.2, 1.2],
                lineCap: "round",
              }}
            />
          </ShapeSource>
        )}
        {selectionEndpoints && (
          <ShapeSource id="ferry-selection-endpoints-source" shape={selectionEndpoints}>
            <CircleLayer
              id="ferry-selection-endpoints"
              aboveLayerID="ferry-selection-line"
              style={{
                circleColor: colors.info,
                circleRadius: 7,
                circleStrokeColor: colors.surface,
                circleStrokeWidth: 3,
              }}
            />
            <SymbolLayer
              id="ferry-selection-endpoint-labels"
              aboveLayerID="ferry-selection-endpoints"
              style={{
                textField: ["get", "label"],
                textSize: 11,
                textColor: colors.surface,
                textAllowOverlap: true,
                textIgnorePlacement: true,
              }}
            />
          </ShapeSource>
        )}
      </MapboxMapView>
      {(isPreparing || hasPreparationError) && (
        <View
          pointerEvents="none"
          className={
            isPreparing
              ? "absolute inset-0 items-center justify-center bg-background/60"
              : "absolute left-4 right-4 top-4 items-center"
          }
          accessible
          accessibilityRole={isPreparing ? "progressbar" : "alert"}
          accessibilityLiveRegion="polite"
          accessibilityLabel={
            isPreparing ? "Preparing route preview" : "Couldn’t prepare the route preview"
          }
        >
          <View
            className={
              isPreparing
                ? "items-center"
                : "rounded-full border border-border bg-card px-3 py-2 shadow-sm"
            }
          >
            {isPreparing && <ActivityIndicator size="small" color={colors.accent} />}
            <Text
              className={`${isPreparing ? "mt-2 text-foreground" : "text-destructive"} text-[13px] font-barlow-medium`}
            >
              {isPreparing ? "Preparing preview…" : "Couldn’t prepare the route preview"}
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}
