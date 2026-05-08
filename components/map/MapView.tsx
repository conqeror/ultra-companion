import React, { useRef, useCallback, useEffect, useState, useMemo } from "react";
import { View, AppState, useWindowDimensions } from "react-native";
import Mapbox, { Camera, MapView as MapboxMapView } from "@rnmapbox/maps";
import Constants from "expo-constants";
import { useShallow } from "zustand/react/shallow";
import { useMapStore } from "@/store/mapStore";
import { useRouteStore } from "@/store/routeStore";
import { useCollectionStore } from "@/store/collectionStore";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePanelStore } from "@/store/panelStore";
import { SHEET_COMPACT_RATIO } from "@/constants";
import { useThemeColors } from "@/theme";
import { useMapStyle } from "@/hooks/useMapStyle";
import { useRouteGeometryZoom } from "@/hooks/useRouteGeometryZoom";
import { useActiveRouteTiming } from "@/hooks/useActiveRouteTiming";
import {
  usePreparedRouteGeometries,
  type PreparedRouteGeometryRequest,
} from "@/hooks/usePreparedRouteGeometries";
import { GPS_STALE_THRESHOLD_MS } from "@/constants";
import MapControls from "./MapControls";
import MapCanvas, { type MapCanvasRouteLayer, type MapOverlayMode } from "./MapCanvas";
import type { VariantOverlay } from "./VariantOverlayLayer";
import TabbedBottomPanel from "./TabbedBottomPanel";
import { displayPOIsForActiveRoute } from "@/services/activePOIs";
import { computeCachedRouteTotalETA } from "@/services/etaCalculator";
import { resolveActiveRouteProgress } from "@/utils/routeProgress";
import { plannedStopsFromPOIs } from "@/services/plannedStops";
import { distanceBucketKey, WEATHER_PROGRESS_BUCKET_METERS } from "@/utils/distanceBuckets";
import { snapToRouteDetailed } from "@/services/routeSnapping";
import { useActiveRouteData, getActiveRouteDataImperative } from "@/hooks/useActiveRouteData";
import { usePoiStore } from "@/store/poiStore";
import { useClimbStore } from "@/store/climbStore";
import { useEtaStore } from "@/store/etaStore";
import { useWeatherStore } from "@/store/weatherStore";
import { useOfflineStore } from "@/store/offlineStore";
import { useSettingsStore } from "@/store/settingsStore";
import {
  buildPatchVariantRoutePoints,
  routeEndDistance,
  sliceRoutePointsByDistance,
} from "@/services/stitchingService";
import { computeSliceAscentFromDistance } from "@/utils/geo";
import { formatDistance, formatDuration, formatElevation } from "@/utils/formatters";
import { measureSync } from "@/utils/perfMarks";
import { pickRouteRecords } from "@/utils/routeScopedRecords";
import type {
  CollectionSegmentWithRoute,
  RoutePoint,
  StitchedSegmentInfo,
  UnitSystem,
  UserPosition,
} from "@/types";

interface VariantMetric {
  distanceMeters: number;
  ascentMeters: number;
  ridingTime: number | null;
}

function groupCollectionSegments(
  segments: CollectionSegmentWithRoute[],
): CollectionSegmentWithRoute[][] {
  const grouped = new Map<number, CollectionSegmentWithRoute[]>();
  for (const sw of segments) {
    if (!grouped.has(sw.segment.position)) grouped.set(sw.segment.position, []);
    grouped.get(sw.segment.position)!.push(sw);
  }
  return [...grouped.entries()].sort(([a], [b]) => a - b).map(([, variants]) => variants);
}

function effectiveVariantPoints(
  sw: CollectionSegmentWithRoute,
  pointsByRouteId: Record<string, RoutePoint[]>,
): RoutePoint[] | null {
  const routePoints = pointsByRouteId[sw.route.id];
  if (sw.segment.variantKind !== "patch") return routePoints ?? null;

  const { baseRouteId, replaceStartDistanceMeters, replaceEndDistanceMeters } = sw.segment;
  if (
    !baseRouteId ||
    replaceStartDistanceMeters == null ||
    replaceEndDistanceMeters == null ||
    !routePoints
  ) {
    return routePoints ?? null;
  }

  const basePoints = pointsByRouteId[baseRouteId];
  if (!basePoints) return routePoints;
  const stitched = buildPatchVariantRoutePoints(
    basePoints,
    routePoints,
    replaceStartDistanceMeters,
    replaceEndDistanceMeters,
  );
  return stitched.length >= 2 ? stitched : routePoints;
}

