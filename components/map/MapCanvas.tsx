import React, { useEffect, useMemo, useState } from "react";
import { useWindowDimensions } from "react-native";
import { Camera, MapView as MapboxMapView, LocationPuck } from "@rnmapbox/maps";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useShallow } from "zustand/react/shallow";
import { SHEET_COMPACT_RATIO, SHEET_EXPANDED_RATIO } from "@/constants";
import { useClimbStore } from "@/store/climbStore";
import { usePanelStore } from "@/store/panelStore";
import { usePoiStore } from "@/store/poiStore";
import {
  createRidingHorizonWindow,
  filterClimbsToRidingHorizon,
  ridingHorizonMetersForMode,
} from "@/utils/ridingHorizon";
import { bucketDistanceForDerivedWork } from "@/utils/distanceBuckets";
import { getClimbMapBounds, getZoomLevelToFitBounds } from "@/utils/climbGeometry";
import { resolveActiveClimb } from "@/utils/climbSelect";
import { isClimbAtLeastDifficulty } from "@/constants/climbHelpers";
import { pickRouteRecords } from "@/utils/routeScopedRecords";
import RouteLayer from "./RouteLayer";
import RouteMarkerLayer from "./RouteMarkerLayer";
import POILayer from "./POILayer";
import ClimbHighlightLayer from "./ClimbHighlightLayer";
import TemperatureRouteOverlay from "./TemperatureRouteOverlay";
import VariantOverlayLayer, { type VariantOverlay } from "./VariantOverlayLayer";
import type {
  POIMapVisibility,
  RoutePoint,
  StitchedSegmentInfo,
  WeatherPoint,
  WeatherTemperatureDisplayMode,
} from "@/types";

const CLIMB_PAN_PADDING = {
  top: 72,
  right: 32,
  bottom: 40,
  left: 32,
};

export type MapOverlayMode = "normal" | "climbs" | "weather";

export interface MapCanvasRouteLayer {
  id: string;
  key: string;
  isActive: boolean;
  geoJSON: GeoJSON.Feature<GeoJSON.LineString>;
}

interface MapCanvasProps {
  mapRef: React.RefObject<MapboxMapView | null>;
  cameraRef: React.RefObject<Camera | null>;
  lastCamera: React.MutableRefObject<{ center: [number, number]; zoom: number }>;
  initialCamera: { center: [number, number]; zoom: number };
  mapStyle: {
    props: { styleJSON: string } | { styleURL: string };
    styleKey: string;
  };
  cameraPadding: {
    paddingTop: number;
    paddingLeft: number;
    paddingRight: number;
    paddingBottom: number;
  };
  pulsingConfig: { isEnabled: boolean; color: string; radius: number };
  routeLayers: MapCanvasRouteLayer[];
  routeStackKey: string;
  activeRoutePoints: RoutePoint[] | null;
  activeRouteIds: string[];
  activeSegments: StitchedSegmentInfo[] | null;
  activeDataId: string | null;
  activeContextKey: string | null;
  activeTotalDistanceMeters: number | null;
  activeProgressDistanceMeters: number | null;
  mapOverlayMode: MapOverlayMode;
  activeVariantOverlays: VariantOverlay[];
  weatherRouteId: string | null;
  weatherTimeline: WeatherPoint[];
  weatherTemperatureMode: WeatherTemperatureDisplayMode;
  showDistanceMarkers: boolean;
  poiVisibility: POIMapVisibility;
  onTouchStart: () => void;
  onCameraChanged: (state: { properties: { center: number[]; zoom: number } }) => void;
  onClusterPress: (center: [number, number], zoomLevel: number) => void;
  setFollowUser: (follow: boolean) => void;
}

