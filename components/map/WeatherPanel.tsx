import React, { useState, useMemo } from "react";
import { View, FlatList, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "@/components/ui/text";
import {
  Sun,
  CloudSun,
  Cloud,
  CloudFog,
  CloudDrizzle,
  CloudRain,
  CloudRainWind,
  CloudSnow,
  Snowflake,
  CloudLightning,
  Wind,
  ArrowUp,
  Droplets,
} from "lucide-react-native";
import { useThemeColors } from "@/theme";
import { useWeatherStore } from "@/store/weatherStore";
import { usePanelStore } from "@/store/panelStore";
import { formatTimeAgo } from "@/utils/formatters";
import { ridingHorizonMetersForMode } from "@/utils/ridingHorizon";
import { getWeatherInfo } from "@/utils/weatherCodes";
import { classifyWind } from "@/services/weatherService";
import type { WeatherPoint, WindRelative } from "@/types";

const ICON_MAP: Record<string, React.ComponentType<{ size: number; color: string }>> = {
  Sun,
  CloudSun,
  Cloud,
  CloudFog,
  CloudDrizzle,
  CloudRain,
  CloudRainWind,
  CloudSnow,
  Snowflake,
  CloudLightning,
};

function WeatherIcon({ code, size, color }: { code: number; size: number; color: string }) {
  const info = getWeatherInfo(code);
  const Icon = ICON_MAP[info.icon] ?? Cloud;
  return <Icon size={size} color={color} />;
}

function windColor(rel: WindRelative | null, colors: ReturnType<typeof useThemeColors>): string {
  if (!rel) return colors.textTertiary;
  switch (rel) {
    case "headwind":
      return colors.destructive;
    case "tailwind":
      return colors.positive;
    default:
      return colors.warning;
  }
}

function windArrowRotation(windDirectionDeg: number, routeBearingDeg: number | null): number {
  if (routeBearingDeg == null) return (windDirectionDeg + 180) % 360;
  return (windDirectionDeg + 180 - routeBearingDeg + 360) % 360;
}

function windRelativeLabel(rel: WindRelative): string {
  switch (rel) {
    case "headwind":
      return "Headwind";
    case "tailwind":
      return "Tailwind";
    case "crosswind-left":
      return "Crosswind L";
    case "crosswind-right":
      return "Crosswind R";
  }
}

function formatHour(isoTime: string): string {
  const d = new Date(isoTime);
  return `${d.getHours().toString().padStart(2, "0")}:00`;
}

function formatTemp(tempC: number): string {
  return `${Math.round(tempC)}°`;
}

/** Vertical row for hourly timeline */
const WeatherRow = React.memo(function WeatherRow({
  point,
  colors,
}: {
  point: WeatherPoint;
  colors: ReturnType<typeof useThemeColors>;
}) {
  const windRel =
    point.routeBearingDeg != null
      ? classifyWind(point.windDirectionDeg, point.routeBearingDeg)
      : null;
  const rotation = windArrowRotation(point.windDirectionDeg, point.routeBearingDeg);
  const wColor = windColor(windRel, colors);

  return (
    <View
      className="flex-row items-center px-4 py-2"
      style={{
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: colors.borderSubtle,
      }}
    >
      {/* Time */}
      <Text className="text-[13px] font-barlow-sc-medium text-muted-foreground w-[48px]">
        {formatHour(point.time)}
      </Text>

      {/* Icon */}
      <View className="w-[28px] items-center">
        <WeatherIcon code={point.weatherCode} size={18} color={colors.textSecondary} />
      </View>

      {/* Temp */}
      <Text className="text-[18px] font-barlow-sc-semibold text-foreground w-[40px] text-right">
        {formatTemp(point.temperatureC)}
      </Text>

      {/* Precip */}
      <View className="w-[48px] flex-row items-center justify-end">
        {point.precipitationMm > 0 ? (
          <>
            <Droplets size={11} color={colors.accent} />
            <Text
              className="text-[12px] font-barlow-sc-medium ml-1"
              style={{ color: colors.accent }}
            >
              {point.precipitationMm.toFixed(1)}
            </Text>
          </>
        ) : null}
      </View>

      {/* Wind */}
      <View className="flex-1 flex-row items-center justify-end">
        <View style={{ transform: [{ rotate: `${rotation}deg` }] }}>
          <ArrowUp size={13} color={wColor} />
        </View>
        <Text className="text-[13px] font-barlow-sc-medium ml-1 w-[28px]" style={{ color: wColor }}>
          {Math.round(point.windSpeedKmh)}
        </Text>
        {windRel && (
          <Text
            className="text-[11px] font-barlow-medium ml-1"
            style={{ color: wColor }}
            numberOfLines={1}
          >
            {windRelativeLabel(windRel)}
          </Text>
        )}
      </View>
    </View>
  );
});

/** Estimated row height: 18px font + 8+8 py-2 + hairline border */
const ROW_HEIGHT_ESTIMATE = 36;

function TimelineList({
  timeline,
  colors,
  isExpanded,
}: {
  timeline: WeatherPoint[];
  colors: ReturnType<typeof useThemeColors>;
  isExpanded: boolean;
}) {
  const { bottom: safeBottom } = useSafeAreaInsets();
  const [listHeight, setListHeight] = useState(0);

  const visibleData = useMemo(() => {
    if (isExpanded || listHeight === 0) return timeline;
    const maxRows = Math.floor(listHeight / ROW_HEIGHT_ESTIMATE);
    return timeline.slice(0, maxRows);
  }, [timeline, isExpanded, listHeight]);

  return (
    <View
      className="flex-1"
      onLayout={(e) => setListHeight(Math.round(e.nativeEvent.layout.height))}
    >
      <FlatList
        data={visibleData}
        keyExtractor={(item) => item.time}
        renderItem={({ item }) => <WeatherRow point={item} colors={colors} />}
        showsVerticalScrollIndicator={false}
        scrollEnabled={isExpanded}
        contentContainerStyle={{ paddingBottom: safeBottom }}
      />
    </View>
  );
}

export default function WeatherPanel() {
  const colors = useThemeColors();
  const timeline = useWeatherStore((s) => s.timeline);
  const fetchedAt = useWeatherStore((s) => s.fetchedAt);
  const fetchStatus = useWeatherStore((s) => s.fetchStatus);
  const isExpanded = usePanelStore((s) => s.isExpanded);
  const panelMode = usePanelStore((s) => s.panelMode);
  const ridingHorizonMeters = ridingHorizonMetersForMode(panelMode);
  const horizonTimeline = useMemo(
    () =>
      ridingHorizonMeters == null
        ? timeline
        : timeline.filter((point) => point.distanceAlongRouteM <= ridingHorizonMeters),
    [timeline, ridingHorizonMeters],
  );

  const current = horizonTimeline.length > 0 ? horizonTimeline[0] : null;

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

  if (horizonTimeline.length === 0) {
    return (
      <View className="items-center justify-center py-6">
        <Wind size={24} color={colors.textTertiary} />
        <Text className="text-[13px] text-muted-foreground font-barlow-medium mt-2">
          No weather inside this horizon
        </Text>
      </View>
    );
  }

  const weatherInfo = current ? getWeatherInfo(current.weatherCode) : null;
  const currentWindRel =
    current?.routeBearingDeg != null
      ? classifyWind(current.windDirectionDeg, current.routeBearingDeg)
      : null;

  return (
    <View className="flex-1">
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
              <Text
                className="text-[13px] font-barlow-sc-medium"
                style={{ color: windColor(currentWindRel, colors) }}
              >
                {currentWindRel ? windRelativeLabel(currentWindRel) : ""}{" "}
                {Math.round(current.windSpeedKmh)} km/h
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

      {/* Hourly timeline — vertical rows */}
      <TimelineList timeline={horizonTimeline.slice(1)} colors={colors} isExpanded={isExpanded} />
    </View>
  );
}