function effectiveVariantAscentMeters(
  sw: CollectionSegmentWithRoute,
  pointsByRouteId: Record<string, RoutePoint[]>,
): number {
  const { baseRouteId, replaceStartDistanceMeters, replaceEndDistanceMeters } = sw.segment;
  if (
    sw.segment.variantKind === "patch" &&
    baseRouteId &&
    replaceStartDistanceMeters != null &&
    replaceEndDistanceMeters != null
  ) {
    const basePoints = pointsByRouteId[baseRouteId];
    if (basePoints?.length) {
      const baseEnd = routeEndDistance(basePoints);
      return (
        computeSliceAscentFromDistance(basePoints, 0, replaceStartDistanceMeters) +
        sw.route.totalAscentMeters +
        computeSliceAscentFromDistance(basePoints, replaceEndDistanceMeters, baseEnd)
      );
    }
  }
  return sw.route.totalAscentMeters;
}

function variantMetric(
  sw: CollectionSegmentWithRoute,
  pointsByRouteId: Record<string, RoutePoint[]>,
  powerConfig: ReturnType<typeof useEtaStore.getState>["powerConfig"],
  metricKey: string,
): VariantMetric | null {
  const points = effectiveVariantPoints(sw, pointsByRouteId);
  if (!points || points.length < 2) return null;
  return {
    distanceMeters: routeEndDistance(points),
    ascentMeters: effectiveVariantAscentMeters(sw, pointsByRouteId),
    ridingTime: computeCachedRouteTotalETA(metricKey, points, powerConfig),
  };
}

function signedDistance(deltaMeters: number, units: UnitSystem): string {
  if (Math.abs(deltaMeters) < 1) return "±0 m";
  return `${deltaMeters > 0 ? "+" : "-"}${formatDistance(Math.abs(deltaMeters), units)}`;
}

function signedElevation(deltaMeters: number, units: UnitSystem): string {
  if (Math.abs(deltaMeters) < 1) return "±0 m";
  return `${deltaMeters > 0 ? "+" : "-"}${formatElevation(Math.abs(deltaMeters), units)}`;
}

function signedDuration(deltaSeconds: number | null): string {
  if (deltaSeconds == null) return "ETA n/a";
  if (Math.abs(deltaSeconds) < 30) return "ETA ±0m";
  return `ETA ${deltaSeconds > 0 ? "+" : "-"}${formatDuration(Math.abs(deltaSeconds))}`;
}

function variantDiffLabel(metric: VariantMetric, reference: VariantMetric, units: UnitSystem) {
  const timeDelta =
    metric.ridingTime != null && reference.ridingTime != null
      ? metric.ridingTime - reference.ridingTime
      : null;
  return [
    signedDuration(timeDelta),
    signedDistance(metric.distanceMeters - reference.distanceMeters, units),
    `↑ ${signedElevation(metric.ascentMeters - reference.ascentMeters, units)}`,
  ].join("\n");
}

function variantMetricKey(sw: CollectionSegmentWithRoute): string {
  return `${sw.segment.collectionId}:${sw.segment.position}:${sw.route.id}:${sw.segment.variantKind}`;
}

function plannedStopsSignature(
  stops: readonly { distanceMeters: number; durationSeconds: number }[],
) {
  if (stops.length === 0) return "none";
  return stops
    .map((stop) => `${Math.round(stop.distanceMeters)}:${stop.durationSeconds}`)
    .join(",");
}

function stitchedSegmentsSignature(segments: readonly StitchedSegmentInfo[] | null | undefined) {
  if (!segments?.length) return "none";
  return segments
    .map((segment) =>
      [
        segment.position,
        segment.routeId,
        segment.variantKind,
        segment.baseRouteId ?? "base:none",
        segment.replaceStartDistanceMeters ?? "start:none",
        segment.replaceEndDistanceMeters ?? "end:none",
        Math.round(segment.distanceOffsetMeters),
        Math.round(segment.segmentDistanceMeters),
      ].join(":"),
    )
    .join("|");
}

