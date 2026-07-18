import React, { useRef, useCallback, useEffect, useState, useMemo } from "react";
import { ActivityIndicator, View, AppState, Platform, useWindowDimensions } from "react-native";
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
  isRouteGeometryRequestRenderable,
  preparedRouteGeometryHasError,
  preparedRouteGeometryMatchesRequest,
  usePreparedRouteGeometries,
  type PreparedRouteGeometryRequest,
} from "@/hooks/usePreparedRouteGeometries";
import { GPS_STALE_THRESHOLD_MS } from "@/constants";
import MapControls from "./MapControls";
import MapCanvas, { type MapCanvasRouteLayer, type MapOverlayMode } from "./MapCanvas";
import type { VariantOverlay } from "./VariantOverlayLayer";
import TabbedBottomPanel from "./TabbedBottomPanel";
import { getWebMapCameraPadding } from "./webPanelLayout";
import { displayPOIsForActiveRoute } from "@/services/activePOIs";
import { stitchedSegmentsCacheSignature } from "@/services/relativeEtaCache";
import { resolveActiveRouteProgress } from "@/utils/routeProgress";
import { plannedStopsFromPOIs } from "@/services/plannedStops";
import { distanceBucketKey, WEATHER_PROGRESS_BUCKET_METERS } from "@/utils/distanceBuckets";
import { snapToRouteDetailed } from "@/services/routeSnapping";
import { useActiveRouteData, getActiveRouteDataImperative } from "@/hooks/useActiveRouteData";
import { usePoiStore } from "@/store/poiStore";
import { useClimbStore } from "@/store/climbStore";
import { useFerryStore } from "@/store/ferryStore";
import { useEtaStore } from "@/store/etaStore";
import { useWeatherStore } from "@/store/weatherStore";
import { useOfflineStore } from "@/store/offlineStore";
import { useSettingsStore } from "@/store/settingsStore";
import {
  collectionVariantKey,
  loadCollectionVariantDisplayData,
  type CollectionVariantMetric,
  type CollectionVariantOverlayGeometry,
} from "@/services/collectionVariantGeometry";
import { routeEndDistance } from "@/services/stitchingService";
import {
  allocateMapCoordinateBudget,
  estimateMapVisibleSpanMeters,
  haversineDistance,
  MAX_ROUTE_MAP_GEOJSON_POINTS,
} from "@/utils/geo";
import { buildCollectionSegmentMapFeatureCollectionsFromPreparedLines } from "@/utils/collectionSegmentDisplay";
import { ferryMapGeometrySignature } from "@/services/ferryGeometry";
import { getTimeAtDistance } from "@/services/etaCalculator";
import {
  ferryEndDistanceMeters,
  ferryStartDistanceMeters,
  geometricDistanceAtRidingDistance,
  ridingDistanceAtGeometricDistance,
  totalRidingDistanceMeters,
  type FerryTimingCrossing,
} from "@/services/ferryCrossings";
import {
  buildFerryMapLandPieces,
  buildFerryMapRouteComposition,
  ferriesContainedInDistanceRange,
} from "@/utils/ferryMapRoute";
import {
  buildDistanceMarkerDistances,
  getDistanceMarkerIntervalForZoom,
  type DistanceMarkerDistanceRange,
  type DistanceMarkerInterval,
} from "@/utils/routeMarkers";
import {
  formatDayAwareETAMarkerLabel,
  formatDistance,
  formatDuration,
  formatElevation,
} from "@/utils/formatters";
import { measureSync } from "@/utils/perfMarks";
import { pickRouteRecords } from "@/utils/routeScopedRecords";
import { yieldToUI } from "@/utils/yieldToUI";
import type {
  ActiveRouteData,
  CollectionSegmentWithRoute,
  RoutePoint,
  UnitSystem,
  UserPosition,
} from "@/types";
import { Text } from "@/components/ui/text";

interface MapCameraHandle {
  setCamera(options: {
    centerCoordinate?: [number, number];
    zoomLevel?: number;
    animationMode?: string;
    animationDuration?: number;
    padding?: {
      paddingTop: number;
      paddingLeft: number;
      paddingRight: number;
      paddingBottom: number;
    };
  }): void;
}

