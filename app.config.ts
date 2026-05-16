import { ExpoConfig, ConfigContext } from "expo/config";

export default (_: ConfigContext): ExpoConfig => ({
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
    package: "com.ultra.companion",
    adaptiveIcon: {
      foregroundImage: "./assets/images/android-icon-foreground.png",
      backgroundImage: "./assets/images/android-icon-background.png",
      monochromeImage: "./assets/images/android-icon-monochrome.png",
    },
  },
  ios: {
    supportsTablet: false,
    bundleIdentifier: "com.conqeror.ultracompanion",
    infoPlist: {
      NSLocationWhenInUseUsageDescription:
        "Ultra Companion needs your location to show your position on the map during rides.",
      CFBundleDocumentTypes: [
        {
          CFBundleTypeName: "GPX File",
          CFBundleTypeRole: "Viewer",
          LSHandlerRank: "Alternate",
          LSItemContentTypes: ["com.topografix.gpx"],
        },
        {
          CFBundleTypeName: "KML File",
          CFBundleTypeRole: "Viewer",
          LSHandlerRank: "Alternate",
          LSItemContentTypes: ["com.google.earth.kml"],
        },
        {
          CFBundleTypeName: "Ultra Planner Database",
          CFBundleTypeRole: "Viewer",
          LSHandlerRank: "Alternate",
          LSItemContentTypes: ["com.conqeror.ultracompanion.plan-db"],
        },
      ],
      UTImportedTypeDeclarations: [
        {
          UTTypeIdentifier: "com.topografix.gpx",
          UTTypeDescription: "GPX File",
          UTTypeConformsTo: ["public.xml"],
          UTTypeTagSpecification: {
            "public.filename-extension": ["gpx"],
            "public.mime-type": ["application/gpx+xml"],
          },
        },
        {
          UTTypeIdentifier: "com.google.earth.kml",
          UTTypeDescription: "KML File",
          UTTypeConformsTo: ["public.xml"],
          UTTypeTagSpecification: {
            "public.filename-extension": ["kml"],
            "public.mime-type": ["application/vnd.google-earth.kml+xml"],
          },
        },
        {
          UTTypeIdentifier: "com.conqeror.ultracompanion.plan-db",
          UTTypeDescription: "Ultra Planner Database",
          UTTypeConformsTo: ["public.data"],
          UTTypeTagSpecification: {
            "public.filename-extension": ["ultra-plan.db", "db"],
            "public.mime-type": ["application/x-sqlite3"],
          },
        },
      ],
    },
  },
  web: {
    bundler: "metro",
    output: "static",
    favicon: "./assets/images/favicon.png",
  },
  plugins: [
    [
      "expo-router",
      {
        headers: {
          "Cross-Origin-Embedder-Policy": "credentialless",
          "Cross-Origin-Opener-Policy": "same-origin",
        },
      },
    ],
    "@rnmapbox/maps",
    [
      "expo-location",
      {
        locationWhenInUsePermission:
          "Ultra Companion needs your location to show your position on the map during rides.",
      },
    ],
    "expo-sqlite",
    "./plugins/withShareSheetImport",
  ],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    mapboxAccessToken: process.env.MAPBOX_ACCESS_TOKEN,
    googlePlacesApiKey: process.env.GOOGLE_PLACES_API_KEY,
    eas: {
      projectId: "cf1ced74-65cd-43ab-8521-6a76eea57adf",
    },
  },
});
