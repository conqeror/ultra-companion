import React, { useRef, useCallback, useEffect, useState, useMemo } from "react";
import { View, AppState, useWindowDimensions } from "react-native";
import Mapbox, { Camera, MapView as MapboxMapView, LocationPuck } from "@rnmapbox/maps";
import Constants from "expo-constants";
import { useMapStore } from "@/store/mapStore";
import { useRouteStore } from "@/store/routeStore";
import { useCollectionStore } from "@/store/collectionStore";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePanelStore } from "@/store/panelStore";
import { SHEET_COMPACT_RATIO, SHEET_EXPANDED_RATIO } from "@/constants";
import { useThemeColors } from "@/theme";
import { useMapStyle } from "@/hooks/useMapStyle";
import { useRouteGeometryZoom } from "@/hooks/useRouteGeometryZoom";
import { GPS_STALE_THRESHOLD_MS } from "@/constants";
import MapControls from "./MapControls";
import RouteLayer from "./RouteLayer";
import POILayer from "./POILayer";
import ClimbHighlightLayer from "./ClimbHighlightLayer";
import TabbedBottomPanel from "./TabbedBottomPanel";
import { resolveActiveClimb } from "@/utils/climbSelect";
import { getClimbMapBounds, getZoomLevelToFitBounds } from "@/utils/climbGeometry";
import { isClimbAtLeastDifficulty } from "@/constants/climbHelpers";
import { resolveActiveRouteProgress } from "@/utils/routeProgress";
import {
  createRidingHorizonWindow,
  filterClimbsToRidingHorizon,
  ridingHorizonMetersForMode,
} from "@/utils/ridingHorizon";
import { snapToRouteDetailed } from "@/services/routeSnapping";
import { useActiveRouteData, getActiveRouteDataImperative } from "@/hooks/useActiveRouteData";
import { usePoiStore } from "@/store/poiStore";
import { useClimbStore } from "@/store/climbStore";
import { useEtaStore } from "@/store/etaStore";
import { useWeatherStore } from "@/store/weatherStore";
import { useOfflineStore } from "@/store/offlineStore";
import type { RoutePoint, UserPosition } from "@/types";

const CLIMB_PAN_PADDING = {
  top: 72,
  right: 32,
  bottom: 40,
  left: 32,
};

// Initialize Mapbox with access token from app config
try {
  const mapboxToken = Constants.expoConfig?.extra?.mapboxAccessToken;
  if (mapboxToken) {
    Mapbox.setAccessToken(mapboxToken);
  }
} catch (e) {
  console.warn("Failed to set Mapbox access token:", e);
}

