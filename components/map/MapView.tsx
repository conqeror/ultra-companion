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
import { useCollectionStore } from "@/store/collectionStore";
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
  const bottomSheet = usePanelStore((s) => s.bottomSheet);
  const panelHeight = Math.round(screenHeight * BOTTOM_PANEL_HEIGHT_RATIO);

  const routes = useRouteStore((s) => s.routes);
  const visibleRoutePoints = useRouteStore((s) => s.visibleRoutePoints);
  const loadRoutes = useRouteStore((s) => s.loadRoutes);
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
  const activeRouteIds = activeData?.routeIds ?? [];

  // Set of routeIds that are part of the active collection (for RouteLayer styling)
  const activeCollectionRouteIds = useMemo(() => {
    if (activeData?.type === "collection") return new Set(activeData.routeIds);
    return null;
  }, [activeData]);

  useEffect(() => {
    loadRoutes();
    loadCollections();
  }, [loadRoutes, loadCollections]);

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

  const handleLocate = useCallback(async () => {
    setFollowUser(true);
    // Snap to cached position instantly, then animate to fresh fix
    const currentPos = useMapStore.getState().userPosition;
    if (currentPos) {
      cameraRef.current?.setCamera({
        centerCoordinate: [currentPos.longitude, currentPos.latitude],
        animationDuration: 0,
      });
    }
    const position = await refreshPosition();
    if (position) {
      if (!hasGpsFix) setHasGpsFix(true);
      snapAfterRefresh(position);
      cameraRef.current?.setCamera({
        centerCoordinate: [position.longitude, position.latitude],
        animationDuration: 500,
      });
    }
  }, [setFollowUser, refreshPosition, snapAfterRefresh, hasGpsFix]);

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

  // Routes that should be rendered on the map (active or part of active collection, with loaded points)
  const renderedRoutes = useMemo(
    () => routes.filter((r) => r.isVisible && visibleRoutePoints[r.id] && (r.isActive || (activeCollectionRouteIds?.has(r.id) ?? false))),
    [routes, visibleRoutePoints, activeCollectionRouteIds],
  );

  // Forces LocationPuck to remount so its layer is recreated on top of route/POI layers.
  const renderedRouteKey = useMemo(() => {
    return renderedRoutes.map((r) => r.id).sort().join(",") + `-${mapStyle.styleKey}`;
  }, [renderedRoutes, mapStyle.styleKey]);

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
        {renderedRoutes.map((route) => {
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
          key={`puck-${renderedRouteKey}`}
          puckBearing="heading"
          puckBearingEnabled
          pulsing={pulsingConfig}
        />
      </MapboxMapView>

      <MapControls
        onLocate={handleLocate}
        activeRouteIds={activeRouteIds}
      />
      <BottomPanel activeData={activeData} />
      {bottomSheet === "weather" && <WeatherBottomSheet />}
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
