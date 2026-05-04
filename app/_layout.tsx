import { Stack, router } from "expo-router";
import { ThemeProvider, type Theme } from "@react-navigation/native";
import * as SplashScreen from "expo-splash-screen";
import * as Linking from "expo-linking";
import { useFonts } from "expo-font";
import { useEffect, useRef, useCallback } from "react";
import { Alert, AppState } from "react-native";
import { useColorScheme } from "nativewind";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import "react-native-reanimated";
import "../global.css";
import { useOfflineStore } from "@/store/offlineStore";
import { useRouteStore } from "@/store/routeStore";
import { useCollectionStore } from "@/store/collectionStore";
import { usePanelStore } from "@/store/panelStore";
import { useSharedPOIStore } from "@/store/sharedPOIStore";
import {
  loadPendingSharedPOIFromAppGroup,
  parseSharedPOIDeepLink,
  type SharedPOIInput,
} from "@/services/sharedPOIService";
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

  // Prefetch cheap metadata during splash. Full route geometry is loaded by
  // the active riding/detail screens when they actually need it.
  useEffect(() => {
    useRouteStore
      .getState()
      .loadRouteMetadata()
      .catch((e) => console.warn("Route prefetch failed:", e));
    useCollectionStore
      .getState()
      .loadCollectionMetadata()
      .catch((e) => console.warn("Collection prefetch failed:", e));
  }, []);

  // Re-detect climbs if algorithm version changed
  useEffect(() => {
    import("@/services/climbDetector").then(({ redetectClimbsIfNeeded }) => {
      redetectClimbsIfNeeded().catch(console.warn);
    });
  }, []);

  // Handle incoming GPX/KML files and shared POIs.
  const handledUrls = useRef(new Set<string>());

  const openSharedPOI = useCallback((sharedPOI: SharedPOIInput) => {
    useSharedPOIStore.getState().setPendingSharedPOI(sharedPOI);
    usePanelStore.getState().setPanelTab("pois");
    router.replace("/");
  }, []);

  const handleIncomingUrl = useCallback(
    async (url: string) => {
      if (handledUrls.current.has(url)) return;
      handledUrls.current.add(url);

      const sharedPOI = parseSharedPOIDeepLink(url);
      if (sharedPOI) {
        openSharedPOI(sharedPOI);
        return;
      }

      const fileName = decodeURIComponent(url.split("/").pop() || "route");
      const ext = fileName.toLowerCase().split(".").pop();
      if (!["gpx", "kml"].includes(ext || "")) return;

      try {
        const route = await useRouteStore.getState().importFromUri(url, fileName);
        // Replace (not push) so the +not-found screen Expo Router briefly lands on
        // for the incoming file:// URL doesn't stay in the back stack.
        router.replace(`/route/${route.id}`);
      } catch (e: any) {
        Alert.alert("Import Failed", e.message || "Could not import the file.");
      }
    },
    [openSharedPOI],
  );

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

  useEffect(() => {
    const importPendingSharedPOI = () => {
      loadPendingSharedPOIFromAppGroup()
        .then((sharedPOI) => {
          if (sharedPOI) openSharedPOI(sharedPOI);
        })
        .catch((e) => console.warn("Pending shared POI import failed:", e));
    };

    importPendingSharedPOI();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") importPendingSharedPOI();
    });
    return () => subscription.remove();
  }, [openSharedPOI]);

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
          <Stack.Screen name="+not-found" options={{ headerShown: false, animation: "none" }} />
          <Stack.Screen name="menu" options={{ presentation: "modal", headerShown: false }} />
          <Stack.Screen name="route/[id]" options={{ title: "Route" }} />
          <Stack.Screen name="collection/[id]" options={{ title: "Collection" }} />
        </Stack>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
