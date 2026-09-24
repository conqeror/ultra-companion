import { useEffect, useMemo, useRef, useState } from "react";
import { useRouteStore } from "@/store/routeStore";
import { useCollectionStore } from "@/store/collectionStore";
import { usePoiStore } from "@/store/poiStore";
import { useClimbStore } from "@/store/climbStore";
import { useFerryStore } from "@/store/ferryStore";
import { useEtaStore } from "@/store/etaStore";
import { useWeatherStore } from "@/store/weatherStore";
import { useOfflineStore } from "@/store/offlineStore";
import { restoreActiveRouteSession } from "@/services/activeRouteSession";
import { stitchedSegmentsCacheSignature } from "@/services/relativeEtaCache";
import { distanceBucketKey, WEATHER_PROGRESS_BUCKET_METERS } from "@/utils/distanceBuckets";
import type { ActiveRouteData } from "@/types";
import type { PlannedStop } from "@/services/plannedStops";

interface ActiveRouteLifecycleInput {
  activeData: ActiveRouteData | null;
  progressDistanceMeters: number | null;
  futureStartMs: number | null;
  plannedStops: readonly PlannedStop[];
  weatherEnabled: boolean;
}

/** Coordinates the riding session independently of map rendering and camera state. */
export function useActiveRouteLifecycle({
  activeData,
  progressDistanceMeters,
  futureStartMs,
  plannedStops,
  weatherEnabled,
}: ActiveRouteLifecycleInput) {
  const loadRouteMetadata = useRouteStore((s) => s.loadRouteMetadata);
  const loadRoutePoints = useRouteStore((s) => s.loadRoutePoints);
  const activeStandaloneRouteId = useRouteStore(
    (s) => s.routes.find((route) => route.isActive)?.id,
  );
  const loadCollections = useCollectionStore((s) => s.loadCollections);
  const clearRouteProgress = useRouteStore((s) => s.clearRouteProgress);
  const loadPOIs = usePoiStore((s) => s.loadPOIs);
  const loadClimbs = useClimbStore((s) => s.loadClimbs);
  const loadFerries = useFerryStore((s) => s.loadFerries);
  const setSelectedClimb = useClimbStore((s) => s.setSelectedClimb);
  const updateCurrentClimb = useClimbStore((s) => s.updateCurrentClimb);
  const ensureRelativeETA = useEtaStore((s) => s.ensureRelativeETA);
  const powerConfig = useEtaStore((s) => s.powerConfig);
  const cumulativeTime = useEtaStore((s) => s.cumulativeTime);
  const etaPoints = useEtaStore((s) => s.cachedPoints);
  const etaRouteId = useEtaStore((s) => s.routeId);
  const fetchWeather = useWeatherStore((s) => s.fetchWeather);
  const isConnected = useOfflineStore((s) => s.isConnected);
  const [restoring, setRestoring] = useState(true);
  const id = activeData?.id;
  const points = activeData?.points;
  const routeIds = useMemo(() => activeData?.routeIds ?? [], [activeData?.routeIds]);
  const segments = activeData?.segments;
  const segmentsSignature = useMemo(() => stitchedSegmentsCacheSignature(segments), [segments]);
  const routeIdsKey = routeIds.join(",");
  const geometry = useRef({ id, points, routeIdsKey });

  useEffect(() => {
    let current = true;
    void restoreActiveRouteSession(
      {
        loadRouteMetadata,
        loadCollections,
        activeStandaloneRouteId: () =>
          useRouteStore.getState().routes.find((route) => route.isActive)?.id ?? null,
        loadRoutePoints,
      },
      () => current,
    )
      .catch((error) => {
        console.warn("Failed to restore active route:", error);
      })
      .finally(() => {
        if (current) setRestoring(false);
      });
    return () => {
      current = false;
    };
  }, [loadRouteMetadata, loadCollections, loadRoutePoints]);

  useEffect(() => {
    if (!restoring && activeStandaloneRouteId) {
      void loadRoutePoints([activeStandaloneRouteId], { prune: true });
    }
  }, [restoring, activeStandaloneRouteId, loadRoutePoints]);

  useEffect(() => {
    const previous = geometry.current;
    if (previous.id !== id || previous.points !== points || previous.routeIdsKey !== routeIdsKey) {
      geometry.current = { id, points, routeIdsKey };
      setSelectedClimb(null);
      clearRouteProgress();
    }
  }, [id, points, routeIdsKey, setSelectedClimb, clearRouteProgress]);

  useEffect(() => {
    for (const routeId of routeIds) {
      void loadPOIs(routeId);
      void loadClimbs(routeId);
      void loadFerries(routeId);
    }
  }, [routeIds, loadPOIs, loadClimbs, loadFerries]);

  const scope = activeData?.type;
  const distance = activeData?.totalDistanceMeters;
  const ascent = activeData?.totalAscentMeters;
  const descent = activeData?.totalDescentMeters;
  const ferries = activeData?.ferries;
  useEffect(() => {
    if (!id || !scope || !points?.length) return;
    void ensureRelativeETA({
      scope,
      scopeId: id,
      points,
      totalDistanceMeters: distance!,
      totalAscentMeters: ascent!,
      totalDescentMeters: descent!,
      segmentsSignature,
      ferries,
    });
  }, [
    id,
    scope,
    points,
    distance,
    ascent,
    descent,
    segmentsSignature,
    ferries,
    powerConfig,
    ensureRelativeETA,
  ]);

  const weatherProgressBucket = distanceBucketKey(
    progressDistanceMeters,
    WEATHER_PROGRESS_BUCKET_METERS,
  );
  const latestProgress = useRef(progressDistanceMeters);
  latestProgress.current = progressDistanceMeters;
  useEffect(() => {
    const progress = latestProgress.current;
    if (
      !weatherEnabled ||
      !id ||
      !points?.length ||
      progress == null ||
      !cumulativeTime ||
      etaRouteId !== id ||
      etaPoints !== points
    )
      return;
    // The store may reproject cached forecasts offline; it owns the network gate.
    void fetchWeather(id, points, progress, cumulativeTime, futureStartMs, plannedStops);
  }, [
    weatherEnabled,
    id,
    points,
    weatherProgressBucket,
    cumulativeTime,
    etaRouteId,
    etaPoints,
    futureStartMs,
    plannedStops,
    isConnected,
    fetchWeather,
  ]);

  useEffect(() => {
    if (id && progressDistanceMeters != null) {
      updateCurrentClimb(progressDistanceMeters, routeIds, segments ?? null);
    }
  }, [id, progressDistanceMeters, routeIds, segments, updateCurrentClimb]);

  return restoring;
}
