import { useMemo } from "react";
import { useColorScheme } from "nativewind";
import { MAP_STYLE_URL } from "@/types";
import darkStyle from "@/assets/map-styles/outdoors-v12-dark.json";

const darkStyleString = JSON.stringify(darkStyle);

/**
 * Returns the correct Mapbox style props for the current color scheme,
 * plus a `styleKey` that changes when the style switches. Use `styleKey`
 * as a React key on custom layers so they re-mount cleanly after a style swap.
 *
 * Spread the style onto MapView: `<MapView {...mapStyle.props} />`
 */
export function useMapStyle() {
  const { colorScheme } = useColorScheme();
  return useMemo(() => {
    const isDark = colorScheme === "dark";
    return {
      props: isDark
        ? { styleJSON: darkStyleString }
        : { styleURL: MAP_STYLE_URL },
      styleKey: isDark ? "dark" : "light",
    };
  }, [colorScheme]);
}