function MapCanvas({
  mapRef,
  cameraRef,
  lastCamera,
  initialCamera,
  mapStyle,
  cameraPadding,
  pulsingConfig,
  routeLayers,
  routeStackKey,
  activeRoutePoints,
  activeRouteIds,
  activeSegments,
  activeDataId,
  activeContextKey,
  activeTotalDistanceMeters,
  activeProgressDistanceMeters,
  mapOverlayMode,
  activeVariantOverlays,
  weatherRouteId,
  weatherTimeline,
  weatherTemperatureMode,
  showDistanceMarkers,
  poiVisibility,
  onTouchStart,
  onCameraChanged,
  onClusterPress,
  setFollowUser,
}: MapCanvasProps) {
  const selectedPOI = usePoiStore((s) => s.selectedPOI);
  const [highlightedClimbId, setHighlightedClimbId] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedPOI) return;
    setFollowUser(false);
    cameraRef.current?.setCamera({
      centerCoordinate: [selectedPOI.longitude, selectedPOI.latitude],
      zoomLevel: 14,
      animationDuration: 500,
    });
  }, [cameraRef, selectedPOI, setFollowUser]);

  const hasClimbHighlight = highlightedClimbId != null;
  const climbStackKey = `${routeStackKey}-${highlightedClimbId ?? "none"}`;
  const hasWeatherTemperatureOverlay =
    mapOverlayMode === "weather" &&
    activeRoutePoints != null &&
    weatherRouteId === activeDataId &&
    weatherTimeline.length > 1;
  const weatherStackKey = hasWeatherTemperatureOverlay ? "weather:on" : "weather:off";
  const overlayStackKey = `${climbStackKey}-${activeContextKey ?? "none"}-markers:${
    showDistanceMarkers ? "on" : "off"
  }-${weatherStackKey}-pois:${poiVisibility}`;

  return (
    <MapboxMapView
      ref={mapRef}
      style={{ flex: 1 }}
      {...mapStyle.props}
      compassEnabled={false}
      scaleBarEnabled={false}
      rotateEnabled={false}
      pitchEnabled={false}
      onTouchStart={onTouchStart}
      onCameraChanged={onCameraChanged}
    >
      <Camera
        ref={cameraRef}
        defaultSettings={{
          centerCoordinate: initialCamera.center,
          zoomLevel: initialCamera.zoom,
        }}
        animationDuration={500}
        padding={cameraPadding}
      />
      {routeLayers.map((route) => (
        <RouteLayer
          key={route.key}
          routeId={route.id}
          geoJSON={route.geoJSON}
          isActive={route.isActive}
          dimmed={hasClimbHighlight}
        />
      ))}
      {activeVariantOverlays.length > 0 && (
        <VariantOverlayLayer
          key={`collection-variants-${routeStackKey}`}
          overlays={activeVariantOverlays}
        />
      )}
      <ClimbMapOverlay
        cameraRef={cameraRef}
        lastCamera={lastCamera}
        routeStackKey={routeStackKey}
        activeRoutePoints={activeRoutePoints}
        activeRouteIds={activeRouteIds}
        activeSegments={activeSegments}
        activeTotalDistanceMeters={activeTotalDistanceMeters}
        activeProgressDistanceMeters={activeProgressDistanceMeters}
        mapOverlayMode={mapOverlayMode}
        onHighlightedClimbIdChange={setHighlightedClimbId}
        setFollowUser={setFollowUser}
      />
      {hasWeatherTemperatureOverlay && activeRoutePoints && (
        <TemperatureRouteOverlay
          key={`weather-temperature-${overlayStackKey}`}
          points={activeRoutePoints}
          timeline={weatherTimeline}
          temperatureMode={weatherTemperatureMode}
        />
      )}
      <RouteMarkerLayer
        key={`route-markers-${overlayStackKey}`}
        points={activeRoutePoints ?? []}
        showDistanceMarkers={showDistanceMarkers}
      />
      {(poiVisibility !== "none" || selectedPOI) && activeRouteIds.length > 0 && (
        <POILayer
          key={`pois-${overlayStackKey}`}
          routeIds={activeRouteIds}
          segments={activeSegments}
          currentDistanceMeters={activeProgressDistanceMeters}
          onClusterPress={onClusterPress}
          visibility={poiVisibility}
        />
      )}
      <LocationPuck
        key={`puck-${overlayStackKey}`}
        puckBearing="heading"
        puckBearingEnabled
        pulsing={pulsingConfig}
      />
    </MapboxMapView>
  );
}

interface ClimbMapOverlayProps {
  cameraRef: React.RefObject<Camera | null>;
  lastCamera: React.MutableRefObject<{ center: [number, number]; zoom: number }>;
  routeStackKey: string;
  activeRoutePoints: RoutePoint[] | null;
  activeRouteIds: string[];
  activeSegments: StitchedSegmentInfo[] | null;
  activeTotalDistanceMeters: number | null;
  activeProgressDistanceMeters: number | null;
  mapOverlayMode: MapOverlayMode;
  onHighlightedClimbIdChange: (id: string | null) => void;
  setFollowUser: (follow: boolean) => void;
}

