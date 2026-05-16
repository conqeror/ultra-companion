import type { UserPosition } from "@/types";

export async function requestLocationPermission(): Promise<boolean> {
  return typeof navigator !== "undefined" && "geolocation" in navigator;
}

export async function getCurrentPosition(): Promise<UserPosition | null> {
  if (!(await requestLocationPermission())) return null;

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          altitude: position.coords.altitude,
          heading: position.coords.heading,
          speed: position.coords.speed,
          timestamp: position.timestamp,
        });
      },
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 },
    );
  });
}
