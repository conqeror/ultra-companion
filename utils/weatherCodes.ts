/**
 * WMO Weather interpretation codes -> icon name (lucide) + label.
 * Reference: https://open-meteo.com/en/docs#weathervariables
 */

import type { WeatherPoint } from "@/types";

export type ConditionColorRole = "sun" | "night" | "cloud" | "fog" | "rain" | "ice" | "storm";

export type WeatherSeverity = "info" | "caution" | "warning" | "danger";

export interface WeatherCodeInfo {
  label: string;
  icon: string;
  colorRole: ConditionColorRole;
}

export interface WeatherRiskInfo {
  severity: WeatherSeverity;
  hazard: string;
  impact: string;
  action: string;
}

const WMO_CODES: Record<number, WeatherCodeInfo> = {
  0: { label: "Clear", icon: "Sun", colorRole: "sun" },
  1: { label: "Mostly clear", icon: "CloudSun", colorRole: "sun" },
  2: { label: "Partly cloudy", icon: "CloudSun", colorRole: "cloud" },
  3: { label: "Overcast", icon: "Cloud", colorRole: "cloud" },
  45: { label: "Fog", icon: "CloudFog", colorRole: "fog" },
  48: { label: "Rime fog", icon: "CloudFog", colorRole: "fog" },
  51: { label: "Light drizzle", icon: "CloudDrizzle", colorRole: "rain" },
  53: { label: "Drizzle", icon: "CloudDrizzle", colorRole: "rain" },
  55: { label: "Dense drizzle", icon: "CloudDrizzle", colorRole: "rain" },
  56: { label: "Freezing drizzle", icon: "CloudSnow", colorRole: "ice" },
  57: { label: "Heavy freezing drizzle", icon: "CloudSnow", colorRole: "ice" },
  61: { label: "Light rain", icon: "CloudRain", colorRole: "rain" },
  63: { label: "Rain", icon: "CloudRain", colorRole: "rain" },
  65: { label: "Heavy rain", icon: "CloudRainWind", colorRole: "rain" },
  66: { label: "Freezing rain", icon: "CloudSnow", colorRole: "ice" },
  67: { label: "Heavy freezing rain", icon: "CloudSnow", colorRole: "ice" },
  71: { label: "Light snow", icon: "Snowflake", colorRole: "ice" },
  73: { label: "Snow", icon: "Snowflake", colorRole: "ice" },
  75: { label: "Heavy snow", icon: "Snowflake", colorRole: "ice" },
  77: { label: "Snow grains", icon: "Snowflake", colorRole: "ice" },
  80: { label: "Light showers", icon: "CloudRain", colorRole: "rain" },
  81: { label: "Showers", icon: "CloudRain", colorRole: "rain" },
  82: { label: "Heavy showers", icon: "CloudRainWind", colorRole: "rain" },
  85: { label: "Snow showers", icon: "Snowflake", colorRole: "ice" },
  86: { label: "Heavy snow showers", icon: "Snowflake", colorRole: "ice" },
  95: { label: "Thunderstorm", icon: "CloudLightning", colorRole: "storm" },
  96: { label: "Thunderstorm + hail", icon: "CloudLightning", colorRole: "storm" },
  99: { label: "Thunderstorm + heavy hail", icon: "CloudLightning", colorRole: "storm" },
};

const FALLBACK: WeatherCodeInfo = { label: "Unknown", icon: "Cloud", colorRole: "cloud" };

export function getWeatherInfo(code: number, isDay = true): WeatherCodeInfo {
  const info = WMO_CODES[code] ?? FALLBACK;
  if (code === 0 && !isDay) return { ...info, icon: "Moon", colorRole: "night" };
  if ((code === 1 || code === 2) && !isDay) {
    return { ...info, icon: "CloudMoon", colorRole: "night" };
  }
  return info;
}

export function getWeatherRisk(point: WeatherPoint): WeatherRiskInfo | null {
  const code = point.weatherCode;

  if (code === 95 || code === 96 || code === 99) {
    return {
      severity: "danger",
      hazard: code === 95 ? "Thunderstorm" : "Thunderstorm + hail",
      impact: "Lightning/hail risk.",
      action: "Seek indoor shelter; avoid exposed ridges and trees.",
    };
  }

  if (code === 66 || code === 67 || code === 56 || code === 57) {
    return {
      severity: "danger",
      hazard: "Freezing rain",
      impact: "Ice risk on roads.",
      action: "Stop or re-route until conditions improve.",
    };
  }

  if (code === 65 || code === 82 || point.precipitationMm >= 5) {
    return {
      severity: "warning",
      hazard: "Heavy rain",
      impact: "Reduced visibility and braking.",
      action: "Consider delaying or choosing safer stops.",
    };
  }

  if (point.windGustKmh >= 50 || point.windSpeedKmh >= 35) {
    return {
      severity: point.windGustKmh >= 70 ? "danger" : "warning",
      hazard: "High wind",
      impact: "Strong gusts on exposed roads.",
      action: "Avoid ridges, bridges, and forest sections.",
    };
  }

  if (point.temperatureC >= 34) {
    return {
      severity: "warning",
      hazard: "Extreme heat",
      impact: "Heat illness risk.",
      action: "Plan shade, water, and indoor stops.",
    };
  }

  if (point.temperatureC <= -3) {
    return {
      severity: "warning",
      hazard: "Extreme cold",
      impact: "Hypothermia risk.",
      action: "Add layers; plan warm stops.",
    };
  }

  if (point.precipitationProbability >= 70 || point.precipitationMm >= 1) {
    return {
      severity: "caution",
      hazard: "Wet roads",
      impact: "Rain likely on route.",
      action: "Check layers and braking distance.",
    };
  }

  return null;
}
