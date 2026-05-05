import type { WeatherPoint, WeatherTemperatureDisplayMode } from "@/types";

export type TemperatureComfortBucket =
  | "cold-risk"
  | "cool"
  | "comfortable"
  | "warm"
  | "hot-risk"
  | "unknown";

export const TEMPERATURE_COMFORT_STOPS = [
  { bucket: "cold-risk", minC: -Infinity, color: "#2563EB", label: "Cold risk" },
  { bucket: "cool", minC: 5, color: "#0284C7", label: "Cool" },
  { bucket: "comfortable", minC: 12, color: "#0D9488", label: "Comfortable" },
  { bucket: "warm", minC: 22, color: "#D97706", label: "Warm" },
  { bucket: "hot-risk", minC: 30, color: "#DC2626", label: "Hot risk" },
] as const;

const UNKNOWN_TEMPERATURE_COLOR = "#9C958E";
const TEMPERATURE_GRADIENT_MARGIN_C = 10;

export function displayTemperatureC(
  point: WeatherPoint,
  mode: WeatherTemperatureDisplayMode,
): number {
  if (mode === "feels-like" && Number.isFinite(point.apparentTemperatureC)) {
    return point.apparentTemperatureC;
  }
  return point.temperatureC;
}

type RgbColor = { r: number; g: number; b: number };

function hexToRgb(hex: string): RgbColor | null {
  const value = hex.replace("#", "");
  if (value.length !== 6) return null;

  const parsed = Number.parseInt(value, 16);
  if (!Number.isFinite(parsed)) return null;

  return {
    r: (parsed >> 16) & 255,
    g: (parsed >> 8) & 255,
    b: parsed & 255,
  };
}

function colorChannelToHex(channel: number): string {
  const rounded = Math.max(0, Math.min(255, Math.round(channel)));
  return rounded.toString(16).padStart(2, "0");
}

function rgbToHex(color: RgbColor): string {
  return `#${colorChannelToHex(color.r)}${colorChannelToHex(color.g)}${colorChannelToHex(color.b)}`;
}

function mixHexColors(fromHex: string, toHex: string, progress: number): string {
  const from = hexToRgb(fromHex);
  const to = hexToRgb(toHex);
  if (!from || !to) return progress < 0.5 ? fromHex : toHex;

  return rgbToHex({
    r: from.r + (to.r - from.r) * progress,
    g: from.g + (to.g - from.g) * progress,
    b: from.b + (to.b - from.b) * progress,
  });
}

export function classifyTemperatureComfort(temperatureC: number): TemperatureComfortBucket {
  if (!Number.isFinite(temperatureC)) return "unknown";

  let bucket: TemperatureComfortBucket = TEMPERATURE_COMFORT_STOPS[0].bucket;
  for (const stop of TEMPERATURE_COMFORT_STOPS) {
    if (temperatureC >= stop.minC) bucket = stop.bucket;
  }
  return bucket;
}

export function temperatureColor(temperatureC: number): string {
  const bucket = classifyTemperatureComfort(temperatureC);
  if (bucket === "unknown") return UNKNOWN_TEMPERATURE_COLOR;
  return (
    TEMPERATURE_COMFORT_STOPS.find((stop) => stop.bucket === bucket)?.color ??
    UNKNOWN_TEMPERATURE_COLOR
  );
}

export function temperatureGradientColor(temperatureC: number): string {
  if (!Number.isFinite(temperatureC)) return UNKNOWN_TEMPERATURE_COLOR;

  const finiteStops = TEMPERATURE_COMFORT_STOPS.filter((stop) => Number.isFinite(stop.minC));
  const firstFiniteStop = finiteStops[0];
  const lastFiniteStop = finiteStops[finiteStops.length - 1];
  const anchors = [
    {
      temperatureC: firstFiniteStop.minC - TEMPERATURE_GRADIENT_MARGIN_C,
      color: TEMPERATURE_COMFORT_STOPS[0].color,
    },
    ...finiteStops.map((stop) => ({ temperatureC: stop.minC, color: stop.color })),
    {
      temperatureC: lastFiniteStop.minC + TEMPERATURE_GRADIENT_MARGIN_C,
      color: lastFiniteStop.color,
    },
  ];

  if (temperatureC <= anchors[0].temperatureC) return anchors[0].color;

  for (let index = 1; index < anchors.length; index++) {
    const previous = anchors[index - 1];
    const next = anchors[index];
    if (temperatureC <= next.temperatureC) {
      const range = next.temperatureC - previous.temperatureC;
      const progress = range > 0 ? (temperatureC - previous.temperatureC) / range : 0;
      return mixHexColors(previous.color, next.color, progress);
    }
  }

  return anchors[anchors.length - 1].color;
}
