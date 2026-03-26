/**
 * WMO Weather interpretation codes → icon name (lucide) + label.
 * Reference: https://open-meteo.com/en/docs#weathervariables
 */

interface WeatherCodeInfo {
  label: string;
  icon: string; // lucide-react-native icon name
}

const WMO_CODES: Record<number, WeatherCodeInfo> = {
  0: { label: "Clear", icon: "Sun" },
  1: { label: "Mostly clear", icon: "Sun" },
  2: { label: "Partly cloudy", icon: "CloudSun" },
  3: { label: "Overcast", icon: "Cloud" },
  45: { label: "Fog", icon: "CloudFog" },
  48: { label: "Rime fog", icon: "CloudFog" },
  51: { label: "Light drizzle", icon: "CloudDrizzle" },
  53: { label: "Drizzle", icon: "CloudDrizzle" },
  55: { label: "Dense drizzle", icon: "CloudDrizzle" },
  56: { label: "Freezing drizzle", icon: "CloudSnow" },
  57: { label: "Heavy freezing drizzle", icon: "CloudSnow" },
  61: { label: "Light rain", icon: "CloudRain" },
  63: { label: "Rain", icon: "CloudRain" },
  65: { label: "Heavy rain", icon: "CloudRainWind" },
  66: { label: "Freezing rain", icon: "CloudSnow" },
  67: { label: "Heavy freezing rain", icon: "CloudSnow" },
  71: { label: "Light snow", icon: "Snowflake" },
  73: { label: "Snow", icon: "Snowflake" },
  75: { label: "Heavy snow", icon: "Snowflake" },
  77: { label: "Snow grains", icon: "Snowflake" },
  80: { label: "Light showers", icon: "CloudRain" },
  81: { label: "Showers", icon: "CloudRain" },
  82: { label: "Heavy showers", icon: "CloudRainWind" },
  85: { label: "Snow showers", icon: "Snowflake" },
  86: { label: "Heavy snow showers", icon: "Snowflake" },
  95: { label: "Thunderstorm", icon: "CloudLightning" },
  96: { label: "Thunderstorm + hail", icon: "CloudLightning" },
  99: { label: "Thunderstorm + heavy hail", icon: "CloudLightning" },
};

const FALLBACK: WeatherCodeInfo = { label: "Unknown", icon: "Cloud" };

export function getWeatherInfo(code: number): WeatherCodeInfo {
  return WMO_CODES[code] ?? FALLBACK;
}