// Initialize Mapbox with access token from app config
try {
  const mapboxToken = Constants.expoConfig?.extra?.mapboxAccessToken;
  if (mapboxToken) {
    Mapbox.setAccessToken(mapboxToken);
  }
} catch (e) {
  console.warn("Failed to set Mapbox access token:", e);
}

export default function MapScreen() {
  const themeColors = useThemeColors();
  const mapStyle = useMapStyle();
  const cameraRef = useRef<Camera>(null);
  const mapRef = useRef<MapboxMapView>(null);
  const [hasGpsFix, setHasGpsFix] = useState(false);
  const { height: screenHeight } = useWindowDimensions();

  const followUser = useMapStore((s) => s.followUser);
  const setFollowUser = useMapStore((s) => s.setFollowUser);
  const showDistanceMarkers = useMapStore((s) => s.showDistanceMarkers);
  const poiVisibility = useMapStore((s) => s.poiVisibility);
  const refreshPosition = useMapStore((s) => s.refreshPosition);
  const persistCamera = useMapStore((s) => s.persistCamera);
  const initialCamera = useRef({
    center: useMapStore.getState().center,
    zoom: useMapStore.getState().zoom,
  });
  const lastCamera = useRef(initialCamera.current);
  const { routeGeometryToleranceMeters, updateRouteGeometryZoom } = useRouteGeometryZoom(
    initialCamera.current.zoom,
    initialCamera.current.center[1],
  );
  const panelTab = usePanelStore((s) => s.panelTab);
  const mapOverlayMode: MapOverlayMode =
    panelTab === "climbs" ? "climbs" : panelTab === "weather" ? "weather" : "normal";
  const effectivePOIVisibility = panelTab === "pois" ? "all" : poiVisibility;
  const { bottom: safeBottom } = useSafeAreaInsets();
  const compactPanelHeight = Math.round(screenHeight * SHEET_COMPACT_RATIO) + safeBottom;

  const routes = useRouteStore((s) => s.routes);
  const visibleRoutePoints = useRouteStore((s) => s.visibleRoutePoints);
  const loadRouteMetadata = useRouteStore((s) => s.loadRouteMetadata);
  const loadRoutePoints = useRouteStore((s) => s.loadRoutePoints);
  const snappedPosition = useRouteStore((s) => s.snappedPosition);
  const setSnappedPosition = useRouteStore((s) => s.setSnappedPosition);
  const recordSnapHistory = useRouteStore((s) => s.recordSnapHistory);
  const clearRouteProgress = useRouteStore((s) => s.clearRouteProgress);
  const loadCollections = useCollectionStore((s) => s.loadCollections);
  const getCollectionSegmentsWithRoutes = useCollectionStore(
    (s) => s.getCollectionSegmentsWithRoutes,
  );
  const loadPOIs = usePoiStore((s) => s.loadPOIs);
  const computeETAForRoute = useEtaStore((s) => s.computeETAForRoute);
  const cumulativeTime = useEtaStore((s) => s.cumulativeTime);
  const powerConfig = useEtaStore((s) => s.powerConfig);
  const fetchWeather = useWeatherStore((s) => s.fetchWeather);
  const weatherTimeline = useWeatherStore((s) => s.timeline);
  const weatherRouteId = useWeatherStore((s) => s.routeId);
  const weatherTemperatureMode = useSettingsStore((s) => s.weatherTemperatureDisplayMode);
  const units = useSettingsStore((s) => s.units);
  const isConnected = useOfflineStore((s) => s.isConnected);
  const [activeCollectionSegments, setActiveCollectionSegments] = useState<
    CollectionSegmentWithRoute[]
  >([]);
  const [activeVariantPointsByRouteId, setActiveVariantPointsByRouteId] = useState<
    Record<string, RoutePoint[]>
  >({});
  const [activeVariantMetricsByKey, setActiveVariantMetricsByKey] = useState<
    Record<string, VariantMetric>
  >({});

  // Unified active context — works for both standalone routes and collections
  const activeData = useActiveRouteData();
  const activeRoutePoints = activeData?.points ?? null;
  const timing = useActiveRouteTiming(activeData);
  const activeRouteIds = useMemo(() => activeData?.routeIds ?? [], [activeData?.routeIds]);
  const allPois = usePoiStore(useShallow((s) => pickRouteRecords(s.pois, activeRouteIds)));
  const plannedStops = useMemo(
    () =>
      measureSync("map.activePlannedStops", () =>
        plannedStopsFromPOIs(
          displayPOIsForActiveRoute(activeRouteIds, activeData?.segments ?? null, allPois),
        ),
      ),
    [activeRouteIds, activeData?.segments, allPois],
  );
  const plannedStopsKey = useMemo(() => plannedStopsSignature(plannedStops), [plannedStops]);
  const activeRouteIdsKey = useMemo(() => activeRouteIds.join(","), [activeRouteIds]);
  const activeSegmentsKey = useMemo(
    () => stitchedSegmentsSignature(activeData?.segments),
    [activeData?.segments],
  );
  const activeRouteProgress = useMemo(
    () =>
      resolveActiveRouteProgress(activeData, snappedPosition, {
        plannedStartMs: timing.plannedStartMs,
      }),
    [activeData, snappedPosition, timing.plannedStartMs],
  );
  const activeProgressDistanceMeters = activeRouteProgress?.distanceAlongRouteMeters ?? null;
  const weatherProgressBucketKey = distanceBucketKey(
    activeProgressDistanceMeters,
    WEATHER_PROGRESS_BUCKET_METERS,
  );

  useEffect(() => {
    loadRouteMetadata();
    loadCollections();
  }, [loadRouteMetadata, loadCollections]);

  const activeStandaloneRouteId = useMemo(
    () => routes.find((route) => route.isActive)?.id ?? null,
    [routes],
  );

  useEffect(() => {
    if (!activeStandaloneRouteId) return;
    loadRoutePoints([activeStandaloneRouteId], { prune: true });
  }, [activeStandaloneRouteId, loadRoutePoints]);

  useEffect(() => {
    let cancelled = false;
    async function loadActiveCollectionVariants() {
      if (activeData?.type !== "collection") {
        setActiveCollectionSegments([]);
        setActiveVariantPointsByRouteId({});
        setActiveVariantMetricsByKey({});
        return;
      }

      const segments = await getCollectionSegmentsWithRoutes(activeData.id);
      const routeIds = new Set<string>();
      for (const sw of segments) {
        routeIds.add(sw.route.id);
        if (sw.segment.baseRouteId) routeIds.add(sw.segment.baseRouteId);
      }

      const { getRoutePoints } = await import("@/db/database");
      const ids = [...routeIds];
      const points = await Promise.all(ids.map((routeId) => getRoutePoints(routeId)));
      if (cancelled) return;

      const pointsByRouteId: Record<string, RoutePoint[]> = {};
      for (let i = 0; i < ids.length; i++) {
        pointsByRouteId[ids[i]] = points[i];
      }
      setActiveCollectionSegments(segments);
      setActiveVariantPointsByRouteId(pointsByRouteId);
    }

    loadActiveCollectionVariants().catch((e) => {
      if (cancelled) return;
      console.warn("Failed to load active collection variants:", e);
      setActiveCollectionSegments([]);
      setActiveVariantPointsByRouteId({});
    });

    return () => {
      cancelled = true;
    };
  }, [activeData?.id, activeData?.type, activeSegmentsKey, getCollectionSegmentsWithRoutes]);

  const loadClimbs = useClimbStore((s) => s.loadClimbs);
  const updateCurrentClimb = useClimbStore((s) => s.updateCurrentClimb);
  const setSelectedClimb = useClimbStore((s) => s.setSelectedClimb);

  // Clear stale climb selection and progress when active route/collection geometry changes.
  const activeContextKey = activeData ? `${activeData.id}:${activeRouteIdsKey}` : null;
  const prevActiveGeometry = useRef({
    contextKey: activeContextKey,
    points: activeRoutePoints,
  });
  useEffect(() => {
    const previous = prevActiveGeometry.current;
    if (activeContextKey !== previous.contextKey || activeRoutePoints !== previous.points) {
      prevActiveGeometry.current = {
        contextKey: activeContextKey,
        points: activeRoutePoints,
      };
      setSelectedClimb(null);
      clearRouteProgress();
    }
  }, [activeContextKey, activeRoutePoints, setSelectedClimb, clearRouteProgress]);

  // Load POIs and climbs when active context changes
  useEffect(() => {
    if (activeRouteIds.length === 0) return;
    for (const routeId of activeRouteIds) {
      loadPOIs(routeId);
      loadClimbs(routeId);
    }
  }, [activeRouteIds, activeRouteIdsKey, loadPOIs, loadClimbs]);

  useEffect(() => {
    if (activeData && activeRoutePoints?.length) {
      measureSync("map.activeETAEffect", () =>
        computeETAForRoute(activeData.id, activeRoutePoints),
      );
    }
    // Intentional: fire only when id/points change; full activeData reference not needed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeData?.id, activeRoutePoints, computeETAForRoute]);

  // Fetch weather when active context + snapped position + ETA are available (and online)
  useEffect(() => {
    if (
      activeData &&
      activeRoutePoints?.length &&
      activeRouteProgress &&
      cumulativeTime &&
      isConnected
    ) {
      measureSync("map.weatherGate", () => {
        fetchWeather(
          activeData.id,
          activeRoutePoints,
          activeRouteProgress.distanceAlongRouteMeters,
          cumulativeTime,
          timing.futureStartMs,
          plannedStops,
        );
      });
    }
    // Intentional: fire on meaningful weather context changes, not every exact progress update
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeData?.id,
    weatherProgressBucketKey,
    isConnected,
    cumulativeTime,
    fetchWeather,
    timing.futureStartMs,
    plannedStopsKey,
  ]);

  const applyRouteSnap = useCallback(
    (position: UserPosition, data: { id: string; points: RoutePoint[] }) => {
      const routeState = useRouteStore.getState();
      const previous = routeState.snappedPosition;
      const snapped = snapToRouteDetailed(
        position.latitude,
        position.longitude,
        data.id,
        data.points,
        {
          previousPointIndex: previous?.routeId === data.id ? previous.pointIndex : undefined,
          previousDistanceAlongRouteMeters:
            previous?.routeId === data.id ? previous.distanceAlongRouteMeters : undefined,
          history: routeState.snapHistory,
          headingDegrees: position.heading,
          speedMetersPerSecond: position.speed,
          timestamp: position.timestamp,
        },
      );

      if (!snapped) {
        clearRouteProgress();
        return;
      }

      setSnappedPosition(snapped.snappedPosition);

      recordSnapHistory({
        routeId: data.id,
        latitude: position.latitude,
        longitude: position.longitude,
        timestamp: position.timestamp,
        heading: position.heading,
        speed: position.speed,
        selectedCandidate: snapped.selectedCandidate,
      });
    },
    [clearRouteProgress, recordSnapHistory, setSnappedPosition],
  );

  // Snap eagerly when routes load (don't wait for next GPS refresh)
  useEffect(() => {
    if (!activeData || !activeRoutePoints?.length) return;
    const pos = useMapStore.getState().userPosition;
    if (!pos) return;
    applyRouteSnap(pos, { id: activeData.id, points: activeRoutePoints });
    // Intentional: fire only when active id or points change; the full activeData reference isn't meaningful
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeData?.id, activeRoutePoints, applyRouteSnap]);

  // Snap to route after each position refresh
  const snapAfterRefresh = useCallback(
    (position: UserPosition) => {
      const data = getActiveRouteDataImperative();
      if (data && data.points.length > 0) {
        applyRouteSnap(position, { id: data.id, points: data.points });
      }
    },
    [applyRouteSnap],
  );

  // On-demand GPS: fetch position on mount
  useEffect(() => {
    (async () => {
      const position = await refreshPosition();
      if (position) {
        if (!hasGpsFix) setHasGpsFix(true);
        snapAfterRefresh(position);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-refresh on app focus if position is stale
  useEffect(() => {
    const subscription = AppState.addEventListener("change", async (state) => {
      if (state !== "active") return;
      const pos = useMapStore.getState().userPosition;
      if (!pos || Date.now() - pos.timestamp >= GPS_STALE_THRESHOLD_MS) {
        const position = await refreshPosition();
        if (position) {
          if (!hasGpsFix) setHasGpsFix(true);
          snapAfterRefresh(position);
        }
      }
    });
    return () => subscription.remove();
  }, [refreshPosition, snapAfterRefresh, hasGpsFix]);

  // Track current climb based on snapped position
  useEffect(() => {
    if (activeRouteProgress && activeData) {
      updateCurrentClimb(
        activeRouteProgress.distanceAlongRouteMeters,
        activeData.routeIds,
        activeData.segments,
      );
    }
    // Intentional: fire on primitive id/distance changes, not on full object/array identities
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProgressDistanceMeters, activeData?.id, updateCurrentClimb]);

  const handlePOIClusterPress = useCallback(
    (centerCoordinate: [number, number], zoomLevel: number) => {
      setFollowUser(false);
      cameraRef.current?.setCamera({
        centerCoordinate,
        zoomLevel,
        animationMode: "easeTo",
        animationDuration: 450,
      });
    },
    [setFollowUser],
  );

  const handleLocate = useCallback(async () => {
    setFollowUser(true);
    // Snap to cached position instantly, then ease to fresh fix (no zoom change)
    const currentPos = useMapStore.getState().userPosition;
    if (currentPos) {
      cameraRef.current?.setCamera({
        centerCoordinate: [currentPos.longitude, currentPos.latitude],
        animationMode: "moveTo",
        animationDuration: 0,
      });
    }
    const position = await refreshPosition();
    if (position) {
      if (!hasGpsFix) setHasGpsFix(true);
      snapAfterRefresh(position);
      cameraRef.current?.setCamera({
        centerCoordinate: [position.longitude, position.latitude],
        animationMode: "easeTo",
        animationDuration: 500,
      });
    }
  }, [setFollowUser, refreshPosition, snapAfterRefresh, hasGpsFix]);

  const handleCameraChanged = useCallback(
    (state: { properties: { center: number[]; zoom: number } }) => {
      const c = state.properties.center;
      const zoom = state.properties.zoom;
      lastCamera.current = { center: [c[0], c[1]], zoom };
      updateRouteGeometryZoom(zoom, c[1]);
    },
    [updateRouteGeometryZoom],
  );

  // Persist camera to MMKV when app goes to background
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "background" || s === "inactive") {
        persistCamera(lastCamera.current.center, lastCamera.current.zoom);
      }
    });
    return () => sub.remove();
  }, [persistCamera]);

  const handleTouchStart = useCallback(() => {
    if (followUser) {
      setFollowUser(false);
    }
  }, [followUser, setFollowUser]);

  const cameraPadding = useMemo(
    () => ({
      paddingTop: 0,
      paddingLeft: 0,
      paddingRight: 0,
      paddingBottom: compactPanelHeight,
    }),
    [compactPanelHeight],
  );

  const pulsingConfig = useMemo(
    () => ({ isEnabled: true, color: themeColors.accent, radius: 40 }),
    [themeColors.accent],
  );

  // Standalone active route rendering; collections render as one stitched route below.
  const renderedRoutes = useMemo(
    () => routes.filter((r) => r.isVisible && r.isActive && visibleRoutePoints[r.id]),
    [routes, visibleRoutePoints],
  );

  const activeCollectionRouteId = activeData?.type === "collection" ? activeData.id : null;
  const routeGeometryRequests = useMemo<PreparedRouteGeometryRequest[]>(() => {
    const requests: PreparedRouteGeometryRequest[] = [];
    for (const route of renderedRoutes) {
      requests.push({
        id: `route:${route.id}`,
        cacheKey: route.id,
        points: visibleRoutePoints[route.id],
        toleranceMeters: routeGeometryToleranceMeters,
      });
    }
    if (activeCollectionRouteId && activeRoutePoints) {
      requests.push({
        id: `collection:${activeCollectionRouteId}`,
        cacheKey: `${activeCollectionRouteId}:${activeSegmentsKey}`,
        points: activeRoutePoints,
        toleranceMeters: routeGeometryToleranceMeters,
      });
    }
    return requests;
  }, [
    renderedRoutes,
    visibleRoutePoints,
    activeCollectionRouteId,
    activeRoutePoints,
    activeSegmentsKey,
    routeGeometryToleranceMeters,
  ]);
  const preparedRouteGeometries = usePreparedRouteGeometries(routeGeometryRequests);

  const routeLayers = useMemo<MapCanvasRouteLayer[]>(() => {
    const layers: MapCanvasRouteLayer[] = [];
    for (const route of renderedRoutes) {
      const prepared = preparedRouteGeometries[`route:${route.id}`];
      if (!prepared) continue;
      layers.push({
        id: route.id,
        key: `${route.id}-${mapStyle.styleKey}`,
        isActive: true,
        geoJSON: prepared.geoJSON,
      });
    }
    if (activeCollectionRouteId) {
      const prepared = preparedRouteGeometries[`collection:${activeCollectionRouteId}`];
      if (prepared) {
        layers.push({
          id: activeCollectionRouteId,
          key: `${activeCollectionRouteId}-${mapStyle.styleKey}`,
          isActive: true,
          geoJSON: prepared.geoJSON,
        });
      }
    }
    return layers;
  }, [renderedRoutes, preparedRouteGeometries, activeCollectionRouteId, mapStyle.styleKey]);

  useEffect(() => {
    if (activeData?.type !== "collection" || activeCollectionSegments.length === 0) {
      setActiveVariantMetricsByKey({});
      return;
    }
    const metrics: Record<string, VariantMetric> = {};
    measureSync("map.variantMetrics", () => {
      for (const variants of groupCollectionSegments(activeCollectionSegments)) {
        for (const sw of variants) {
          const metric = variantMetric(
            sw,
            activeVariantPointsByRouteId,
            powerConfig,
            variantMetricKey(sw),
          );
          if (metric) metrics[variantMetricKey(sw)] = metric;
        }
      }
    });
    setActiveVariantMetricsByKey(metrics);
  }, [activeData?.type, activeCollectionSegments, activeVariantPointsByRouteId, powerConfig]);

  const activeVariantOverlays = useMemo<VariantOverlay[]>(() => {
    if (activeData?.type !== "collection" || activeCollectionSegments.length === 0) return [];
    const overlays: VariantOverlay[] = [];
    for (const variants of groupCollectionSegments(activeCollectionSegments)) {
      if (variants.length <= 1) continue;
      const reference = variants.find((sw) => sw.segment.isSelected) ?? variants[0];
      const referenceMetric = activeVariantMetricsByKey[variantMetricKey(reference)];
      if (!referenceMetric) continue;

      for (const sw of variants) {
        if (sw.segment.isSelected) continue;
        const rawPoints = activeVariantPointsByRouteId[sw.route.id];
        const points =
          rawPoints &&
          sw.segment.variantKind === "full" &&
          reference.segment.variantKind === "patch" &&
          reference.segment.baseRouteId === sw.route.id &&
          reference.segment.replaceStartDistanceMeters != null &&
          reference.segment.replaceEndDistanceMeters != null
            ? sliceRoutePointsByDistance(
                rawPoints,
                reference.segment.replaceStartDistanceMeters,
                reference.segment.replaceEndDistanceMeters,
              )
            : rawPoints;
        if (!points || points.length < 2) continue;
        const metric = activeVariantMetricsByKey[variantMetricKey(sw)];
        if (!metric) continue;
        overlays.push({
          id: sw.route.id,
          points,
          label: variantDiffLabel(metric, referenceMetric, units),
        });
      }
    }
    return overlays;
  }, [
    activeData?.type,
    activeCollectionSegments,
    activeVariantPointsByRouteId,
    activeVariantMetricsByKey,
    units,
  ]);

  return (
    <View className="flex-1">
      <MapCanvas
        mapRef={mapRef}
        cameraRef={cameraRef}
        lastCamera={lastCamera}
        initialCamera={initialCamera.current}
        mapStyle={mapStyle}
        cameraPadding={cameraPadding}
        pulsingConfig={pulsingConfig}
        routeLayers={routeLayers}
        activeRoutePoints={activeRoutePoints}
        activeRouteIds={activeRouteIds}
        activeSegments={activeData?.segments ?? null}
        activeDataId={activeData?.id ?? null}
        activeContextKey={activeContextKey}
        activeTotalDistanceMeters={activeData?.totalDistanceMeters ?? null}
        activeProgressDistanceMeters={activeProgressDistanceMeters}
        mapOverlayMode={mapOverlayMode}
        activeVariantOverlays={activeVariantOverlays}
        weatherRouteId={weatherRouteId}
        weatherTimeline={weatherTimeline}
        weatherTemperatureMode={weatherTemperatureMode}
        showDistanceMarkers={showDistanceMarkers}
        poiVisibility={effectivePOIVisibility}
        onTouchStart={handleTouchStart}
        onCameraChanged={handleCameraChanged}
        onClusterPress={handlePOIClusterPress}
        setFollowUser={setFollowUser}
      />

      <MapControls onLocate={handleLocate} />
      <TabbedBottomPanel activeData={activeData} />
    </View>
  );
}
