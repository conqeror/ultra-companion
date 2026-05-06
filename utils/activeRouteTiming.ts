import type { ActiveRouteData, Collection } from "@/types";

export interface ActiveRouteTiming {
  plannedStartMs: number | null;
  futureStartMs: number | null;
}

export function futureStartMs(plannedStartMs: number | null | undefined, nowMs = Date.now()) {
  return plannedStartMs != null && plannedStartMs > nowMs ? plannedStartMs : null;
}

export function activeRouteTiming(
  activeData: Pick<ActiveRouteData, "id" | "type"> | null | undefined,
  collections: Collection[],
  nowMs = Date.now(),
): ActiveRouteTiming {
  const plannedStartMs =
    activeData?.type === "collection"
      ? (collections.find((collection) => collection.id === activeData.id)?.plannedStartMs ?? null)
      : null;

  return {
    plannedStartMs,
    futureStartMs: futureStartMs(plannedStartMs, nowMs),
  };
}
