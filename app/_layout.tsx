import { Stack } from "expo-router";
import { ThemeProvider, type Theme } from "@react-navigation/native";
import * as SplashScreen from "expo-splash-screen";
import * as Linking from "expo-linking";
import { useFonts } from "expo-font";
import { useEffect, useRef, useCallback } from "react";
import { Alert } from "react-native";
import { useColorScheme } from "nativewind";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import "react-native-reanimated";
import "../global.css";
import { useOfflineStore } from "@/store/offlineStore";
import { useRouteStore } from "@/store/routeStore";
import { COLORS } from "@/theme";

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
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";
  const colors = COLORS[isDark ? "dark" : "light"];

  const navTheme: Theme = {
    dark: isDark,
    colors: {
      primary: colors.accent,
      background: colors.background,
      card: colors.background,
      text: colors.textPrimary,
      border: colors.border,
      notification: colors.accent,
    },
    fonts: {
      regular: { fontFamily: "Barlow-Regular", fontWeight: "400" },
      medium: { fontFamily: "Barlow-Medium", fontWeight: "500" },
      bold: { fontFamily: "Barlow-SemiBold", fontWeight: "600" },
      heavy: { fontFamily: "Barlow-Bold", fontWeight: "700" },
    },
  };

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

  // Re-detect climbs if algorithm version changed
  useEffect(() => {
    import("@/services/climbDetector").then(({ redetectClimbsIfNeeded }) => {
      redetectClimbsIfNeeded().catch(console.warn);
    });
  }, []);

  // Handle incoming GPX/KML files from share sheet / "Open with"
  const handledUrls = useRef(new Set<string>());

  const handleIncomingUrl = useCallback(async (url: string) => {
    if (handledUrls.current.has(url)) return;
    handledUrls.current.add(url);

    const fileName = decodeURIComponent(url.split("/").pop() || "route");
    const ext = fileName.toLowerCase().split(".").pop();
    if (!["gpx", "kml"].includes(ext || "")) return;

    try {
      const route = await useRouteStore.getState().importFromUri(url, fileName);
      Alert.alert("Route Imported", `"${route.name}" has been imported.`);
    } catch (e: any) {
      Alert.alert("Import Failed", e.message || "Could not import the file.");
    }
  }, []);

  useEffect(() => {
    // Handle cold start (app opened via file)
    Linking.getInitialURL().then((url) => {
      if (url) handleIncomingUrl(url);
    });
    // Handle warm open (app already running)
    const subscription = Linking.addEventListener("url", (event) => {
      handleIncomingUrl(event.url);
    });
    return () => subscription.remove();
  }, [handleIncomingUrl]);

  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider value={navTheme}>
        <Stack
          screenOptions={{
            headerBackTitle: "Routes",
            headerTitleStyle: { fontFamily: "Barlow-SemiBold" },
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="menu" options={{ presentation: "modal", headerShown: false }} />
          <Stack.Screen name="route/[id]" options={{ title: "Route" }} />
          <Stack.Screen name="collection/[id]" options={{ title: "Collection" }} />
        </Stack>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
