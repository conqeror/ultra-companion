import { Stack } from "expo-router";
import { ThemeProvider, type Theme } from "@react-navigation/native";
import * as SplashScreen from "expo-splash-screen";
import { useFonts } from "expo-font";
import { useEffect } from "react";
import { useColorScheme } from "nativewind";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import "react-native-reanimated";
import "../global.css";
import { useOfflineStore } from "@/store/offlineStore";
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
          <Stack.Screen name="route/[id]" options={{ title: "Route" }} />
          <Stack.Screen name="collection/[id]" options={{ title: "Collection" }} />
        </Stack>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