function ClimbMapOverlay({
  cameraRef,
  lastCamera,
  routeStackKey,
  activeRoutePoints,
  activeRouteIds,
  activeSegments,
  activeTotalDistanceMeters,
  activeProgressDistanceMeters,
  mapOverlayMode,
  onHighlightedClimbIdChange,
  setFollowUser,
}: ClimbMapOverlayProps) {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const { bottom: safeBottom } = useSafeAreaInsets();
  const selectedClimb = useClimbStore((s) => s.selectedClimb);
  const minimumDifficulty = useClimbStore((s) => s.minimumDifficulty);
  const getClimbsForDisplay = useClimbStore((s) => s.getClimbsForDisplay);
  const routeClimbs = useClimbStore(useShallow((s) => pickRouteRecords(s.climbs, activeRouteIds)));
  const panelMode = usePanelStore((s) => s.panelMode);
  const isPanelExpanded = usePanelStore((s) => s.isExpanded);
  const compactPanelHeight = Math.round(screenHeight * SHEET_COMPACT_RATIO) + safeBottom;
  const expandedPanelHeight = Math.round(screenHeight * SHEET_EXPANDED_RATIO) + safeBottom;
  const overlayPanelHeight = isPanelExpanded ? expandedPanelHeight : compactPanelHeight;
  const derivedProgressDistanceMeters = bucketDistanceForDerivedWork(activeProgressDistanceMeters);

  const climbHorizonWindow = useMemo(
    () =>
      createRidingHorizonWindow(
        derivedProgressDistanceMeters,
        ridingHorizonMetersForMode(panelMode),
        { totalDistanceMeters: activeTotalDistanceMeters ?? undefined },
      ),
    [derivedProgressDistanceMeters, panelMode, activeTotalDistanceMeters],
  );

  const highlightedClimb = useMemo(() => {
    if (mapOverlayMode !== "climbs") return null;
    const displayed = filterClimbsToRidingHorizon(
      getClimbsForDisplay(activeRouteIds, activeSegments),
      climbHorizonWindow,
    ).filter((climb) => isClimbAtLeastDifficulty(climb.difficultyScore, minimumDifficulty));
    const selected =
      selectedClimb && displayed.some((climb) => climb.id === selectedClimb.id)
        ? selectedClimb
        : null;
    return resolveActiveClimb(displayed, derivedProgressDistanceMeters, selected);
    // routeClimbs is a reactivity trigger: getClimbsForDisplay reads store via get()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    mapOverlayMode,
    selectedClimb,
    activeRouteIds,
    activeSegments,
    derivedProgressDistanceMeters,
    minimumDifficulty,
    climbHorizonWindow,
    routeClimbs,
    getClimbsForDisplay,
  ]);

  useEffect(() => {
    onHighlightedClimbIdChange(highlightedClimb?.id ?? null);
  }, [highlightedClimb?.id, onHighlightedClimbIdChange]);

  useEffect(() => {
    if (!highlightedClimb || !activeRoutePoints?.length) return;
    const climbBounds = getClimbMapBounds(
      activeRoutePoints,
      highlightedClimb.effectiveStartDistanceMeters,
      highlightedClimb.effectiveEndDistanceMeters,
    );
    if (!climbBounds) return;

    setFollowUser(false);
    cameraRef.current?.setCamera({
      centerCoordinate: climbBounds.center,
      padding: {
        paddingTop: 0,
        paddingRight: 0,
        paddingBottom: overlayPanelHeight,
        paddingLeft: 0,
      },
      zoomLevel: getZoomLevelToFitBounds(
        lastCamera.current.zoom,
        climbBounds,
        screenWidth,
        screenHeight,
        {
          top: CLIMB_PAN_PADDING.top,
          right: CLIMB_PAN_PADDING.right,
          bottom: overlayPanelHeight + CLIMB_PAN_PADDING.bottom,
          left: CLIMB_PAN_PADDING.left,
        },
      ),
      animationMode: "easeTo",
      animationDuration: 500,
    });
  }, [
    highlightedClimb,
    activeRoutePoints,
    cameraRef,
    lastCamera,
    overlayPanelHeight,
    screenHeight,
    screenWidth,
    setFollowUser,
  ]);

  if (!highlightedClimb || !activeRoutePoints) return null;

  return (
    <ClimbHighlightLayer
      key={`climb-${highlightedClimb.id}-${routeStackKey}`}
      climb={highlightedClimb}
      points={activeRoutePoints}
    />
  );
}

export default React.memo(MapCanvas);
