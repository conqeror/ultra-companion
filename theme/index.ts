import { useColorScheme } from "nativewind";
import { COLORS } from "./colors";

export { COLORS, type ThemeColors } from "./colors";
export { gradientColor, ELEVATION_STOPS } from "./elevation";

export function useThemeColors() {
  const { colorScheme } = useColorScheme();
  return COLORS[colorScheme ?? "light"];
}
