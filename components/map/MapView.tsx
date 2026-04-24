import React, { useRef, useCallback, useEffect, useState, useMemo } from "react";
import { View, AppState, useWindowDimensions } from "react-native";
import Mapbox, { Camera, MapView as MapboxMapView, LocationPuck } from "@rnmapbox/maps";
import Constants from "expo-constants";
import { useMapStore } from "@/store/mapStore";
import { useRouteStore } from "@/store/routeStore";
import { useCollectionStore } from "@/store/collectionStore";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePanelStore } from "@/store/panelStore";
import { SHEET_COMPACT_RATIO } from "@/constants";
import { useThemeColors } from "@/theme";
import { useMapStyle } from "@/hooks/useMapStyle";
import { GPS_STALE_THRESHOLD_MS } from "@/constants";
import MapControls from "./MapControls";
import RouteLayer from "./RouteLayer";
import POILayer from "./POILayer";
import ClimbHighlightLayer from "./ClimbHighlightLayer";
import TabbedBottomPanel from "./TabbedBottomPanel";
import { resolveActiveClimb } from "@/utils/climbSelect";
import { snapToRoute } from "@/services/routeSnapping";
import { useActiveRouteData, getActiveRouteDataImperative } from "@/hooks/useActiveRouteData";
import { usePoiStore } from "@/store/poiStore";
import { useClimbStore } from "@/store/climbStore";
import { useEtaStore } from "@/store/etaStore";
import { useWeatherStore } from "@/store/weatherStore";
import { useOfflineStore } from "@/store/offlineStore";

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
  const { height: screenHeight } = useWindowDimensions();

  const { followUser, setFollowUser } = useMapStore();
  const refreshPosition = useMapStore((s) => s.refreshPosition);
  const persistCamera = useMapStore((s) => s.persistCamera);
  const initialCamera = useRef({
    center: useMapStore.getState().center,
    zoom: useMapStore.getState().zoom,
  });
  const lastCamera = useRef(initialCamera.current);
  const panelTab = usePanelStore((s) => s.panelTab);
  const { bottom: safeBottom } = useSafeAreaInsets();
  const panelHeight = Math.round(screenHeight * SHEET_COMPACT_RATIO) + safeBottom;

  const routes = useRouteStore((s) => s.routes);
  const visibleRoutePoints = useRouteStore((s) => s.visibleRoutePoints);
  const loadRoutesAndPoints = useRouteStore((s) => s.loadRoutesAndPoints);
  const snappedPosition = useRouteStore((s) => s.snappedPosition);
  const setSnappedPosition = useRouteStore((s) => s.setSnappedPosition);
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

  // Set of routeIds that are part of the active collection (for RouteLayer styling)
  const activeCollectionRouteIds = useMemo(() => {
    if (activeData?.type === "collection") return new Set(activeData.routeIds);
    return null;
  }, [activeData]);

  useEffect(() => {
    loadRoutesAndPoints();
    loadCollections();
  }, [loadRoutesAndPoints, loadCollections]);

  const loadClimbs = useClimbStore((s) => s.loadClimbs);
  const updateCurrentClimb = useClimbStore((s) => s.updateCurrentClimb);
  const selectedClimb = useClimbStore((s) => s.selectedClimb);
  const setSelectedClimb = useClimbStore((s) => s.setSelectedClimb);
  const getClimbsForDisplay = useClimbStore((s) => s.getClimbsForDisplay);
  const allClimbData = useClimbStore((s) => s.climbs);

  // Clear stale climb selection when active route/collection changes
  const activeContextKey = activeData ? `${activeData.id}:${activeRouteIdsKey}` : null;
  const prevActiveContextKey = useRef(activeContextKey);
  useEffect(() => {
    if (activeContextKey !== prevActiveContextKey.current) {
      prevActiveContextKey.current = activeContextKey;
      setSelectedClimb(null);
    }
  }, [activeContextKey, setSelectedClimb]);

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
      snappedPosition &&
      cumulativeTime &&
      isConnected
    ) {
      fetchWeather(activeData.id, activeRoutePoints, snappedPosition.pointIndex, cumulativeTime);
    }
    // Intentional: fire on id/pointIndex changes, not full object identities
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeData?.id, snappedPosition?.pointIndex, isConnected, cumulativeTime, fetchWeather]);

  // Snap eagerly when routes load (don't wait for next GPS refresh)
  useEffect(() => {
    if (!activeData || !activeRoutePoints?.length) return;
    const pos = useMapStore.getState().userPosition;
    if (!pos) return;
    const snapped = snapToRoute(pos.latitude, pos.longitude, activeData.id, activeRoutePoints);
    setSnappedPosition(snapped);
    // Intentional: fire only when active id or points change; the full activeData reference isn't meaningful
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeData?.id, activeRoutePoints, setSnappedPosition]);

  // Snap to route after each position refresh
  const snapAfterRefresh = useCallback(
    (position: { latitude: number; longitude: number }) => {
      const data = getActiveRouteDataImperative();
      if (data && data.points.length > 0) {
        const snapped = snapToRoute(position.latitude, position.longitude, data.id, data.points);
        setSnappedPosition(snapped);
      }
    },
    [setSnappedPosition],
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
    if (snappedPosition && activeData) {
      updateCurrentClimb(
        snappedPosition.distanceAlongRouteMeters,
        activeData.routeIds,
        activeData.segments,
      );
    }
    // Intentional: fire on primitive id/distance changes, not on full object/array identities
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snappedPosition?.distanceAlongRouteMeters, activeData?.id, updateCurrentClimb]);

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
      lastCamera.current = { center: [c[0], c[1]], zoom: state.properties.zoom };
    },
    [],
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
      paddingBottom: panelHeight,
    }),
    [panelHeight],
  );

  const pulsingConfig = useMemo(
    () => ({ isEnabled: true, color: themeColors.accent, radius: 40 }),
    [themeColors.accent],
  );

  // Routes that should be rendered on the map (active or part of active collection, with loaded points)
  const renderedRoutes = useMemo(
    () =>
      routes.filter(
        (r) =>
          r.isVisible &&
          visibleRoutePoints[r.id] &&
          (r.isActive || (activeCollectionRouteIds?.has(r.id) ?? false)),
      ),
    [routes, visibleRoutePoints, activeCollectionRouteIds],
  );

  // Forces LocationPuck to remount so its layer is recreated on top of route/POI layers.
  const renderedRouteKey = useMemo(() => {
    return (
      renderedRoutes
        .map((r) => r.id)
        .sort()
        .join(",") + `-${mapStyle.styleKey}`
    );
  }, [renderedRoutes, mapStyle.styleKey]);

  // Climb to highlight on the map — active when Climbs tab is selected
  const highlightedClimb = useMemo(() => {
    if (panelTab !== "climbs") return null;
    const displayed = getClimbsForDisplay(activeRouteIds, activeData?.segments ?? null);
    return resolveActiveClimb(
      displayed,
      snappedPosition?.distanceAlongRouteMeters ?? null,
      selectedClimb,
    );
    // allClimbData is a reactivity trigger: getClimbsForDisplay reads store via get() and is not itself reactive
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    panelTab,
    selectedClimb,
    activeRouteIds,
    activeData?.segments,
    snappedPosition?.distanceAlongRouteMeters,
    allClimbData,
  ]);

  // Fly to highlighted climb bounds
  useEffect(() => {
    if (!highlightedClimb || !activeRoutePoints?.length) return;
    const climbStart = highlightedClimb.effectiveStartDistanceMeters;
    const climbEnd = highlightedClimb.effectiveEndDistanceMeters;

    let minLat = 90,
      maxLat = -90,
      minLon = 180,
      maxLon = -180;
    let found = false;
    for (const p of activeRoutePoints) {
      if (p.distanceFromStartMeters < climbStart) continue;
      if (p.distanceFromStartMeters > climbEnd) break;
      found = true;
      if (p.latitude < minLat) minLat = p.latitude;
      if (p.latitude > maxLat) maxLat = p.latitude;
      if (p.longitude < minLon) minLon = p.longitude;
      if (p.longitude > maxLon) maxLon = p.longitude;
    }
    if (!found) return;

    setFollowUser(false);
    // Camera padding already accounts for the panel, so fitBounds
    // only needs breathing room around the climb bounds.
    cameraRef.current?.fitBounds([maxLon, maxLat], [minLon, minLat], [60, 40, 40, 40], 500);
    // Intentional: fire only when the highlighted climb identity changes, not on every route point update
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightedClimb?.id]);

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
              dimmed={highlightedClimb != null}
            />
          );
        })}
        {activeRouteIds.length > 0 && (
          <POILayer
            key={mapStyle.styleKey}
            routeIds={activeRouteIds}
            segments={activeData?.segments ?? null}
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
