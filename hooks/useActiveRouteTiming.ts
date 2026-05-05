import { useEffect, useMemo, useState } from "react";
import { useCollectionStore } from "@/store/collectionStore";
import { activeRouteTiming } from "@/utils/activeRouteTiming";
import type { ActiveRouteData } from "@/types";

const MAX_CLOCK_REFRESH_MS = 60_000;
const START_TRANSITION_GRACE_MS = 1_000;

export function useActiveRouteTiming(activeData: ActiveRouteData | null) {
  const collections = useCollectionStore((s) => s.collections);
  const plannedStartMs =
    activeData?.type === "collection"
      ? (collections.find((collection) => collection.id === activeData.id)?.plannedStartMs ?? null)
      : null;
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (plannedStartMs == null) return;

    let timeout: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      const now = Date.now();
      if (plannedStartMs + START_TRANSITION_GRACE_MS <= now) {
        return;
      }
      const msUntilStart = plannedStartMs - now + START_TRANSITION_GRACE_MS;
      const delayMs = Math.max(1_000, Math.min(MAX_CLOCK_REFRESH_MS, msUntilStart));
      timeout = setTimeout(() => {
        setNowMs(Date.now());
        schedule();
      }, delayMs);
    };

    setNowMs(Date.now());
    schedule();

    return () => {
      if (timeout) clearTimeout(timeout);
    };
  }, [plannedStartMs]);

  return useMemo(
    () => activeRouteTiming(activeData, collections, nowMs),
    [activeData, collections, nowMs],
  );
}
