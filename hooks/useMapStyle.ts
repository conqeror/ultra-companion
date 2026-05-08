import { useMemo } from "react";
import { useColorScheme } from "nativewind";
import lightStyle from "@/assets/map-styles/outdoors-v12.json";
import darkStyle from "@/assets/map-styles/outdoors-v12-dark.json";

const lightStyleString = JSON.stringify(lightStyle);
const darkStyleString = JSON.stringify(darkStyle);

/**
 * Returns the correct Mapbox style props for the current color scheme,
 * plus a `styleKey` that changes when the style switches. Use `styleKey`
 * as a React key on custom layers so they re-mount cleanly after a style swap.
 *
 * Spread the style onto MapView: `<MapView {...mapStyle.props} />`.
 * Both modes use checked-in styles so custom layer anchors stay stable.
 */
export function useMapStyle() {
  const { colorScheme } = useColorScheme();
  return useMemo(() => {
    const isDark = colorScheme === "dark";
    return {
      props: { styleJSON: isDark ? darkStyleString : lightStyleString },
      styleKey: isDark ? "dark" : "light",
    };
  }, [colorScheme]);
}
