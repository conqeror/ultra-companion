import React, { useRef, useCallback, useEffect, useState, useMemo } from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
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
import { MAP_STYLE_URLS } from "@/types";
import type { RoutePoint } from "@/types";
import { DEFAULT_ZOOM, BOTTOM_PANEL_HEIGHT_RATIO } from "@/constants";
import { requestLocationPermission, watchPosition } from "@/services/gps";
import MapControls from "./MapControls";
import RouteLayer from "./RouteLayer";
import BottomPanel from "./BottomPanel";
import { snapToRoute } from "@/services/routeSnapping";
import { computeBounds } from "@/utils/geo";

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
  const cameraRef = useRef<Camera>(null);
  const mapRef = useRef<MapboxMapView>(null);
  const [hasGpsFix, setHasGpsFix] = useState(false);
  const [initialCameraSet, setInitialCameraSet] = useState(false);
  const { height: screenHeight } = useWindowDimensions();

  const { followUser, userPosition, setFollowUser, setUserPosition } =
    useMapStore();

  const mapStyle = useSettingsStore((s) => s.mapStyle);
  const panelMode = usePanelStore((s) => s.panelMode);
  const panelOpen = panelMode !== "none";
  const panelHeight = Math.round(screenHeight * BOTTOM_PANEL_HEIGHT_RATIO);

  const routes = useRouteStore((s) => s.routes);
  const visibleRoutePoints = useRouteStore((s) => s.visibleRoutePoints);
  const loadRoutes = useRouteStore((s) => s.loadRoutes);
  const setSnappedPosition = useRouteStore((s) => s.setSnappedPosition);

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

  // Snap eagerly when routes load (don't wait for next GPS movement)
  useEffect(() => {
    if (!activeRoute || !activeRoutePoints?.length) return;
    const pos = useMapStore.getState().userPosition;
    if (!pos) return;
    const snapped = snapToRoute(pos.latitude, pos.longitude, activeRoute.id, activeRoutePoints);
    setSnappedPosition(snapped);
  }, [activeRoute, activeRoutePoints, setSnappedPosition]);

  useEffect(() => {
    let watcher: { remove: () => void } | null = null;

    (async () => {
      const granted = await requestLocationPermission();
      if (!granted) return;

      watcher = watchPosition((position) => {
        setUserPosition(position);
        if (!hasGpsFix) setHasGpsFix(true);

        // Snap to active route
        const activeRoute = useRouteStore.getState().routes.find((r) => r.isActive);
        if (activeRoute) {
          const points = useRouteStore.getState().visibleRoutePoints[activeRoute.id];
          if (points?.length) {
            const snapped = snapToRoute(
              position.latitude,
              position.longitude,
              activeRoute.id,
              points,
            );
            setSnappedPosition(snapped);
          }
        }
      });
    })();

    return () => {
      watcher?.remove();
    };
  }, [setUserPosition]);

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

  return (
    <View style={styles.container}>
      <MapboxMapView
        ref={mapRef}
        style={styles.map}
        styleURL={MAP_STYLE_URLS[mapStyle]}
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
          padding={{
            paddingTop: 0,
            paddingLeft: 0,
            paddingRight: 0,
            paddingBottom: panelOpen ? panelHeight : 0,
          }}
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
        <LocationPuck
          puckBearing="heading"
          puckBearingEnabled
          pulsing={{ isEnabled: true, color: "#007AFF", radius: 40 }}
        />
      </MapboxMapView>

      <MapControls onCenterUser={handleCenterUser} followUser={followUser} />
      <BottomPanel activeRoutePoints={activeRoutePoints} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  map: {
    flex: 1,
  },
});