export default function MapScreen() {
  const themeColors = useThemeColors();
  const mapStyle = useMapStyle();
  const cameraRef = useRef<Camera>(null);
  const mapRef = useRef<MapboxMapView>(null);
  const [hasGpsFix, setHasGpsFix] = useState(false);
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();

  const followUser = useMapStore((s) => s.followUser);
  const setFollowUser = useMapStore((s) => s.setFollowUser);
  const refreshPosition = useMapStore((s) => s.refreshPosition);
  const persistCamera = useMapStore((s) => s.persistCamera);
  const initialCamera = useRef({
    center: useMapStore.getState().center,
    zoom: useMapStore.getState().zoom,
  });
  const lastCamera = useRef(initialCamera.current);
  const { routeGeometryZoom, updateRouteGeometryZoom } = useRouteGeometryZoom(
    initialCamera.current.zoom,
  );
  const panelTab = usePanelStore((s) => s.panelTab);
  const panelMode = usePanelStore((s) => s.panelMode);
  const isPanelExpanded = usePanelStore((s) => s.isExpanded);
  const { bottom: safeBottom } = useSafeAreaInsets();
  const compactPanelHeight = Math.round(screenHeight * SHEET_COMPACT_RATIO) + safeBottom;
  const expandedPanelHeight = Math.round(screenHeight * SHEET_EXPANDED_RATIO) + safeBottom;
  const overlayPanelHeight = isPanelExpanded ? expandedPanelHeight : compactPanelHeight;

  const routes = useRouteStore((s) => s.routes);
  const visibleRoutePoints = useRouteStore((s) => s.visibleRoutePoints);
  const loadRouteMetadata = useRouteStore((s) => s.loadRouteMetadata);
  const loadRoutePoints = useRouteStore((s) => s.loadRoutePoints);
  const snappedPosition = useRouteStore((s) => s.snappedPosition);
  const setSnappedPosition = useRouteStore((s) => s.setSnappedPosition);
  const recordSnapHistory = useRouteStore((s) => s.recordSnapHistory);
  const clearRouteProgress = useRouteStore((s) => s.clearRouteProgress);
  const loadCollections = useCollectionStore((s) => s.loadCollections);
  const loadPOIs = usePoiStore((s) => s.loadPOIs);
  const computeETAForRoute = useEtaStore((s) => s.computeETAForRoute);
  const cumulativeTime = useEtaStore((s) => s.cumulativeTime);
  const fetchWeather = useWeatherStore((s) => s.fetchWeather);
  const isConnected = useOfflineStore((s) => s.isConnected);

  // Unified active context — works for both standalone routes and collections
  const activeData = useActiveRouteData();
  const activeRoutePoints = activeData?.points ?? null;
  const activeRouteIds = useMemo(() => activeData?.routeIds ?? [], [activeData?.routeIds]);
  const activeRouteIdsKey = useMemo(() => activeRouteIds.join(","), [activeRouteIds]);
  const activeRouteProgress = useMemo(
    () => resolveActiveRouteProgress(activeData, snappedPosition),
    [activeData, snappedPosition],
  );
  const activeProgressDistanceMeters = activeRouteProgress?.distanceAlongRouteMeters ?? null;
  const climbHorizonWindow = useMemo(
    () =>
      createRidingHorizonWindow(
        activeProgressDistanceMeters,
        ridingHorizonMetersForMode(panelMode),
        { totalDistanceMeters: activeData?.totalDistanceMeters },
      ),
    [activeProgressDistanceMeters, panelMode, activeData?.totalDistanceMeters],
  );

  useEffect(() => {
    loadRouteMetadata();
    loadCollections();
  }, [loadRouteMetadata, loadCollections]);

  const activeStandaloneRouteId = useMemo(
    () => routes.find((route) => route.isActive)?.id ?? null,
    [routes],
  );

  useEffect(() => {
    if (!activeStandaloneRouteId) return;
    loadRoutePoints([activeStandaloneRouteId], { prune: true });
  }, [activeStandaloneRouteId, loadRoutePoints]);

  const loadClimbs = useClimbStore((s) => s.loadClimbs);
  const updateCurrentClimb = useClimbStore((s) => s.updateCurrentClimb);
  const selectedClimb = useClimbStore((s) => s.selectedClimb);
  const setSelectedClimb = useClimbStore((s) => s.setSelectedClimb);
  const minimumDifficulty = useClimbStore((s) => s.minimumDifficulty);
  const getClimbsForDisplay = useClimbStore((s) => s.getClimbsForDisplay);
  const allClimbData = useClimbStore((s) => s.climbs);

  // Clear stale climb selection and progress when active route/collection geometry changes.
  const activeContextKey = activeData ? `${activeData.id}:${activeRouteIdsKey}` : null;
  const prevActiveGeometry = useRef({
    contextKey: activeContextKey,
    points: activeRoutePoints,
  });
  useEffect(() => {
    const previous = prevActiveGeometry.current;
    if (activeContextKey !== previous.contextKey || activeRoutePoints !== previous.points) {
      prevActiveGeometry.current = {
        contextKey: activeContextKey,
        points: activeRoutePoints,
      };
      setSelectedClimb(null);
      clearRouteProgress();
    }
  }, [activeContextKey, activeRoutePoints, setSelectedClimb, clearRouteProgress]);

  // Load POIs and climbs when active context changes
  useEffect(() => {
    if (activeRouteIds.length === 0) return;
    for (const routeId of activeRouteIds) {
      loadPOIs(routeId);
      loadClimbs(routeId);
    }
  }, [activeRouteIds, activeRouteIdsKey, loadPOIs, loadClimbs]);

  useEffect(() => {
    if (activeData && activeRoutePoints?.length) {
      computeETAForRoute(activeData.id, activeRoutePoints);
    }
    // Intentional: fire only when id/points change; full activeData reference not needed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeData?.id, activeRoutePoints, computeETAForRoute]);

  // Fetch weather when active context + snapped position + ETA are available (and online)
  useEffect(() => {
    if (
      activeData &&
      activeRoutePoints?.length &&
      activeRouteProgress &&
      cumulativeTime &&
      isConnected
    ) {
      fetchWeather(
        activeData.id,
        activeRoutePoints,
        activeRouteProgress.distanceAlongRouteMeters,
        cumulativeTime,
      );
    }
    // Intentional: fire on id/progress changes, not full object identities
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeData?.id, activeProgressDistanceMeters, isConnected, cumulativeTime, fetchWeather]);

  const applyRouteSnap = useCallback(
    (position: UserPosition, data: { id: string; points: RoutePoint[] }) => {
      const routeState = useRouteStore.getState();
      const previous = routeState.snappedPosition;
      const snapped = snapToRouteDetailed(
        position.latitude,
        position.longitude,
        data.id,
        data.points,
        {
          previousPointIndex: previous?.routeId === data.id ? previous.pointIndex : undefined,
          previousDistanceAlongRouteMeters:
            previous?.routeId === data.id ? previous.distanceAlongRouteMeters : undefined,
          history: routeState.snapHistory,
          headingDegrees: position.heading,
          speedMetersPerSecond: position.speed,
          timestamp: position.timestamp,
        },
      );

      if (!snapped) {
        clearRouteProgress();
        return;
      }

      setSnappedPosition(snapped.snappedPosition);

      recordSnapHistory({
        routeId: data.id,
        latitude: position.latitude,
        longitude: position.longitude,
        timestamp: position.timestamp,
        heading: position.heading,
        speed: position.speed,
        selectedCandidate: snapped.selectedCandidate,
      });
    },
    [clearRouteProgress, recordSnapHistory, setSnappedPosition],
  );

  // Snap eagerly when routes load (don't wait for next GPS refresh)
  useEffect(() => {
    if (!activeData || !activeRoutePoints?.length) return;
    const pos = useMapStore.getState().userPosition;
    if (!pos) return;
    applyRouteSnap(pos, { id: activeData.id, points: activeRoutePoints });
    // Intentional: fire only when active id or points change; the full activeData reference isn't meaningful
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeData?.id, activeRoutePoints, applyRouteSnap]);

  // Snap to route after each position refresh
  const snapAfterRefresh = useCallback(
    (position: UserPosition) => {
      const data = getActiveRouteDataImperative();
      if (data && data.points.length > 0) {
        applyRouteSnap(position, { id: data.id, points: data.points });
      }
    },
    [applyRouteSnap],
  );

  // On-demand GPS: fetch position on mount
  useEffect(() => {
    (async () => {
      const position = await refreshPosition();
      if (position) {
        if (!hasGpsFix) setHasGpsFix(true);
        snapAfterRefresh(position);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-refresh on app focus if position is stale
  useEffect(() => {
    const subscription = AppState.addEventListener("change", async (state) => {
      if (state !== "active") return;
      const pos = useMapStore.getState().userPosition;
      if (!pos || Date.now() - pos.timestamp >= GPS_STALE_THRESHOLD_MS) {
        const position = await refreshPosition();
        if (position) {
          if (!hasGpsFix) setHasGpsFix(true);
          snapAfterRefresh(position);
        }
      }
    });
    return () => subscription.remove();
  }, [refreshPosition, snapAfterRefresh, hasGpsFix]);

  // Track current climb based on snapped position
  useEffect(() => {
    if (activeRouteProgress && activeData) {
      updateCurrentClimb(
        activeRouteProgress.distanceAlongRouteMeters,
        activeData.routeIds,
        activeData.segments,
      );
    }
    // Intentional: fire on primitive id/distance changes, not on full object/array identities
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProgressDistanceMeters, activeData?.id, updateCurrentClimb]);

  // Fly to selected POI
  const selectedPOI = usePoiStore((s) => s.selectedPOI);
  useEffect(() => {
    if (selectedPOI) {
      setFollowUser(false);
      cameraRef.current?.setCamera({
        centerCoordinate: [selectedPOI.longitude, selectedPOI.latitude],
        zoomLevel: 14,
        animationDuration: 500,
      });
    }
  }, [selectedPOI, setFollowUser]);

  const handlePOIClusterPress = useCallback(
    (centerCoordinate: [number, number], zoomLevel: number) => {
      setFollowUser(false);
      cameraRef.current?.setCamera({
        centerCoordinate,
        zoomLevel,
        animationMode: "easeTo",
        animationDuration: 450,
      });
    },
    [setFollowUser],
  );

  const handleLocate = useCallback(async () => {
    setFollowUser(true);
    // Snap to cached position instantly, then ease to fresh fix (no zoom change)
    const currentPos = useMapStore.getState().userPosition;
    if (currentPos) {
      cameraRef.current?.setCamera({
        centerCoordinate: [currentPos.longitude, currentPos.latitude],
        animationMode: "moveTo",
        animationDuration: 0,
      });
    }
    const position = await refreshPosition();
    if (position) {
      if (!hasGpsFix) setHasGpsFix(true);
      snapAfterRefresh(position);
      cameraRef.current?.setCamera({
        centerCoordinate: [position.longitude, position.latitude],
        animationMode: "easeTo",
        animationDuration: 500,
      });
    }
  }, [setFollowUser, refreshPosition, snapAfterRefresh, hasGpsFix]);

  const handleCameraChanged = useCallback(
    (state: { properties: { center: number[]; zoom: number } }) => {
      const c = state.properties.center;
      const zoom = state.properties.zoom;
      lastCamera.current = { center: [c[0], c[1]], zoom };
      updateRouteGeometryZoom(zoom);
    },
    [updateRouteGeometryZoom],
  );

  // Persist camera to MMKV when app goes to background
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "background" || s === "inactive") {
        persistCamera(lastCamera.current.center, lastCamera.current.zoom);
      }
    });
    return () => sub.remove();
  }, [persistCamera]);

  const handleTouchStart = useCallback(() => {
    if (followUser) {
      setFollowUser(false);
    }
  }, [followUser, setFollowUser]);

  const cameraPadding = useMemo(
    () => ({
      paddingTop: 0,
      paddingLeft: 0,
      paddingRight: 0,
      paddingBottom: compactPanelHeight,
    }),
    [compactPanelHeight],
  );

  const pulsingConfig = useMemo(
    () => ({ isEnabled: true, color: themeColors.accent, radius: 40 }),
    [themeColors.accent],
  );

  // Standalone active route rendering; collections render as one stitched route below.
  const renderedRoutes = useMemo(
    () => routes.filter((r) => r.isVisible && r.isActive && visibleRoutePoints[r.id]),
    [routes, visibleRoutePoints],
  );

  const activeCollectionRoute = useMemo(() => {
    if (activeData?.type !== "collection") return null;
    return {
      id: activeData.id,
      name: activeData.name,
      fileName: `${activeData.id}.collection`,
      color: "",
      isActive: true,
      isVisible: true,
      totalDistanceMeters: activeData.totalDistanceMeters,
      totalAscentMeters: activeData.totalAscentMeters,
      totalDescentMeters: activeData.totalDescentMeters,
      pointCount: activeRoutePoints?.length ?? 0,
      createdAt: "",
    };
  }, [activeData, activeRoutePoints?.length]);

  // Forces LocationPuck to remount so its layer is recreated on top of route/POI layers.
  const renderedRouteKey = useMemo(() => {
    const ids = renderedRoutes.map((r) => r.id);
    if (activeCollectionRoute) ids.push(activeCollectionRoute.id);
    return ids.sort().join(",") + `-${mapStyle.styleKey}`;
  }, [renderedRoutes, activeCollectionRoute, mapStyle.styleKey]);

  // Climb to highlight on the map — active when Climbs tab is selected
  const highlightedClimb = useMemo(() => {
    if (panelTab !== "climbs") return null;
    const displayed = filterClimbsToRidingHorizon(
      getClimbsForDisplay(activeRouteIds, activeData?.segments ?? null),
      climbHorizonWindow,
    ).filter((c) => isClimbAtLeastDifficulty(c.difficultyScore, minimumDifficulty));
    const selected =
      selectedClimb && displayed.some((c) => c.id === selectedClimb.id) ? selectedClimb : null;
    return resolveActiveClimb(displayed, activeProgressDistanceMeters, selected);
    // allClimbData is a reactivity trigger: getClimbsForDisplay reads store via get() and is not itself reactive
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    panelTab,
    selectedClimb,
    activeRouteIds,
    activeData?.segments,
    activeProgressDistanceMeters,
    minimumDifficulty,
    climbHorizonWindow,
    allClimbData,
  ]);

  // Center highlighted climbs without increasing zoom; zoom out only when the climb cannot fit.
  useEffect(() => {
    if (!highlightedClimb || !activeRoutePoints?.length) return;
    const climbBounds = getClimbMapBounds(
      activeRoutePoints,
      highlightedClimb.effectiveStartDistanceMeters,
      highlightedClimb.effectiveEndDistanceMeters,
    );
    if (!climbBounds) return;
    const bounds = climbBounds;

    setFollowUser(false);
    cameraRef.current?.setCamera({
      centerCoordinate: bounds.center,
      padding: {
        paddingTop: 0,
        paddingRight: 0,
        paddingBottom: overlayPanelHeight,
        paddingLeft: 0,
      },
      zoomLevel: getZoomLevelToFitBounds(
        lastCamera.current.zoom,
        bounds,
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
    overlayPanelHeight,
    screenHeight,
    screenWidth,
    setFollowUser,
  ]);

  const currentPOIDistanceMeters = activeProgressDistanceMeters;

  return (
    <View className="flex-1">
      <MapboxMapView
        ref={mapRef}
        style={{ flex: 1 }}
        {...mapStyle.props}
        compassEnabled={false}
        scaleBarEnabled={false}
        rotateEnabled={false}
        onTouchStart={handleTouchStart}
        onCameraChanged={handleCameraChanged}
      >
        <Camera
          ref={cameraRef}
          defaultSettings={{
            centerCoordinate: initialCamera.current.center,
            zoomLevel: initialCamera.current.zoom,
          }}
          animationDuration={500}
          padding={cameraPadding}
        />
        {renderedRoutes.map((route) => {
          const styledRoute = route.isActive ? route : { ...route, isActive: true };
          return (
            <RouteLayer
              key={`${route.id}-${mapStyle.styleKey}`}
              route={styledRoute}
              points={visibleRoutePoints[route.id]}
              zoomLevel={routeGeometryZoom}
              dimmed={highlightedClimb != null}
            />
          );
        })}
        {activeCollectionRoute && activeRoutePoints && activeRoutePoints.length > 1 && (
          <RouteLayer
            key={`${activeCollectionRoute.id}-${mapStyle.styleKey}`}
            route={activeCollectionRoute}
            points={activeRoutePoints}
            zoomLevel={routeGeometryZoom}
            dimmed={highlightedClimb != null}
          />
        )}
        {activeRouteIds.length > 0 && (
          <POILayer
            key={mapStyle.styleKey}
            routeIds={activeRouteIds}
            segments={activeData?.segments ?? null}
            currentDistanceMeters={currentPOIDistanceMeters}
            onClusterPress={handlePOIClusterPress}
          />
        )}
        {highlightedClimb && activeRoutePoints && (
          <ClimbHighlightLayer climb={highlightedClimb} points={activeRoutePoints} />
        )}
        <LocationPuck
          key={`puck-${renderedRouteKey}`}
          puckBearing="heading"
          puckBearingEnabled
          pulsing={pulsingConfig}
        />
      </MapboxMapView>

      <MapControls onLocate={handleLocate} />
      <TabbedBottomPanel activeData={activeData} />
    </View>
  );
}
