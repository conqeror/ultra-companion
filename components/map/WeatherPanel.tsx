import React from "react";
import { View, ScrollView, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "@/components/ui/text";
import {
  Sun, CloudSun, Cloud, CloudFog, CloudDrizzle, CloudRain,
  CloudRainWind, CloudSnow, Snowflake, CloudLightning,
  Wind, ArrowUp, Droplets,
} from "lucide-react-native";
import { useThemeColors } from "@/theme";
import { useWeatherStore } from "@/store/weatherStore";
import { formatTimeAgo } from "@/utils/formatters";
import { getWeatherInfo } from "@/utils/weatherCodes";
import { classifyWind } from "@/services/weatherService";
import type { WeatherPoint, WindRelative } from "@/types";

const ICON_MAP: Record<string, React.ComponentType<{ size: number; color: string }>> = {
  Sun, CloudSun, Cloud, CloudFog, CloudDrizzle, CloudRain,
  CloudRainWind, CloudSnow, Snowflake, CloudLightning,
};

function WeatherIcon({ code, size, color }: { code: number; size: number; color: string }) {
  const info = getWeatherInfo(code);
  const Icon = ICON_MAP[info.icon] ?? Cloud;
  return <Icon size={size} color={color} />;
}

function windColor(rel: WindRelative | null, colors: ReturnType<typeof useThemeColors>): string {
  if (!rel) return colors.textTertiary;
  switch (rel) {
    case "headwind": return colors.destructive;
    case "tailwind": return colors.positive;
    default: return colors.warning;
  }
}

function windArrowRotation(windDirectionDeg: number, routeBearingDeg: number | null): number {
  // Arrow points where wind goes TO (opposite of FROM direction)
  if (routeBearingDeg == null) return (windDirectionDeg + 180) % 360;
  // Relative to route direction: 0 = ahead
  return (windDirectionDeg + 180 - routeBearingDeg + 360) % 360;
}

function windRelativeLabel(rel: WindRelative): string {
  switch (rel) {
    case "headwind": return "Headwind";
    case "tailwind": return "Tailwind";
    case "crosswind-left": return "Crosswind L";
    case "crosswind-right": return "Crosswind R";
  }
}

function formatHour(isoTime: string): string {
  const d = new Date(isoTime);
  return `${d.getHours().toString().padStart(2, "0")}:00`;
}

function formatTemp(tempC: number): string {
  return `${Math.round(tempC)}°`;
}

interface WeatherCellProps {
  point: WeatherPoint;
  colors: ReturnType<typeof useThemeColors>;
}

const WeatherCell = React.memo(function WeatherCell({ point, colors }: WeatherCellProps) {
  const windRel = point.routeBearingDeg != null
    ? classifyWind(point.windDirectionDeg, point.routeBearingDeg)
    : null;
  const rotation = windArrowRotation(point.windDirectionDeg, point.routeBearingDeg);
  const wColor = windColor(windRel, colors);

  return (
    <View className="items-center py-2" style={{ width: 64 }}>
      <Text className="text-[11px] font-barlow-medium text-muted-foreground">
        {formatHour(point.time)}
      </Text>

      <View className="mt-2 mb-1">
        <WeatherIcon code={point.weatherCode} size={22} color={colors.textSecondary} />
      </View>

      <Text className="text-[18px] font-barlow-sc-semibold text-foreground">
        {formatTemp(point.temperatureC)}
      </Text>

      {point.precipitationMm > 0 && (
        <View className="flex-row items-center mt-1">
          <Droplets size={10} color={colors.accent} />
          <Text className="text-[11px] font-barlow-sc-medium ml-1" style={{ color: colors.accent }}>
            {point.precipitationMm.toFixed(1)}
          </Text>
        </View>
      )}

      <View className="flex-row items-center mt-1">
        <View style={{ transform: [{ rotate: `${rotation}deg` }] }}>
          <ArrowUp size={12} color={wColor} />
        </View>
        <Text className="text-[11px] font-barlow-sc-medium ml-1" style={{ color: wColor }}>
          {Math.round(point.windSpeedKmh)}
        </Text>
      </View>
    </View>
  );
});

export default function WeatherPanel() {
  const colors = useThemeColors();
  const { bottom: safeBottom } = useSafeAreaInsets();
  const timeline = useWeatherStore((s) => s.timeline);
  const fetchedAt = useWeatherStore((s) => s.fetchedAt);
  const fetchStatus = useWeatherStore((s) => s.fetchStatus);

  const current = timeline.length > 0 ? timeline[0] : null;

  if (fetchStatus === "fetching") {
    return (
      <View className="items-center justify-center py-6">
        <Text className="text-[13px] text-muted-foreground font-barlow-medium">
          Fetching weather...
        </Text>
      </View>
    );
  }

  if (timeline.length === 0) {
    return (
      <View className="items-center justify-center py-6">
        <Wind size={24} color={colors.textTertiary} />
        <Text className="text-[13px] text-muted-foreground font-barlow-medium mt-2">
          {fetchStatus === "error" ? "Weather unavailable" : "No weather data"}
        </Text>
        <Text className="text-[11px] text-muted-foreground mt-1">
          Weather requires internet connectivity
        </Text>
      </View>
    );
  }

  const weatherInfo = current ? getWeatherInfo(current.weatherCode) : null;
  const currentWindRel = current?.routeBearingDeg != null
    ? classifyWind(current.windDirectionDeg, current.routeBearingDeg)
    : null;

  return (
    <View>
      {/* Header: current summary */}
      {current && (
        <View
          className="flex-row items-center px-4 py-3"
          style={{ borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}
        >
          <WeatherIcon code={current.weatherCode} size={28} color={colors.textPrimary} />
          <Text className="text-[26px] font-barlow-sc-semibold text-foreground ml-2">
            {formatTemp(current.temperatureC)}
          </Text>
          <View className="ml-3 flex-1">
            <Text className="text-[13px] font-barlow-medium text-muted-foreground">
              {weatherInfo?.label}
            </Text>
            {current.windSpeedKmh > 0 && (
              <Text className="text-[13px] font-barlow-sc-medium" style={{ color: windColor(currentWindRel, colors) }}>
                {currentWindRel ? windRelativeLabel(currentWindRel) : ""} {Math.round(current.windSpeedKmh)} km/h
              </Text>
            )}
          </View>
          {fetchedAt && (
            <Text className="text-[11px] font-barlow-medium text-muted-foreground">
              {formatTimeAgo(fetchedAt)}
            </Text>
          )}
        </View>
      )}

      {/* Hourly timeline */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 8, paddingBottom: safeBottom }}
      >
        {timeline.map((point) => (
          <WeatherCell
            key={point.time}
            point={point}
            colors={colors}
          />
        ))}
      </ScrollView>
    </View>
  );
}
