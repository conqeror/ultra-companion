import React, { useRef, useCallback, useEffect, useState, useMemo } from "react";
import { View, AppState, useWindowDimensions } from "react-native";
import Mapbox, {
  Camera,
  UserTrackingMode,
  MapView as MapboxMapView,
  LocationPuck,
} from "@rnmapbox/maps";
import Constants from "expo-constants";
import { useMapStore } from "@/store/mapStore";
import { useSettingsStore } from "@/store/settingsStore";
import { useRouteStore } from "@/store/routeStore";
import { usePanelStore } from "@/store/panelStore";
import { useThemeColors } from "@/theme";
import { useColorScheme } from "nativewind";
import { MAP_STYLE_URLS } from "@/types";
import type { RoutePoint } from "@/types";
import { DEFAULT_ZOOM, BOTTOM_PANEL_HEIGHT_RATIO, GPS_STALE_THRESHOLD_MS } from "@/constants";
import MapControls from "./MapControls";
import RouteLayer from "./RouteLayer";
import POILayer from "./POILayer";
import POIDetailSheet from "@/components/poi/POIDetailSheet";
import POIListView from "@/components/poi/POIListView";
import BottomPanel from "./BottomPanel";
import { snapToRoute } from "@/services/routeSnapping";
import { computeBounds } from "@/utils/geo";
import { usePoiStore } from "@/store/poiStore";
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
  const { colorScheme } = useColorScheme();
  const cameraRef = useRef<Camera>(null);
  const mapRef = useRef<MapboxMapView>(null);
  const [hasGpsFix, setHasGpsFix] = useState(false);
  const [initialCameraSet, setInitialCameraSet] = useState(false);
  const { height: screenHeight } = useWindowDimensions();

  const { followUser, userPosition, setFollowUser } = useMapStore();
  const refreshPosition = useMapStore((s) => s.refreshPosition);
  const isRefreshing = useMapStore((s) => s.isRefreshing);

  const mapStyle = useSettingsStore((s) => s.mapStyle);
  const panelMode = usePanelStore((s) => s.panelMode);
  const panelOpen = panelMode !== "none";
  const panelHeight = Math.round(screenHeight * BOTTOM_PANEL_HEIGHT_RATIO);

  const routes = useRouteStore((s) => s.routes);
  const visibleRoutePoints = useRouteStore((s) => s.visibleRoutePoints);
  const loadRoutes = useRouteStore((s) => s.loadRoutes);
  const snappedPosition = useRouteStore((s) => s.snappedPosition);
  const setSnappedPosition = useRouteStore((s) => s.setSnappedPosition);
  const loadPOIs = usePoiStore((s) => s.loadPOIs);
  const computeETAForRoute = useEtaStore((s) => s.computeETAForRoute);
  const cumulativeTime = useEtaStore((s) => s.cumulativeTime);
  const fetchWeather = useWeatherStore((s) => s.fetchWeather);
  const isConnected = useOfflineStore((s) => s.isConnected);

  // Active route and its points
  const activeRoute = useMemo(() => routes.find((r) => r.isActive) ?? null, [routes]);
  const activeRoutePoints = useMemo(
    () => (activeRoute ? visibleRoutePoints[activeRoute.id] ?? null : null),
    [activeRoute, visibleRoutePoints],
  );

  // Compute active route bounds for initial camera
  const activeRouteBounds = useMemo(() => {
    if (!activeRoutePoints?.length) return null;
    return computeBounds(activeRoutePoints);
  }, [activeRoutePoints]);

  useEffect(() => {
    loadRoutes();
  }, [loadRoutes]);

  // Load POIs and compute ETA when active route changes
  useEffect(() => {
    if (activeRoute) {
      loadPOIs(activeRoute.id);
    }
  }, [activeRoute?.id, loadPOIs]);

  useEffect(() => {
    if (activeRoute && activeRoutePoints?.length) {
      computeETAForRoute(activeRoute.id, activeRoutePoints);
    }
  }, [activeRoute?.id, activeRoutePoints, computeETAForRoute]);

  // Fetch weather when active route + snapped position + ETA are available (and online)
  useEffect(() => {
    if (activeRoute && activeRoutePoints?.length && snappedPosition && cumulativeTime && isConnected) {
      fetchWeather(activeRoute.id, activeRoutePoints, snappedPosition.pointIndex, cumulativeTime);
    }
  }, [activeRoute?.id, snappedPosition?.pointIndex, isConnected, cumulativeTime, fetchWeather]);

  // Set initial camera once routes are loaded
  useEffect(() => {
    if (initialCameraSet) return;
    if (activeRouteBounds) {
      cameraRef.current?.setCamera({
        bounds: {
          ne: activeRouteBounds.ne,
          sw: activeRouteBounds.sw,
          paddingLeft: 40,
          paddingRight: 40,
          paddingTop: 40,
          paddingBottom: 40,
        },
        animationDuration: 0,
      });
      setInitialCameraSet(true);
    }
  }, [activeRouteBounds, initialCameraSet]);

  // Snap eagerly when routes load (don't wait for next GPS refresh)
  useEffect(() => {
    if (!activeRoute || !activeRoutePoints?.length) return;
    const pos = useMapStore.getState().userPosition;
    if (!pos) return;
    const snapped = snapToRoute(pos.latitude, pos.longitude, activeRoute.id, activeRoutePoints);
    setSnappedPosition(snapped);
  }, [activeRoute, activeRoutePoints, setSnappedPosition]);

  // Snap to route after each position refresh
  const snapAfterRefresh = useCallback(
    (position: { latitude: number; longitude: number }) => {
      const active = useRouteStore.getState().routes.find((r) => r.isActive);
      if (active) {
        const points = useRouteStore.getState().visibleRoutePoints[active.id];
        if (points?.length) {
          const snapped = snapToRoute(position.latitude, position.longitude, active.id, points);
          setSnappedPosition(snapped);
        }
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

  const handleRefreshPosition = useCallback(async () => {
    const position = await refreshPosition();
    if (position) {
      if (!hasGpsFix) setHasGpsFix(true);
      snapAfterRefresh(position);
    }
  }, [refreshPosition, snapAfterRefresh, hasGpsFix]);

  const handleCenterUser = useCallback(() => {
    setFollowUser(true);
    if (userPosition) {
      cameraRef.current?.setCamera({
        centerCoordinate: [userPosition.longitude, userPosition.latitude],
        animationDuration: 500,
      });
    }
  }, [setFollowUser, userPosition]);

  const handleTouchStart = useCallback(() => {
    if (followUser) {
      setFollowUser(false);
    }
  }, [followUser, setFollowUser]);

  // Only follow user location after we have a GPS fix
  const shouldFollow = followUser && hasGpsFix;

  const cameraPadding = useMemo(() => ({
    paddingTop: 0,
    paddingLeft: 0,
    paddingRight: 0,
    paddingBottom: panelOpen ? panelHeight : 0,
  }), [panelOpen, panelHeight]);

  const pulsingConfig = useMemo(
    () => ({ isEnabled: true, color: themeColors.accent, radius: 40 }),
    [themeColors.accent],
  );

  return (
    <View className="flex-1">
      <MapboxMapView
        ref={mapRef}
        style={{ flex: 1 }}
        styleURL={MAP_STYLE_URLS[mapStyle][colorScheme ?? "light"]}
        compassEnabled={false}
        scaleBarEnabled={false}
        rotateEnabled={false}
        onTouchStart={handleTouchStart}
      >
        <Camera
          ref={cameraRef}
          defaultSettings={{
            zoomLevel: DEFAULT_ZOOM,
          }}
          followUserLocation={shouldFollow}
          followUserMode={UserTrackingMode.Follow}
          animationDuration={500}
          padding={cameraPadding}
        />
        {routes
          .filter((r) => r.isVisible && visibleRoutePoints[r.id])
          .map((route) => (
            <RouteLayer
              key={route.id}
              route={route}
              points={visibleRoutePoints[route.id]}
            />
          ))}
        {activeRoute && (
          <POILayer routeId={activeRoute.id} />
        )}
        <LocationPuck
          puckBearing="heading"
          puckBearingEnabled
          pulsing={pulsingConfig}
        />
      </MapboxMapView>

      <MapControls
        onCenterUser={handleCenterUser}
        followUser={followUser}
        onRefreshPosition={handleRefreshPosition}
        isRefreshing={isRefreshing}
      />
      <BottomPanel activeRoutePoints={activeRoutePoints} />
      <POIDetailSheet />
      {activeRoute && <POIListView routeId={activeRoute.id} />}
    </View>
  );
}