const ETA_MARKER_REFRESH_MS = 5 * 60_000;
const MARKER_VIEWPORT_BUFFER_MULTIPLIER = 1.5;
const MARKER_VIEWPORT_MIN_INTERVALS = 3;
const EMPTY_ACTIVE_FERRIES: NonNullable<ActiveRouteData["ferries"]> = [];

function collectionSegmentGeometryId(
  collectionId: string,
  segmentIndex: number,
  pieceIndex = 0,
): string {
  const base = `collection:${collectionId}:segment:${segmentIndex}`;
  return pieceIndex === 0 ? base : `${base}:land:${pieceIndex}`;
}

interface MapGeometrySource {
  requestId: string;
  layerId: string;
  cacheKey: string;
  points: RoutePoint[];
  startPointIndex?: number;
  endPointIndex?: number;
  pointCount: number;
}

interface MarkerCameraState {
  center: [number, number];
  zoom: number;
  intervalKm: DistanceMarkerInterval;
  visibleSpanMeters: number | null;
}

function markerCameraState(
  center: [number, number],
  zoom: number,
  viewportWidthPx: number,
  viewportHeightPx: number,
): MarkerCameraState {
  return {
    center,
    zoom,
    intervalKm: getDistanceMarkerIntervalForZoom(zoom),
    visibleSpanMeters: estimateMapVisibleSpanMeters(zoom, {
      latitude: center[1],
      viewportWidthPx,
      viewportHeightPx,
    }),
  };
}

function shouldRefreshMarkerCamera(previous: MarkerCameraState, next: MarkerCameraState): boolean {
  if (previous.intervalKm !== next.intervalKm) return true;
  const visibleSpanMeters = next.visibleSpanMeters ?? 0;
  const minMoveMeters = Math.max(visibleSpanMeters * 0.25, next.intervalKm * 1000 * 2);
  const movedMeters = haversineDistance(
    previous.center[1],
    previous.center[0],
    next.center[1],
    next.center[0],
  );
  return movedMeters >= minMoveMeters;
}

function routeDistanceRangeForMarkerCamera(
  points: RoutePoint[] | null,
  markerCamera: MarkerCameraState,
): DistanceMarkerDistanceRange | null {
  if (!points?.length || markerCamera.visibleSpanMeters == null) return null;

  const [longitude, latitude] = markerCamera.center;
  const markerIntervalMeters = markerCamera.intervalKm * 1000;
  const bufferMeters = Math.max(
    markerCamera.visibleSpanMeters * MARKER_VIEWPORT_BUFFER_MULTIPLIER,
    markerIntervalMeters * MARKER_VIEWPORT_MIN_INTERVALS,
  );
  const halfSpanMeters = markerCamera.visibleSpanMeters / 2 + bufferMeters;
  const latDelta = halfSpanMeters / 111_320;
  const lonMetersPerDegree = Math.max(1, 111_320 * Math.cos((Math.PI / 180) * latitude));
  const lonDelta = halfSpanMeters / lonMetersPerDegree;

  let startDistanceMeters = Infinity;
  let endDistanceMeters = -Infinity;

  for (const point of points) {
    if (
      point.latitude < latitude - latDelta ||
      point.latitude > latitude + latDelta ||
      point.longitude < longitude - lonDelta ||
      point.longitude > longitude + lonDelta
    ) {
      continue;
    }
    startDistanceMeters = Math.min(startDistanceMeters, point.distanceFromStartMeters);
    endDistanceMeters = Math.max(endDistanceMeters, point.distanceFromStartMeters);
  }

  if (!Number.isFinite(startDistanceMeters) || !Number.isFinite(endDistanceMeters)) {
    const nearest = points.reduce(
      (best, point) => {
        const distanceMeters = haversineDistance(
          latitude,
          longitude,
          point.latitude,
          point.longitude,
        );
        return distanceMeters < best.distanceMeters ? { point, distanceMeters } : best;
      },
      { point: points[0], distanceMeters: Infinity },
    ).point;
    startDistanceMeters = nearest.distanceFromStartMeters;
    endDistanceMeters = nearest.distanceFromStartMeters;
  }

  const totalDistanceMeters = points[points.length - 1].distanceFromStartMeters;
  return {
    startDistanceMeters: Math.max(0, startDistanceMeters - bufferMeters),
    endDistanceMeters: Math.min(totalDistanceMeters, endDistanceMeters + bufferMeters),
  };
}

