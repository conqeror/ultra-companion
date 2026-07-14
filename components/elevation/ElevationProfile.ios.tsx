import type { ComponentType } from "react";
import { TurboModuleRegistry, type TurboModule } from "react-native";

import ElevationProfileSvg from "./ElevationProfileSvg";
import type { ElevationProfileProps } from "./elevationProfileTypes";

interface SkiaNativeModule extends TurboModule {
  install: () => boolean;
}

const skiaRequested = process.env.EXPO_PUBLIC_ELEVATION_RENDERER !== "svg";
const skiaNativeModule = TurboModuleRegistry.get<SkiaNativeModule>("RNSkiaModule");
const useSkiaRenderer = skiaRequested && typeof skiaNativeModule?.install === "function";

if (skiaRequested && !useSkiaRenderer) {
  console.warn("Native Skia module is unavailable; using the SVG elevation renderer.");
}

function loadSkiaRenderer(): ComponentType<ElevationProfileProps> | null {
  if (!useSkiaRenderer) return null;

  try {
    // Metro discovers this static require, but it does not evaluate Skia unless requested.
    return require("./ElevationProfileSkia.ios").default as ComponentType<ElevationProfileProps>;
  } catch (error) {
    console.warn("Native Skia initialization failed; using the SVG elevation renderer.", error);
    return null;
  }
}

const ElevationProfileSkia = loadSkiaRenderer();

export default function ElevationProfile(props: ElevationProfileProps) {
  return ElevationProfileSkia ? (
    <ElevationProfileSkia {...props} />
  ) : (
    <ElevationProfileSvg {...props} />
  );
}

export type { ElevationProfileProps } from "./elevationProfileTypes";
