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
import { useRouteStore } from "@/store/routeStore";
import { useRaceStore } from "@/store/raceStore";
import { usePanelStore } from "@/store/panelStore";
import { useThemeColors } from "@/theme";
import { useMapStyle } from "@/hooks/useMapStyle";
import { DEFAULT_ZOOM, BOTTOM_PANEL_HEIGHT_RATIO, GPS_STALE_THRESHOLD_MS } from "@/constants";
import MapControls from "./MapControls";
import RouteLayer from "./RouteLayer";
import POILayer from "./POILayer";
import POIDetailSheet from "@/components/poi/POIDetailSheet";
import POIListView from "@/components/poi/POIListView";
import BottomPanel from "./BottomPanel";
import WeatherBottomSheet from "./WeatherBottomSheet";
import { snapToRoute } from "@/services/routeSnapping";
import { useActiveRouteData, getActiveRouteDataImperative } from "@/hooks/useActiveRouteData";
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
  const mapStyle = useMapStyle();
  const cameraRef = useRef<Camera>(null);
  const mapRef = useRef<MapboxMapView>(null);
  const [hasGpsFix, setHasGpsFix] = useState(false);
  const { height: screenHeight } = useWindowDimensions();

  const { followUser, userPosition, setFollowUser } = useMapStore();
  const refreshPosition = useMapStore((s) => s.refreshPosition);
  const isRefreshing = useMapStore((s) => s.isRefreshing);

  const panelMode = usePanelStore((s) => s.panelMode);
  const bottomSheet = usePanelStore((s) => s.bottomSheet);
  const toggleBottomSheet = usePanelStore((s) => s.toggleBottomSheet);
  const panelOpen = panelMode !== "none" && bottomSheet == null;
  const panelHeight = Math.round(screenHeight * BOTTOM_PANEL_HEIGHT_RATIO);

  const routes = useRouteStore((s) => s.routes);
  const visibleRoutePoints = useRouteStore((s) => s.visibleRoutePoints);
  const loadRoutes = useRouteStore((s) => s.loadRoutes);
  const snappedPosition = useRouteStore((s) => s.snappedPosition);
  const setSnappedPosition = useRouteStore((s) => s.setSnappedPosition);
  const loadRaces = useRaceStore((s) => s.loadRaces);
  const loadPOIs = usePoiStore((s) => s.loadPOIs);
  const computeETAForRoute = useEtaStore((s) => s.computeETAForRoute);
  const cumulativeTime = useEtaStore((s) => s.cumulativeTime);
  const fetchWeather = useWeatherStore((s) => s.fetchWeather);
  const isConnected = useOfflineStore((s) => s.isConnected);

  // Unified active context — works for both standalone routes and races
  const activeData = useActiveRouteData();
  const activeRoutePoints = activeData?.points ?? null;
  const activeRouteIds = activeData?.routeIds ?? [];

  // Set of routeIds that are part of the active race (for RouteLayer styling)
  const activeRaceRouteIds = useMemo(() => {
    if (activeData?.type === "race") return new Set(activeData.routeIds);
    return null;
  }, [activeData]);

  useEffect(() => {
    loadRoutes();
    loadRaces();
  }, [loadRoutes, loadRaces]);

  // Load POIs and compute ETA when active context changes
  useEffect(() => {
    if (activeData) {
      for (const routeId of activeData.routeIds) {
        loadPOIs(routeId);
      }
    }
  }, [activeData?.id, loadPOIs]);

  useEffect(() => {
    if (activeData && activeRoutePoints?.length) {
      computeETAForRoute(activeData.id, activeRoutePoints);
    }
  }, [activeData?.id, activeRoutePoints, computeETAForRoute]);

  // Fetch weather when active context + snapped position + ETA are available (and online)
  useEffect(() => {
    if (activeData && activeRoutePoints?.length && snappedPosition && cumulativeTime && isConnected) {
      fetchWeather(activeData.id, activeRoutePoints, snappedPosition.pointIndex, cumulativeTime);
    }
  }, [activeData?.id, snappedPosition?.pointIndex, isConnected, cumulativeTime, fetchWeather]);

  // Snap eagerly when routes load (don't wait for next GPS refresh)
  useEffect(() => {
    if (!activeData || !activeRoutePoints?.length) return;
    const pos = useMapStore.getState().userPosition;
    if (!pos) return;
    const snapped = snapToRoute(pos.latitude, pos.longitude, activeData.id, activeRoutePoints);
    setSnappedPosition(snapped);
  }, [activeData, activeRoutePoints, setSnappedPosition]);

  // Snap to route after each position refresh
  const snapAfterRefresh = useCallback(
    (position: { latitude: number; longitude: number }) => {
      const data = getActiveRouteDataImperative();
      if (data && data.points.length) {
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

  const handleRefreshPosition = useCallback(async () => {
    const position = await refreshPosition();
    if (position) {
      if (!hasGpsFix) setHasGpsFix(true);
      snapAfterRefresh(position);
    }
  }, [refreshPosition, snapAfterRefresh, hasGpsFix]);

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
  }, [selectedPOI]);

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
    paddingBottom: panelHeight,
  }), [panelHeight]);

  const pulsingConfig = useMemo(
    () => ({ isEnabled: true, color: themeColors.accent, radius: 40 }),
    [themeColors.accent],
  );

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
          .filter((r) => r.isVisible && visibleRoutePoints[r.id] && (r.isActive || (activeRaceRouteIds?.has(r.id) ?? false)))
          .map((route) => {
            const styledRoute = route.isActive ? route : { ...route, isActive: true };
            return (
              <RouteLayer
                key={`${route.id}-${mapStyle.styleKey}`}
                route={styledRoute}
                points={visibleRoutePoints[route.id]}
              />
            );
          })}
        {activeRouteIds.length > 0 && (
          <POILayer key={mapStyle.styleKey} routeIds={activeRouteIds} />
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
        showWeather={bottomSheet === "weather"}
        onToggleWeather={() => toggleBottomSheet("weather")}
        activeRouteIds={activeRouteIds}
        mapRef={mapRef}
        cameraRef={cameraRef}
      />
      <BottomPanel activeData={activeData} />
      {bottomSheet === "weather" && (
        <WeatherBottomSheet onClose={() => toggleBottomSheet("weather")} />
      )}
      <POIDetailSheet />
      {activeRouteIds.length > 0 && (
        <POIListView
          routeIds={activeRouteIds}
          segments={activeData?.segments ?? null}
        />
      )}
    </View>
  );
}