function mergeMarkerDistanceRange(
  viewportRange: DistanceMarkerDistanceRange | null,
  etaStartDistanceMeters: number | null,
  totalDistanceMeters: number | null,
): DistanceMarkerDistanceRange | null {
  if (totalDistanceMeters == null) return viewportRange;
  if (etaStartDistanceMeters == null) return viewportRange;

  const startDistanceMeters = Math.min(totalDistanceMeters, etaStartDistanceMeters + 1);
  if (!viewportRange) {
    return { startDistanceMeters, endDistanceMeters: totalDistanceMeters };
  }

  return {
    startDistanceMeters: Math.max(viewportRange.startDistanceMeters, startDistanceMeters),
    endDistanceMeters: viewportRange.endDistanceMeters,
  };
}

export function buildEtaMarkerLabelMap(input: {
  cumulativeTime: number[] | null;
  points: RoutePoint[] | null;
  fromDistanceMeters: number | null;
  markerIntervalKm: DistanceMarkerInterval;
  markerDistanceRange: DistanceMarkerDistanceRange | null;
  ferries?: readonly FerryTimingCrossing[];
  plannedStops: readonly { distanceMeters: number; durationSeconds: number }[];
  etaBaseTimeMs: number;
}): Map<number, string> {
  const labels = new Map<number, string>();
  const { cumulativeTime, points, fromDistanceMeters } = input;
  if (!cumulativeTime || !points?.length || fromDistanceMeters == null) return labels;

  const ferries = input.ferries ?? [];
  const fromTimeSeconds = getTimeAtDistance(cumulativeTime, points, fromDistanceMeters, ferries);
  if (fromTimeSeconds == null) return labels;

  const totalGeometricDistanceMeters = points[points.length - 1].distanceFromStartMeters;
  const excludedDistanceSpans = ferries.map((ferry) => ({
    startDistanceMeters: ferryStartDistanceMeters(ferry),
    endDistanceMeters: ferryEndDistanceMeters(ferry),
  }));
  const markerDistanceRange = input.markerDistanceRange
    ? {
        startDistanceMeters: ridingDistanceAtGeometricDistance(
          input.markerDistanceRange.startDistanceMeters,
          excludedDistanceSpans,
        ),
        endDistanceMeters: ridingDistanceAtGeometricDistance(
          input.markerDistanceRange.endDistanceMeters,
          excludedDistanceSpans,
        ),
      }
    : null;
  const targetRidingDistances = buildDistanceMarkerDistances(
    totalRidingDistanceMeters(totalGeometricDistanceMeters, excludedDistanceSpans),
    input.markerIntervalKm,
    markerDistanceRange,
  );

  let stopIndex = 0;
  let stopOffsetSeconds = 0;
  const plannedStops = input.plannedStops;
  while (
    stopIndex < plannedStops.length &&
    plannedStops[stopIndex].distanceMeters <= fromDistanceMeters
  ) {
    stopIndex++;
  }

  for (const ridingDistanceMeters of targetRidingDistances) {
    const geometricDistanceMeters = geometricDistanceAtRidingDistance(
      ridingDistanceMeters,
      totalGeometricDistanceMeters,
      excludedDistanceSpans,
    );
    if (geometricDistanceMeters <= fromDistanceMeters) continue;

    const targetTimeSeconds = getTimeAtDistance(
      cumulativeTime,
      points,
      geometricDistanceMeters,
      ferries,
    );
    if (targetTimeSeconds == null) continue;

    while (
      stopIndex < plannedStops.length &&
      plannedStops[stopIndex].distanceMeters < geometricDistanceMeters
    ) {
      stopOffsetSeconds += plannedStops[stopIndex].durationSeconds;
      stopIndex++;
    }

    const ridingTimeSeconds = targetTimeSeconds - fromTimeSeconds + stopOffsetSeconds;
    if (ridingTimeSeconds <= 0) continue;
    labels.set(
      geometricDistanceMeters,
      formatDayAwareETAMarkerLabel(
        new Date(input.etaBaseTimeMs + ridingTimeSeconds * 1000),
        input.etaBaseTimeMs,
      ),
    );
  }

  return labels;
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

function variantDiffLabel(
  metric: CollectionVariantMetric,
  reference: CollectionVariantMetric,
  units: UnitSystem,
) {
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

function plannedStopsSignature(
  stops: readonly { distanceMeters: number; durationSeconds: number }[],
) {
  if (stops.length === 0) return "none";
  return stops
    .map((stop) => `${Math.round(stop.distanceMeters)}:${stop.durationSeconds}`)
    .join(",");
}

export default function MapScreen() {
  const themeColors = useThemeColors();
  const mapStyle = useMapStyle();
  const cameraRef = useRef<MapCameraHandle | null>(null);
  const mapRef = useRef<unknown | null>(null);
  const [hasGpsFix, setHasGpsFix] = useState(false);
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const isWeb = Platform.OS === "web";

  const followUser = useMapStore((s) => s.followUser);
  const setFollowUser = useMapStore((s) => s.setFollowUser);
  const distanceMarkerMode = useMapStore((s) => s.distanceMarkerMode);
  const poiVisibility = useMapStore((s) => s.poiVisibility);
  const refreshPosition = useMapStore((s) => s.refreshPosition);
  const persistCamera = useMapStore((s) => s.persistCamera);
  const initialCamera = useRef({
    center: useMapStore.getState().center,
    zoom: useMapStore.getState().zoom,
  });
  const lastCamera = useRef(initialCamera.current);
  const [markerCamera, setMarkerCamera] = useState(() =>
    markerCameraState(
      initialCamera.current.center,
      initialCamera.current.zoom,
      screenWidth,
      screenHeight,
    ),
  );
  const markerCameraRef = useRef(markerCamera);
  const { routeGeometryToleranceMeters, updateRouteGeometryZoom } = useRouteGeometryZoom(
    initialCamera.current.zoom,
    initialCamera.current.center[1],
  );
  const panelTab = usePanelStore((s) => s.panelTab);
  const mapOverlayMode: MapOverlayMode =
    panelTab === "climbs" ? "climbs" : !isWeb && panelTab === "weather" ? "weather" : "normal";
  const effectivePOIVisibility = isWeb ? "all" : panelTab === "pois" ? "all" : poiVisibility;
  const { top: safeTop, bottom: safeBottom } = useSafeAreaInsets();
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
  const loadFerries = useFerryStore((s) => s.loadFerries);
  const ensureRelativeETA = useEtaStore((s) => s.ensureRelativeETA);
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
  const [activeVariantOverlaysByKey, setActiveVariantOverlaysByKey] = useState<
    Record<string, CollectionVariantOverlayGeometry>
  >({});
  const [activeVariantMetricsByKey, setActiveVariantMetricsByKey] = useState<
    Record<string, CollectionVariantMetric>
  >({});
  const [isVariantDataPreparing, setIsVariantDataPreparing] = useState(false);

  // Unified active context — works for both standalone routes and collections
  const activeData = useActiveRouteData();
  const activeRoutePoints = activeData?.points ?? null;
  const timing = useActiveRouteTiming(activeData);
  const activeRouteIds = useMemo(() => activeData?.routeIds ?? [], [activeData?.routeIds]);
  const allPois = usePoiStore(useShallow((s) => pickRouteRecords(s.pois, activeRouteIds)));
  const activeFerries = activeData?.ferries ?? EMPTY_ACTIVE_FERRIES;
  const ferryRevision = useFerryStore((state) => state.revision);
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
    () => stitchedSegmentsCacheSignature(activeData?.segments),
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
  const activeProgressDistanceRef = useRef(activeProgressDistanceMeters);
  activeProgressDistanceRef.current = activeProgressDistanceMeters;
  const [etaMarkerRefreshMs, setEtaMarkerRefreshMs] = useState(() => Date.now());
  const [etaAnchorDistanceMeters, setEtaAnchorDistanceMeters] = useState<number | null>(null);
  const weatherProgressBucketKey = distanceBucketKey(
    activeProgressDistanceMeters,
    WEATHER_PROGRESS_BUCKET_METERS,
  );

  useEffect(() => {
    if (distanceMarkerMode !== "eta") return;
    setEtaMarkerRefreshMs(Date.now());
    const interval = setInterval(() => setEtaMarkerRefreshMs(Date.now()), ETA_MARKER_REFRESH_MS);
    return () => clearInterval(interval);
  }, [distanceMarkerMode]);

  useEffect(() => {
    if (distanceMarkerMode !== "eta") {
      setEtaAnchorDistanceMeters(null);
      return;
    }
    setEtaAnchorDistanceMeters(activeProgressDistanceRef.current);
  }, [activeData?.id, distanceMarkerMode, etaMarkerRefreshMs]);

  useEffect(() => {
    if (
      distanceMarkerMode === "eta" &&
      etaAnchorDistanceMeters == null &&
      activeProgressDistanceMeters != null
    ) {
      setEtaAnchorDistanceMeters(activeProgressDistanceMeters);
    }
  }, [activeProgressDistanceMeters, distanceMarkerMode, etaAnchorDistanceMeters]);

  const viewportMarkerDistanceRange = useMemo(
    () => routeDistanceRangeForMarkerCamera(activeRoutePoints, markerCamera),
    [activeRoutePoints, markerCamera],
  );
  const markerDistanceRange = useMemo(
    () =>
      mergeMarkerDistanceRange(
        viewportMarkerDistanceRange,
        distanceMarkerMode === "eta" ? etaAnchorDistanceMeters : null,
        activeRoutePoints ? routeEndDistance(activeRoutePoints) : null,
      ),
    [activeRoutePoints, distanceMarkerMode, etaAnchorDistanceMeters, viewportMarkerDistanceRange],
  );
  const etaMarkerLabels = useMemo(
    () =>
      distanceMarkerMode === "eta"
        ? buildEtaMarkerLabelMap({
            cumulativeTime,
            points: activeRoutePoints,
            fromDistanceMeters: etaAnchorDistanceMeters,
            markerIntervalKm: markerCamera.intervalKm,
            markerDistanceRange,
            ferries: activeFerries,
            plannedStops,
            etaBaseTimeMs: timing.futureStartMs ?? etaMarkerRefreshMs,
          })
        : new Map<number, string>(),
    [
      activeRoutePoints,
      activeFerries,
      cumulativeTime,
      distanceMarkerMode,
      etaAnchorDistanceMeters,
      etaMarkerRefreshMs,
      markerCamera.intervalKm,
      markerDistanceRange,
      plannedStops,
      timing.futureStartMs,
    ],
  );
  const etaLabelVersion = `${markerCamera.intervalKm}:${markerDistanceRange?.startDistanceMeters ?? 0}:${
    markerDistanceRange?.endDistanceMeters ?? "all"
  }:${etaAnchorDistanceMeters ?? "none"}:${etaMarkerRefreshMs}:${plannedStopsKey}:${
    timing.futureStartMs ?? "now"
  }`;

  const routeMarkerEtaLabelForDistanceMeters = useCallback(
    (distanceMeters: number) => etaMarkerLabels.get(distanceMeters) ?? null,
    [etaMarkerLabels],
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
      loadFerries(routeId);
    }
  }, [activeRouteIds, activeRouteIdsKey, loadPOIs, loadClimbs, loadFerries]);

  useEffect(() => {
    if (!activeData || !activeRoutePoints?.length) return;
    void ensureRelativeETA({
      scope: activeData.type,
      scopeId: activeData.id,
      points: activeRoutePoints,
      totalDistanceMeters: activeData.totalDistanceMeters,
      totalAscentMeters: activeData.totalAscentMeters,
      totalDescentMeters: activeData.totalDescentMeters,
      segmentsSignature: activeSegmentsKey,
      ferries: activeFerries,
    });
    // Intentional: depend on scalar active route fields; the full activeData object churns.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeData?.id,
    activeData?.type,
    activeRoutePoints,
    activeData?.totalDistanceMeters,
    activeData?.totalAscentMeters,
    activeData?.totalDescentMeters,
    activeSegmentsKey,
    activeFerries,
    ensureRelativeETA,
  ]);

  // Fetch weather when active context + snapped position + ETA are available (and online)
  useEffect(() => {
    if (
      !isWeb &&
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
    isWeb,
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
      const center: [number, number] = [c[0], c[1]];
      lastCamera.current = { center, zoom };
      updateRouteGeometryZoom(zoom, c[1]);
      const nextMarkerCamera = markerCameraState(center, zoom, screenWidth, screenHeight);
      if (shouldRefreshMarkerCamera(markerCameraRef.current, nextMarkerCamera)) {
        markerCameraRef.current = nextMarkerCamera;
        setMarkerCamera(nextMarkerCamera);
      }
    },
    [screenHeight, screenWidth, updateRouteGeometryZoom],
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
    () =>
      isWeb
        ? getWebMapCameraPadding(screenWidth, screenHeight, safeBottom)
        : {
            paddingTop: 0,
            paddingLeft: 0,
            paddingRight: 0,
            paddingBottom: compactPanelHeight,
          },
    [compactPanelHeight, isWeb, safeBottom, screenHeight, screenWidth],
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
  const activeCollectionDisplaySegments =
    activeData?.type === "collection" && activeData.segments && activeData.segments.length > 1
      ? activeData.segments
      : null;
  const activeFerryMapGeometryKey = useMemo(
    () => ferryMapGeometrySignature(activeFerries),
    [activeFerries],
  );
  const activeMapComposition = useMemo(
    () =>
      activeRoutePoints ? buildFerryMapRouteComposition(activeRoutePoints, activeFerries) : null,
    [activeFerries, activeRoutePoints],
  );
  const activeMapRoutePoints = activeMapComposition?.displayPoints ?? activeRoutePoints;

  const standaloneGeometrySources = useMemo<MapGeometrySource[]>(() => {
    const sources: MapGeometrySource[] = [];
    for (const route of renderedRoutes) {
      const routePoints = visibleRoutePoints[route.id];
      if (!routePoints) continue;
      const usesActiveComposition =
        activeData?.type === "route" && activeData.id === route.id && activeMapComposition != null;
      const pieces = usesActiveComposition ? activeMapComposition.landPieces : [routePoints];
      const geometryKey = usesActiveComposition ? activeFerryMapGeometryKey : "";
      pieces.forEach((points, pieceIndex) => {
        const requestId =
          pieceIndex === 0 ? `route:${route.id}` : `route:${route.id}:land:${pieceIndex}`;
        sources.push({
          requestId,
          layerId: pieces.length === 1 ? route.id : `${route.id}-land-${pieceIndex}`,
          cacheKey: geometryKey
            ? `${route.id}:ferries:${geometryKey}:land:${pieceIndex}`
            : route.id,
          points,
          pointCount: points.length,
        });
      });
    }
    return sources;
  }, [
    activeData?.id,
    activeData?.type,
    activeFerryMapGeometryKey,
    activeMapComposition,
    renderedRoutes,
    visibleRoutePoints,
  ]);

  const collectionGeometrySources = useMemo<MapGeometrySource[][]>(() => {
    if (!activeCollectionRouteId || !activeRoutePoints || !activeMapComposition) return [];
    if (!activeCollectionDisplaySegments) {
      return [
        activeMapComposition.landPieces.map((points, pieceIndex) => ({
          requestId:
            pieceIndex === 0
              ? `collection:${activeCollectionRouteId}`
              : `collection:${activeCollectionRouteId}:land:${pieceIndex}`,
          layerId:
            activeMapComposition.landPieces.length === 1
              ? activeCollectionRouteId
              : `${activeCollectionRouteId}-land-${pieceIndex}`,
          cacheKey: `${activeCollectionRouteId}:${activeSegmentsKey}:ferries:${activeFerryMapGeometryKey}:land:${pieceIndex}`,
          points,
          pointCount: points.length,
        })),
      ];
    }

    return activeCollectionDisplaySegments.map((segment, segmentIndex) => {
      const startPoint = activeRoutePoints[segment.startPointIndex];
      const endPoint = activeRoutePoints[segment.endPointIndex];
      if (!startPoint || !endPoint) return [];
      const segmentFerries = ferriesContainedInDistanceRange(
        activeFerries,
        startPoint.distanceFromStartMeters,
        endPoint.distanceFromStartMeters,
      );
      if (segmentFerries.length === 0) {
        return [
          {
            requestId: collectionSegmentGeometryId(activeCollectionRouteId, segmentIndex),
            layerId: `${activeCollectionRouteId}-segment-${segmentIndex}`,
            cacheKey: `${activeCollectionRouteId}:${activeSegmentsKey}:segment:${segmentIndex}`,
            points: activeRoutePoints,
            startPointIndex: segment.startPointIndex,
            endPointIndex: segment.endPointIndex,
            pointCount: Math.max(0, segment.endPointIndex - segment.startPointIndex + 1),
          },
        ];
      }

      const segmentPoints = activeRoutePoints.slice(
        segment.startPointIndex,
        segment.endPointIndex + 1,
      );
      const landPieces = buildFerryMapLandPieces(segmentPoints, segmentFerries);
      const geometryKey = ferryMapGeometrySignature(segmentFerries);
      return landPieces.map((points, pieceIndex) => ({
        requestId: collectionSegmentGeometryId(activeCollectionRouteId, segmentIndex, pieceIndex),
        layerId: `${activeCollectionRouteId}-segment-${segmentIndex}-land-${pieceIndex}`,
        cacheKey: `${activeCollectionRouteId}:${activeSegmentsKey}:segment:${segmentIndex}:ferries:${geometryKey}:land:${pieceIndex}`,
        points,
        pointCount: points.length,
      }));
    });
  }, [
    activeCollectionDisplaySegments,
    activeCollectionRouteId,
    activeFerries,
    activeFerryMapGeometryKey,
    activeMapComposition,
    activeRoutePoints,
    activeSegmentsKey,
  ]);

  const routeGeometrySources = useMemo(
    () => [...standaloneGeometrySources, ...collectionGeometrySources.flat()],
    [collectionGeometrySources, standaloneGeometrySources],
  );
  const routeGeometryRequests = useMemo<PreparedRouteGeometryRequest[]>(() => {
    const pointBudgets = allocateMapCoordinateBudget(
      routeGeometrySources.map((source) => source.pointCount),
      MAX_ROUTE_MAP_GEOJSON_POINTS,
    );
    return routeGeometrySources.map((source, index) => ({
      id: source.requestId,
      cacheKey: source.cacheKey,
      points: source.points,
      toleranceMeters: routeGeometryToleranceMeters,
      startPointIndex: source.startPointIndex,
      endPointIndex: source.endPointIndex,
      maxPoints: pointBudgets[index],
    }));
  }, [routeGeometrySources, routeGeometryToleranceMeters]);
  const preparedRouteGeometries = usePreparedRouteGeometries(routeGeometryRequests);
  const isRouteGeometryPreparing = routeGeometryRequests.some((request) => {
    if (!isRouteGeometryRequestRenderable(request)) return false;
    return !preparedRouteGeometryMatchesRequest(preparedRouteGeometries[request.id], request);
  });
  const hasRouteGeometryError = routeGeometryRequests.some((request) =>
    preparedRouteGeometryHasError(preparedRouteGeometries[request.id], request),
  );

  const routeLayers = useMemo<MapCanvasRouteLayer[]>(() => {
    const layerSources = [
      ...standaloneGeometrySources,
      ...(!activeCollectionDisplaySegments ? (collectionGeometrySources[0] ?? []) : []),
    ];
    return layerSources.flatMap((source) => {
      const prepared = preparedRouteGeometries[source.requestId];
      return prepared
        ? [
            {
              id: source.layerId,
              key: `${source.cacheKey}-${mapStyle.styleKey}`,
              isActive: true,
              geoJSON: prepared.geoJSON,
            },
          ]
        : [];
    });
  }, [
    activeCollectionDisplaySegments,
    collectionGeometrySources,
    mapStyle.styleKey,
    preparedRouteGeometries,
    standaloneGeometrySources,
  ]);

  const collectionSegmentFeatures = useMemo(() => {
    const preparedLines =
      activeCollectionRouteId && activeCollectionDisplaySegments
        ? collectionGeometrySources.map((sources) =>
            sources.flatMap((source) => {
              const prepared = preparedRouteGeometries[source.requestId];
              return prepared ? [prepared.geoJSON] : [];
            }),
          )
        : [];
    return buildCollectionSegmentMapFeatureCollectionsFromPreparedLines(
      activeRoutePoints,
      activeCollectionDisplaySegments,
      preparedLines,
    );
  }, [
    activeCollectionDisplaySegments,
    activeCollectionRouteId,
    activeRoutePoints,
    collectionGeometrySources,
    preparedRouteGeometries,
  ]);
  const mapPreparationLabel = isRouteGeometryPreparing
    ? "Preparing route…"
    : isVariantDataPreparing
      ? "Preparing route options…"
      : hasRouteGeometryError
        ? "Couldn’t prepare part of the route display"
        : null;
  const mapPreparationError =
    !isRouteGeometryPreparing && !isVariantDataPreparing && hasRouteGeometryError;

  const activeVariantOverlays = useMemo<VariantOverlay[]>(() => {
    if (activeData?.type !== "collection" || activeCollectionSegments.length === 0) return [];
    const overlays: VariantOverlay[] = [];
    for (const variants of groupCollectionSegments(activeCollectionSegments)) {
      if (variants.length <= 1) continue;
      const reference = variants.find((sw) => sw.segment.isSelected) ?? variants[0];
      const referenceMetric = activeVariantMetricsByKey[collectionVariantKey(reference)];
      if (!referenceMetric) continue;

      for (const sw of variants) {
        if (sw.segment.isSelected) continue;
        const overlayGeometry = activeVariantOverlaysByKey[collectionVariantKey(sw)];
        if (!overlayGeometry || overlayGeometry.geoJSON.geometry.coordinates.length < 2) continue;
        const metric = activeVariantMetricsByKey[collectionVariantKey(sw)];
        if (!metric) continue;
        overlays.push({
          id: sw.route.id,
          ...overlayGeometry,
          label: variantDiffLabel(metric, referenceMetric, units),
        });
      }
    }
    return overlays;
  }, [
    activeData?.type,
    activeCollectionSegments,
    activeVariantOverlaysByKey,
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
        collectionSegmentFeatures={collectionSegmentFeatures}
        isRouteGeometryPreparing={isRouteGeometryPreparing}
        activeRoutePoints={activeMapRoutePoints}
        activeRouteIds={activeRouteIds}
        activeSegments={activeData?.segments ?? null}
        activeDataId={activeData?.id ?? null}
        activeContextKey={activeContextKey}
        activeTotalDistanceMeters={activeData?.totalDistanceMeters ?? null}
        activeProgressDistanceMeters={activeProgressDistanceMeters}
        activeFerries={activeFerries}
        mapOverlayMode={mapOverlayMode}
        activeVariantOverlays={activeVariantOverlays}
        weatherRouteId={weatherRouteId}
        weatherTimeline={weatherTimeline}
        weatherTemperatureMode={weatherTemperatureMode}
        distanceMarkerMode={distanceMarkerMode}
        markerIntervalKm={markerCamera.intervalKm}
        markerDistanceRange={markerDistanceRange}
        etaLabelForDistanceMeters={routeMarkerEtaLabelForDistanceMeters}
        etaLabelVersion={etaLabelVersion}
        poiVisibility={effectivePOIVisibility}
        onTouchStart={handleTouchStart}
        onCameraChanged={handleCameraChanged}
        onClusterPress={handlePOIClusterPress}
        setFollowUser={setFollowUser}
      />

      {mapPreparationLabel && (
        <View
          pointerEvents="none"
          className="absolute left-0 right-0 z-20 items-center px-16"
          style={{ top: safeTop + 12 }}
        >
          <View
            className="flex-row items-center gap-2 rounded-full border border-border bg-card px-3 py-2 shadow-sm"
            accessible
            accessibilityRole={mapPreparationError ? "alert" : "progressbar"}
            accessibilityLiveRegion="polite"
            accessibilityLabel={mapPreparationLabel}
          >
            {!mapPreparationError && <ActivityIndicator size="small" color={themeColors.accent} />}
            <Text
              className={`text-[13px] font-barlow-medium ${
                mapPreparationError ? "text-destructive" : "text-foreground"
              }`}
            >
              {mapPreparationLabel}
            </Text>
          </View>
        </View>
      )}

      <MapControls onLocate={handleLocate} />
      <TabbedBottomPanel activeData={activeData} />
    </View>
  );
}
