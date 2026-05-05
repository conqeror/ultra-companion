import React, { useCallback, useMemo } from "react";
import { View, FlatList, RefreshControl, StyleSheet, type ListRenderItem } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "@/components/ui/text";
import {
  Sun,
  Moon,
  CloudSun,
  CloudMoon,
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
  AlertTriangle,
} from "lucide-react-native";
import { useThemeColors } from "@/theme";
import { useWeatherStore } from "@/store/weatherStore";
import { usePanelStore } from "@/store/panelStore";
import { useRouteStore } from "@/store/routeStore";
import { useEtaStore } from "@/store/etaStore";
import { useOfflineStore } from "@/store/offlineStore";
import { useCollectionStore } from "@/store/collectionStore";
import { usePoiStore } from "@/store/poiStore";
import { formatTimeAgo } from "@/utils/formatters";
import { activeRouteTiming } from "@/utils/activeRouteTiming";
import { ridingHorizonMetersForMode } from "@/utils/ridingHorizon";
import { temperatureGradientColor } from "@/utils/temperatureOverlay";
import {
  getWeatherInfo,
  getWeatherRisk,
  type ConditionColorRole,
  type WeatherRiskInfo,
  type WeatherSeverity,
} from "@/utils/weatherCodes";
import { classifyWind } from "@/services/weatherService";
import { displayPOIsForActiveRoute } from "@/services/activePOIs";
import { plannedStopsFromPOIs } from "@/services/plannedStops";
import type { ActiveRouteData, WeatherPoint, WindRelative } from "@/types";

type TimelineListItem =
  | { type: "weather"; key: string; point: WeatherPoint }
  | { type: "day"; key: string; label: string };

const ICON_MAP: Record<string, React.ComponentType<{ size: number; color: string }>> = {
  Sun,
  Moon,
  CloudSun,
  CloudMoon,
  Cloud,
  CloudFog,
  CloudDrizzle,
  CloudRain,
  CloudRainWind,
  CloudSnow,
  Snowflake,
  CloudLightning,
};

function conditionColor(
  role: ConditionColorRole,
  colors: ReturnType<typeof useThemeColors>,
): string {
  switch (role) {
    case "sun":
      return colors.warning;
    case "night":
    case "rain":
    case "ice":
    case "fog":
    case "cloud":
      return colors.info;
    case "storm":
      return colors.warning;
  }
}

