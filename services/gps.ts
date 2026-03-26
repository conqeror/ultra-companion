import * as Location from "expo-location";
import type { UserPosition } from "@/types";

export async function requestLocationPermission(): Promise<boolean> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  return status === "granted";
}

export async function getCurrentPosition(): Promise<UserPosition | null> {
  const location = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.High,
  });
  return locationToPosition(location);
}

export function watchPosition(
  onUpdate: (position: UserPosition) => void,
  onError?: (error: Error) => void,
): { remove: () => void } {
  let subscription: Location.LocationSubscription | null = null;

  Location.watchPositionAsync(
    {
      accuracy: Location.Accuracy.High,
      distanceInterval: 10, // meters — balance between accuracy and battery
      timeInterval: 5000, // 5 seconds minimum between updates
    },
    (location) => {
      const position = locationToPosition(location);
      if (position) onUpdate(position);
    },
  )
    .then((sub) => {
      subscription = sub;
    })
    .catch((err) => {
      onError?.(err instanceof Error ? err : new Error(String(err)));
    });

  return {
    remove: () => {
      subscription?.remove();
    },
  };
}

function locationToPosition(
  location: Location.LocationObject,
): UserPosition | null {
  return {
    latitude: location.coords.latitude,
    longitude: location.coords.longitude,
    altitude: location.coords.altitude,
    heading: location.coords.heading,
    speed: location.coords.speed,
    timestamp: location.timestamp,
  };
}
