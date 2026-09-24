import { useEffect, useMemo, useState } from "react";
import { useCollectionStore } from "@/store/collectionStore";
import { useEtaStore } from "@/store/etaStore";
import { useFerryStore } from "@/store/ferryStore";
import { stitchedSegmentsCacheSignature } from "@/services/relativeEtaCache";
import {
  loadCollectionVariantDisplayData,
  type CollectionVariantMetric,
  type CollectionVariantOverlayGeometry,
} from "@/services/collectionVariantGeometry";
import { yieldToUI } from "@/utils/yieldToUI";
import type { ActiveRouteData, CollectionSegmentWithRoute } from "@/types";

/** Loads optional collection previews independently from the active riding geometry. */
export function useActiveCollectionVariants(activeData: ActiveRouteData | null) {
  const getCollectionSegmentsWithRoutes = useCollectionStore(
    (s) => s.getCollectionSegmentsWithRoutes,
  );
  const powerConfig = useEtaStore((s) => s.powerConfig);
  const ferryRevision = useFerryStore((s) => s.revision);
  const activeSegmentsKey = useMemo(
    () => stitchedSegmentsCacheSignature(activeData?.segments),
    [activeData?.segments],
  );
  const [activeCollectionSegments, setActiveCollectionSegments] = useState<
    CollectionSegmentWithRoute[]
  >([]);
  const [activeVariantOverlaysByKey, setActiveVariantOverlaysByKey] = useState<
    Record<string, CollectionVariantOverlayGeometry>
  >({});
  const [activeVariantMetricsByKey, setActiveVariantMetricsByKey] = useState<
    Record<string, CollectionVariantMetric>
  >({});
  const [isVariantDataPreparing, setIsVariantDataPreparing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadActiveCollectionVariants() {
      if (activeData?.type !== "collection") {
        setActiveCollectionSegments([]);
        setActiveVariantOverlaysByKey({});
        setActiveVariantMetricsByKey({});
        setIsVariantDataPreparing(false);
        return;
      }

      setActiveCollectionSegments([]);
      setActiveVariantOverlaysByKey({});
      setActiveVariantMetricsByKey({});
      setIsVariantDataPreparing(true);
      await yieldToUI();
      try {
        const segments = await getCollectionSegmentsWithRoutes(activeData.id);
        const { getFerryCrossingsForRoute, getRoutePoints } = await import("@/db/database");
        const displayData = await loadCollectionVariantDisplayData(
          segments,
          powerConfig,
          getRoutePoints,
          {
            shouldCancel: () => cancelled,
            loadRouteFerries: getFerryCrossingsForRoute,
          },
        );
        if (cancelled) return;

        setActiveCollectionSegments(segments);
        setActiveVariantOverlaysByKey(displayData.overlaysByKey);
        setActiveVariantMetricsByKey(displayData.metricsByKey);
      } finally {
        if (!cancelled) setIsVariantDataPreparing(false);
      }
    }

    loadActiveCollectionVariants().catch((e) => {
      if (cancelled) return;
      console.warn("Failed to load active collection variants:", e);
      setActiveCollectionSegments([]);
      setActiveVariantOverlaysByKey({});
      setActiveVariantMetricsByKey({});
    });

    return () => {
      cancelled = true;
    };
  }, [
    activeData?.id,
    activeData?.type,
    activeSegmentsKey,
    ferryRevision,
    getCollectionSegmentsWithRoutes,
    powerConfig,
  ]);

  return {
    activeCollectionSegments,
    activeVariantOverlaysByKey,
    activeVariantMetricsByKey,
    isVariantDataPreparing,
  };
}