function WeatherIcon({ point, size }: { point: WeatherPoint; size: number }) {
  const colors = useThemeColors();
  const info = getWeatherInfo(point.weatherCode, point.isDay);
  const Icon = ICON_MAP[info.icon] ?? Cloud;
  return <Icon size={size} color={conditionColor(info.colorRole, colors)} />;
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

function gustColor(
  gustKmh: number,
  windKmh: number,
  colors: ReturnType<typeof useThemeColors>,
): string {
  const diff = gustKmh - windKmh;
  if (gustKmh >= 45 || diff >= 20) return colors.destructive;
  if (gustKmh >= 35 || diff >= 12) return colors.warning;
  return colors.textSecondary;
}

function severityColor(
  severity: WeatherSeverity,
  colors: ReturnType<typeof useThemeColors>,
): string {
  switch (severity) {
    case "danger":
      return colors.destructive;
    case "warning":
    case "caution":
      return colors.warning;
    case "info":
      return colors.info;
  }
}

function weatherRiskPresentation(
  risk: WeatherRiskInfo,
  colors: ReturnType<typeof useThemeColors>,
): { color: string; Icon: React.ComponentType<{ size: number; color: string }> } {
  const hazard = risk.hazard.toLowerCase();
  if (hazard.includes("cold") || hazard.includes("freezing")) {
    return { color: colors.info, Icon: Snowflake };
  }
  if (hazard.includes("thunder")) {
    return {
      color: risk.severity === "danger" ? colors.destructive : colors.warning,
      Icon: CloudLightning,
    };
  }
  if (hazard.includes("rain") || hazard.includes("wet")) {
    return { color: risk.severity === "caution" ? colors.info : colors.warning, Icon: CloudRain };
  }
  if (hazard.includes("wind")) {
    return { color: colors.warning, Icon: Wind };
  }
  return { color: severityColor(risk.severity, colors), Icon: AlertTriangle };
}

function formatHour(isoTime: string): string {
  const d = new Date(isoTime);
  if (Number.isNaN(d.getTime())) return "--:--";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatTemp(tempC: number): string {
  return `${Math.round(tempC)}°`;
}

function formatDistanceKm(distanceMeters: number): string {
  return `${Math.round(distanceMeters / 1_000)} km`;
}

function formatStartLabel(startMs: number | null): string {
  if (startMs == null) return "Now";
  const date = new Date(startMs);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const tomorrow = today + 24 * 3600_000;
  const dateDay = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (dateDay === today) return `Today ${time}`;
  if (dateDay === tomorrow) return `Tomorrow ${time}`;
  return `${date.toLocaleDateString([], { weekday: "short" })} ${time}`;
}

function isPrecipitationCode(code: number): boolean {
  return (
    (code >= 51 && code <= 67) ||
    (code >= 71 && code <= 77) ||
    (code >= 80 && code <= 86) ||
    code === 95 ||
    code === 96 ||
    code === 99
  );
}

function precipitationLabel(point: WeatherPoint): string | null {
  const probability = Math.round(point.precipitationProbability);
  if (point.precipitationMm >= 0.1 && probability > 0) {
    return `${point.precipitationMm.toFixed(1)}mm ${probability}%`;
  }
  if (point.precipitationMm >= 0.1) return `${point.precipitationMm.toFixed(1)}mm`;
  if (probability > 0 || isPrecipitationCode(point.weatherCode)) return `${probability}%`;
  return null;
}

function weatherTimelineDate(point: WeatherPoint): Date | null {
  const date = new Date(point.etaTime ?? point.time);
  return Number.isNaN(date.getTime()) ? null : date;
}

function weatherTimelineDayKey(point: WeatherPoint): string | null {
  const date = weatherTimelineDate(point);
  if (!date) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function weatherTimelineDayLabel(point: WeatherPoint): string | null {
  const date = weatherTimelineDate(point);
  if (!date) return null;
  return date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

function weatherPointKey(point: WeatherPoint, index: number): string {
  return `${point.etaTime ?? point.time}-${Math.round(point.routeDistanceMeters)}-${index}`;
}

function WeatherRiskBadge({ risk }: { risk: WeatherRiskInfo }) {
  const colors = useThemeColors();
  const { color, Icon } = weatherRiskPresentation(risk, colors);
  return (
    <View className="h-[28px] w-[28px] items-center justify-center rounded-full bg-muted">
      <Icon size={16} color={color} />
    </View>
  );
}

const WeatherRow = React.memo(function WeatherRow({ point }: { point: WeatherPoint }) {
  const colors = useThemeColors();
  const windRel =
    point.routeBearingDeg != null
      ? classifyWind(point.windDirectionDeg, point.routeBearingDeg)
      : null;
  const rotation = windArrowRotation(point.windDirectionDeg, point.routeBearingDeg);
  const wColor = windColor(windRel, colors);
  const displayTempC = point.temperatureC;
  const tempColor = temperatureGradientColor(displayTempC);
  const weatherInfo = getWeatherInfo(point.weatherCode, point.isDay);
  const risk = getWeatherRisk(point);
  const riskVisual = risk ? weatherRiskPresentation(risk, colors) : null;
  const precip = precipitationLabel(point);
  const wind = Math.round(point.windSpeedKmh);
  const gust = Math.round(point.windGustKmh);
  const windLabel = windRel ?? "wind";
  const riskLabel = risk ? `${risk.hazard}. ${risk.impact} ${risk.action}` : null;
  const accessibilityLabel = [
    formatHour(point.etaTime),
    formatDistanceKm(point.routeDistanceMeters),
    weatherInfo.label,
    formatTemp(displayTempC),
    precip ? `precipitation ${precip}` : "no precipitation expected",
    `${windLabel} ${wind} kilometers per hour, gust ${gust}`,
    riskLabel,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <View
      className="px-3 py-2"
      style={{
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: colors.borderSubtle,
      }}
      accessibilityLabel={accessibilityLabel}
    >
      <View className="min-h-[52px] flex-row items-center">
        <View className="w-[52px]">
          <Text className="text-[15px] font-barlow-sc-semibold text-foreground" numberOfLines={1}>
            {formatHour(point.etaTime)}
          </Text>
          <Text
            className="text-[13px] font-barlow-sc-semibold text-muted-foreground"
            numberOfLines={1}
          >
            {formatDistanceKm(point.routeDistanceMeters)}
          </Text>
        </View>
        <Text
          className="text-[24px] font-barlow-sc-semibold text-right"
          style={{ width: 46, color: tempColor }}
        >
          {formatTemp(displayTempC)}
        </Text>
        <View className="flex-1 flex-row items-center min-w-0 ml-2">
          <WeatherIcon point={point} size={24} />
          <Text
            className="ml-1.5 text-[14px] font-barlow-semibold text-foreground flex-shrink"
            numberOfLines={1}
          >
            {weatherInfo.label}
          </Text>
          {risk && (
            <View className="ml-1.5">
              <WeatherRiskBadge risk={risk} />
            </View>
          )}
        </View>
        <View className="w-[58px] items-center">
          {precip && (
            <Text
              className="text-[14px] font-barlow-sc-semibold text-center"
              style={{ color: colors.info }}
              numberOfLines={2}
              adjustsFontSizeToFit
              minimumFontScale={0.82}
            >
              {precip}
            </Text>
          )}
        </View>
        <View className="w-[74px] flex-row items-center justify-end">
          <View style={{ transform: [{ rotate: `${rotation}deg` }] }}>
            <ArrowUp size={17} color={wColor} />
          </View>
          <Text
            className="text-[20px] font-barlow-sc-semibold ml-1"
            style={{ color: wColor }}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.8}
          >
            {wind}{" "}
            <Text
              className="text-[16px] font-barlow-sc-semibold"
              style={{ color: gustColor(gust, wind, colors) }}
            >
              ({gust})
            </Text>
          </Text>
        </View>
      </View>
      {risk && riskVisual && (
        <View className="py-2 px-3 rounded-md bg-muted mt-1">
          <View className="flex-row items-center justify-center">
            <riskVisual.Icon size={17} color={riskVisual.color} />
            <Text
              className="text-[16px] font-barlow-sc-semibold ml-2"
              style={{ color: riskVisual.color }}
              numberOfLines={1}
            >
              {risk.hazard}
            </Text>
          </View>
          <Text className="text-[14px] font-barlow-medium text-muted-foreground mt-1 text-center">
            {risk.impact} {risk.action}
          </Text>
        </View>
      )}
    </View>
  );
});

function TimelineDayHeader({ label }: { label: string }) {
  return (
    <View className="px-3 pt-2 pb-0.5 bg-surface items-center" accessibilityRole="header">
      <Text className="text-[11px] font-barlow-semibold text-muted-foreground" numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function buildRefreshContext(activeData: ActiveRouteData | null) {
  if (!activeData?.points.length) return null;
  const cumulativeTime = useEtaStore.getState().cumulativeTime;
  if (!cumulativeTime) return null;
  const timing = activeRouteTiming(activeData, useCollectionStore.getState().collections);
  const plannedStops = plannedStopsFromPOIs(
    displayPOIsForActiveRoute(
      activeData.routeIds,
      activeData.segments,
      usePoiStore.getState().pois,
    ),
  );
  const snapped = useRouteStore.getState().snappedPosition;
  const isValidSnap =
    timing.futureStartMs == null &&
    snapped?.routeId === activeData.id &&
    snapped.distanceFromRouteMeters <= 1000;

  return {
    routeId: activeData.id,
    points: activeData.points,
    fromDistanceAlongRouteMeters: isValidSnap ? snapped.distanceAlongRouteMeters : 0,
    cumulativeTime,
    plannedStartMs: timing.futureStartMs,
    plannedStops,
  };
}

function ForecastStatus({
  activeData,
  warningCount,
}: {
  activeData: ActiveRouteData | null;
  warningCount: number;
}) {
  const colors = useThemeColors();
  const fetchStatus = useWeatherStore((s) => s.fetchStatus);
  const lastSuccessfulFetchAtMs = useWeatherStore((s) => s.lastSuccessfulFetchAtMs);
  const lastError = useWeatherStore((s) => s.lastError);
  const lastRefreshOutcome = useWeatherStore((s) => s.lastRefreshOutcome);
  const lastRefreshMessage = useWeatherStore((s) => s.lastRefreshMessage);
  const isConnected = useOfflineStore((s) => s.isConnected);
  const collections = useCollectionStore((s) => s.collections);
  const timing = useMemo(
    () => activeRouteTiming(activeData, collections),
    [activeData, collections],
  );

  const statusBase =
    fetchStatus === "fetching"
      ? "Updating weather..."
      : lastSuccessfulFetchAtMs
        ? `Updated ${formatTimeAgo(lastSuccessfulFetchAtMs)}`
        : "Weather unavailable";
  const statusSuffix = !isConnected
    ? "Offline"
    : fetchStatus === "error" && lastError
      ? lastError
      : lastRefreshOutcome !== "idle" && lastRefreshMessage
        ? lastRefreshMessage
        : null;

  return (
    <View
      className="py-1.5"
      style={{ borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}
    >
      <View className="flex-row items-center px-3">
        <View className="flex-1 flex-row min-w-0">
          <Text className="text-[13px] font-barlow-medium text-muted-foreground" numberOfLines={1}>
            {timing.plannedStartMs != null
              ? `${statusBase} · start ${formatStartLabel(timing.plannedStartMs)}`
              : statusBase}
          </Text>
          {statusSuffix && (
            <Text
              className="text-[13px] font-barlow-medium flex-shrink"
              style={{ color: fetchStatus === "error" ? colors.destructive : colors.warning }}
              numberOfLines={1}
            >
              {` · ${statusSuffix}`}
            </Text>
          )}
        </View>
        {warningCount > 0 && (
          <View className="flex-row items-center ml-2">
            <AlertTriangle size={13} color={colors.warning} />
            <Text
              className="text-[13px] font-barlow-sc-semibold ml-1"
              style={{ color: colors.warning }}
            >
              {warningCount}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

function TimelineList({
  timeline,
  isExpanded,
  refreshing,
  onRefresh,
  fetchStatus,
}: {
  timeline: WeatherPoint[];
  isExpanded: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  fetchStatus: ReturnType<typeof useWeatherStore.getState>["fetchStatus"];
}) {
  const colors = useThemeColors();
  const { bottom: safeBottom } = useSafeAreaInsets();
  const listData = useMemo<TimelineListItem[]>(() => {
    const items: TimelineListItem[] = [];
    let currentDayKey: string | null = null;

    timeline.forEach((point, index) => {
      if (!point.sampleKinds.includes("hourly")) return;
      const dayKey = weatherTimelineDayKey(point);
      if (dayKey && currentDayKey && dayKey !== currentDayKey) {
        const label = weatherTimelineDayLabel(point);
        if (label) items.push({ type: "day", key: `day-${dayKey}-${index}`, label });
      }
      if (dayKey) currentDayKey = dayKey;

      items.push({ type: "weather", key: weatherPointKey(point, index), point });
    });

    return items;
  }, [timeline]);

  const renderItem = React.useCallback<ListRenderItem<TimelineListItem>>(({ item }) => {
    if (item.type === "day") return <TimelineDayHeader label={item.label} />;
    return <WeatherRow point={item.point} />;
  }, []);

  return (
    <FlatList
      className="flex-1"
      data={listData}
      keyExtractor={(item) => item.key}
      renderItem={renderItem}
      scrollEnabled
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{
        paddingBottom: isExpanded ? safeBottom + 12 : 0,
        flexGrow: listData.length === 0 ? 1 : 0,
      }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.accent}
          colors={[colors.accent]}
        />
      }
      ListEmptyComponent={
        <View className="items-center justify-center py-6 px-4">
          <Wind size={24} color={colors.textTertiary} />
          <Text className="text-[13px] text-muted-foreground font-barlow-medium mt-2">
            {fetchStatus === "fetching" ? "Updating weather..." : "Weather unavailable"}
          </Text>
          <Text className="text-[11px] text-muted-foreground mt-1 text-center">
            Pull to refresh when online.
          </Text>
        </View>
      }
      initialNumToRender={8}
      maxToRenderPerBatch={8}
      windowSize={3}
      removeClippedSubviews
    />
  );
}

export default function WeatherPanel({ activeData }: { activeData: ActiveRouteData | null }) {
  const colors = useThemeColors();
  const timeline = useWeatherStore((s) => s.timeline);
  const fetchStatus = useWeatherStore((s) => s.fetchStatus);
  const refreshWeatherNow = useWeatherStore((s) => s.refreshWeatherNow);
  const recordManualRefreshUnavailable = useWeatherStore((s) => s.recordManualRefreshUnavailable);
  const isExpanded = usePanelStore((s) => s.isExpanded);
  const panelMode = usePanelStore((s) => s.panelMode);
  const ridingHorizonMeters = ridingHorizonMetersForMode(panelMode);
  const horizonTimeline = useMemo(
    () =>
      ridingHorizonMeters == null
        ? timeline
        : timeline.filter(
            (point) =>
              point.phase === "post-finish" || point.distanceAlongRouteM <= ridingHorizonMeters,
          ),
    [timeline, ridingHorizonMeters],
  );
  const hourlyTimeline = useMemo(
    () => horizonTimeline.filter((point) => point.sampleKinds.includes("hourly")),
    [horizonTimeline],
  );
  const warningCount = useMemo(
    () => hourlyTimeline.filter((point) => getWeatherRisk(point)).length,
    [hourlyTimeline],
  );
  const refresh = useCallback(() => {
    const context = buildRefreshContext(activeData);
    if (!context) {
      recordManualRefreshUnavailable("Weather refresh unavailable");
      return;
    }
    void refreshWeatherNow(
      context.routeId,
      context.points,
      context.fromDistanceAlongRouteMeters,
      context.cumulativeTime,
      context.plannedStartMs,
      context.plannedStops,
    );
  }, [activeData, recordManualRefreshUnavailable, refreshWeatherNow]);

  return (
    <View className="flex-1">
      <ForecastStatus activeData={activeData} warningCount={warningCount} />
      <View
        className="min-h-[32px] flex-row items-center px-3 bg-surface"
        style={{
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: colors.borderSubtle,
        }}
        accessibilityRole="header"
      >
        <Text className="w-[98px] text-[12px] text-muted-foreground font-barlow-medium">
          Time · km
        </Text>
        <Text className="flex-1 text-[12px] text-muted-foreground font-barlow-medium">
          Condition
        </Text>
        <Text className="w-[58px] text-center text-[12px] text-muted-foreground font-barlow-medium">
          Rain
        </Text>
        <Text className="w-[74px] text-right text-[12px] text-muted-foreground font-barlow-medium">
          Wind
        </Text>
      </View>
      <TimelineList
        timeline={hourlyTimeline}
        isExpanded={isExpanded}
        refreshing={fetchStatus === "fetching"}
        onRefresh={refresh}
        fetchStatus={fetchStatus}
      />
    </View>
  );
}
