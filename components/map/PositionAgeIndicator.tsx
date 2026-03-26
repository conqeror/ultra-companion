import React, { useEffect, useState } from "react";
import { Text } from "@/components/ui/text";
import { useMapStore } from "@/store/mapStore";
import { useThemeColors } from "@/theme";
import { formatTimeAgo } from "@/utils/formatters";
import {
  GPS_STALE_THRESHOLD_MS,
  POSITION_AGE_VISIBLE_THRESHOLD_MS,
} from "@/constants";

export default function PositionAgeIndicator() {
  const colors = useThemeColors();
  const userPosition = useMapStore((s) => s.userPosition);
  const [, setTick] = useState(0);

  const shouldShow =
    userPosition != null &&
    Date.now() - userPosition.timestamp >= POSITION_AGE_VISIBLE_THRESHOLD_MS;

  // Only tick when there's something to display
  useEffect(() => {
    if (!shouldShow) return;
    const interval = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(interval);
  }, [shouldShow]);

  if (!shouldShow || !userPosition) return null;

  const isStale = Date.now() - userPosition.timestamp >= GPS_STALE_THRESHOLD_MS;

  return (
    <Text
      className="text-[11px] font-barlow-medium text-center mt-1"
      style={{ color: isStale ? colors.warning : colors.textSecondary }}
    >
      {formatTimeAgo(userPosition.timestamp)}
    </Text>
  );
}
