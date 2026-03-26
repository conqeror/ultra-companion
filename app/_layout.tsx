import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useFonts } from "expo-font";
import { useEffect } from "react";
import "react-native-reanimated";
import "../global.css";
import { useOfflineStore } from "@/store/offlineStore";

export { ErrorBoundary } from "expo-router";

export const unstable_settings = {
  initialRouteName: "(tabs)",
};

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    "Barlow-Regular": require("../assets/fonts/Barlow-Regular.ttf"),
    "Barlow-Medium": require("../assets/fonts/Barlow-Medium.ttf"),
    "Barlow-SemiBold": require("../assets/fonts/Barlow-SemiBold.ttf"),
    "Barlow-Bold": require("../assets/fonts/Barlow-Bold.ttf"),
    "BarlowSemiCondensed-Medium": require("../assets/fonts/BarlowSemiCondensed-Medium.ttf"),
    "BarlowSemiCondensed-SemiBold": require("../assets/fonts/BarlowSemiCondensed-SemiBold.ttf"),
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  // Initialize connectivity listener and reconcile offline pack statuses
  useEffect(() => {
    const unsubscribe = useOfflineStore.getState().initConnectivityListener();
    useOfflineStore.getState().refreshAllStatuses();
    return unsubscribe;
  }, []);

  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <Stack>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="route/[id]" options={{ title: "Route" }} />
    </Stack>
  );
}
