import { ExpoConfig, ConfigContext } from "expo/config";

export default ({ config }: ConfigContext): ExpoConfig => ({
  name: "Ultra Companion",
  slug: "ultra-companion",
  version: "1.0.0",
  orientation: "portrait",
  icon: "./assets/images/icon.png",
  scheme: "ultra",
  userInterfaceStyle: "automatic",
  splash: {
    image: "./assets/images/splash-icon.png",
    resizeMode: "contain",
    backgroundColor: "#0E0E0C",
  },
  android: {
    adaptiveIcon: {
      foregroundImage: "./assets/images/android-icon-foreground.png",
      backgroundImage: "./assets/images/android-icon-background.png",
      monochromeImage: "./assets/images/android-icon-monochrome.png",
    },
  },
  ios: {
    supportsTablet: false,
    bundleIdentifier: "com.ultra.companion",
    infoPlist: {
      NSLocationWhenInUseUsageDescription:
        "Ultra Companion needs your location to show your position on the map during rides.",
      NSLocationAlwaysAndWhenInUseUsageDescription:
        "Ultra Companion uses background location to track your position during ultra-distance rides.",
    },
  },
  web: {
    bundler: "metro",
    output: "static",
    favicon: "./assets/images/favicon.png",
  },
  plugins: [
    "expo-router",
    "@rnmapbox/maps",
    [
      "expo-location",
      {
        locationWhenInUsePermission:
          "Ultra Companion needs your location to show your position on the map during rides.",
        locationAlwaysAndWhenInUsePermission:
          "Ultra Companion uses background location to track your position during ultra-distance rides.",
      },
    ],
    "expo-sqlite",
  ],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    mapboxAccessToken: process.env.MAPBOX_ACCESS_TOKEN,
  },
});
