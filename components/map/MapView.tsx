import React, { useRef, useCallback, useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Mapbox, {
  Camera,
  UserTrackingMode,
  MapView as MapboxMapView,
  LocationPuck,
} from "@rnmapbox/maps";
import Constants from "expo-constants";
import { useMapStore } from "@/store/mapStore";
import { useSettingsStore } from "@/store/settingsStore";
import { MAP_STYLE_URLS } from "@/types";
import { DEFAULT_ZOOM } from "@/constants";
import { requestLocationPermission, watchPosition } from "@/services/gps";
import MapControls from "./MapControls";

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

  const { center, followUser, userPosition, setFollowUser, setUserPosition } =
    useMapStore();

  const mapStyle = useSettingsStore((s) => s.mapStyle);

  useEffect(() => {
    let watcher: { remove: () => void } | null = null;

    (async () => {
      const granted = await requestLocationPermission();
      if (!granted) return;

      watcher = watchPosition((position) => {
        setUserPosition(position);
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
            centerCoordinate: center,
            zoomLevel: DEFAULT_ZOOM,
          }}
          followUserLocation={followUser}
          followUserMode={UserTrackingMode.Follow}
          animationDuration={500}
        />
        <LocationPuck
          puckBearing="heading"
          puckBearingEnabled
          pulsing={{ isEnabled: true, color: "#007AFF", radius: 40 }}
        />
      </MapboxMapView>

      <MapControls onCenterUser={handleCenterUser} followUser={followUser} />
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
