import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { X } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import RoutePreviewMap, { type RoutePreviewMapLayer } from "@/components/map/RoutePreviewMap";
import { useThemeColors } from "@/theme";
import { useFerryStore } from "@/store/ferryStore";
import { useSettingsStore } from "@/store/settingsStore";
import {
  lookupFerriesNearPoint,
  matchFerryCandidateToRoute,
  type FerryLookupCandidate,
  type MatchedFerrySpan,
} from "@/services/ferryLookup";
import { validateFerryCrossing } from "@/services/ferryCrossings";
import {
  encodeOSMFerryGeometry,
  ferryMapGeometrySignature,
  OSM_FERRY_GEOMETRY_PROVIDER_REF,
  orientFerryGeometry,
  resolveFerryMapGeometry,
} from "@/services/ferryGeometry";
import {
  enturProviderRefsForPair,
  pickEnturFerryProviderRefs,
  readLinkedEnturFerryStops,
  resolveEnturFerryStopPair,
  withoutEnturFerryProviderRefs,
} from "@/services/enturFerry";
import {
  buildRouteSegmentSpatialIndex,
  computePOIRouteAssociation,
  interpolateRoutePointAtDistance,
  type RouteSegmentSpatialIndex,
} from "@/utils/geo";
import { buildFerryMapLandPieces } from "@/utils/ferryMapRoute";
import { toDisplayDistanceMeters } from "@/services/displayDistance";
import { generateId } from "@/utils/generateId";
import { formatDistance } from "@/utils/formatters";
import type { DisplayFerryCrossing, FerryCrossing, RouteWithPoints, RoutePoint } from "@/types";

type EditorStage = "boarding" | "lookup" | "candidates" | "landing" | "confirm";

interface FerryEditorModalProps {
  visible: boolean;
  route: RouteWithPoints;
  crossing?: FerryCrossing | null;
  refreshMetadata?: boolean;
  onClose: () => void;
}

function numericValue(value: string): number {
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function routeSpanPoints(
  span: MatchedFerrySpan | null,
  providerRefs: Record<string, string>,
): RoutePoint[] {
  if (!span) return [];
  const geometry = resolveFerryMapGeometry({ ...span, providerRefs });
  if (!geometry) return [];
  const distanceSpan = span.endDistanceMeters - span.startDistanceMeters;
  if (distanceSpan <= 1) {
    return [
      {
        ...geometry[0],
        idx: 0,
        elevationMeters: null,
        distanceFromStartMeters: span.startDistanceMeters,
      },
    ];
  }
  return geometry.map((point, index) => ({
    latitude: point.latitude,
    longitude: point.longitude,
    idx: index,
    elevationMeters: null,
    distanceFromStartMeters:
      span.startDistanceMeters + distanceSpan * (index / Math.max(1, geometry.length - 1)),
  }));
}

function crossingSpan(crossing: FerryCrossing): MatchedFerrySpan {
  return {
    startDistanceMeters: crossing.startDistanceMeters,
    endDistanceMeters: crossing.endDistanceMeters,
    startLatitude: crossing.startLatitude,
    startLongitude: crossing.startLongitude,
    endLatitude: crossing.endLatitude,
    endLongitude: crossing.endLongitude,
  };
}

function Field({
  label,
  value,
  onChangeText,
  keyboardType,
  placeholder,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  keyboardType?: "default" | "numeric" | "url";
  placeholder?: string;
}) {
  return (
    <View className="mb-4">
      <Text className="mb-1 text-[14px] font-barlow-medium text-muted-foreground">{label}</Text>
      <TextInput
        className="min-h-[52px] rounded-xl border border-border bg-card px-3 font-barlow text-[16px] text-foreground"
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        autoCapitalize={keyboardType === "url" ? "none" : "sentences"}
        autoCorrect={keyboardType !== "url"}
        placeholder={placeholder}
        placeholderTextColor="#8A837C"
        accessibilityLabel={label}
      />
    </View>
  );
}

export default function FerryEditorModal({
  visible,
  route,
  crossing = null,
  refreshMetadata = false,
  onClose,
}: FerryEditorModalProps) {
  const colors = useThemeColors();
  const units = useSettingsStore((state) => state.units);
  const saveFerry = useFerryStore((state) => state.saveFerry);
  const abortRef = useRef<AbortController | null>(null);
  const enturAbortRef = useRef<AbortController | null>(null);
  const routeSpatialIndexRef = useRef<{
    points: RoutePoint[];
    index: RouteSegmentSpatialIndex | null;
  } | null>(null);
  const [stage, setStage] = useState<EditorStage>("boarding");
  const [span, setSpan] = useState<MatchedFerrySpan | null>(null);
  const [boardingHint, setBoardingHint] = useState<number | null>(null);
  const [candidates, setCandidates] = useState<FerryLookupCandidate[]>([]);
  const [candidateMatches, setCandidateMatches] = useState<Record<string, MatchedFerrySpan>>({});
  const [lookupMessage, setLookupMessage] = useState<string | null>(null);
  const [name, setName] = useState("Ferry crossing");
  const [duration, setDuration] = useState("20");
  const [assumedWait, setAssumedWait] = useState("15");
  const [boardingBuffer, setBoardingBuffer] = useState("5");
  const [timetableUrl, setTimetableUrl] = useState("");
  const [operator, setOperator] = useState("");
  const [sourceCandidate, setSourceCandidate] = useState<FerryLookupCandidate | null>(null);
  const [isManualSpan, setIsManualSpan] = useState(false);
  const [enturProviderRefs, setEnturProviderRefs] = useState<Record<string, string>>({});
  const [enturError, setEnturError] = useState<string | null>(null);
  const [isEnturSearching, setIsEnturSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const linkedEnturStops = useMemo(
    () => readLinkedEnturFerryStops(enturProviderRefs),
    [enturProviderRefs],
  );

  const previewProviderRefs = useMemo(() => {
    if (isManualSpan) return {};
    if (!sourceCandidate) return crossing?.providerRefs ?? {};
    const oriented = span
      ? orientFerryGeometry(
          sourceCandidate.geometry,
          { latitude: span.startLatitude, longitude: span.startLongitude },
          { latitude: span.endLatitude, longitude: span.endLongitude },
        )
      : sourceCandidate.geometry;
    const encoded = encodeOSMFerryGeometry(oriented);
    return encoded ? { [OSM_FERRY_GEOMETRY_PROVIDER_REF]: encoded } : {};
  }, [crossing?.providerRefs, isManualSpan, sourceCandidate, span]);
  const selectionPoints = useMemo(
    () => routeSpanPoints(span, previewProviderRefs),
    [previewProviderRefs, span],
  );
  const previewFerry = useMemo<DisplayFerryCrossing | null>(() => {
    if (!span || span.endDistanceMeters <= span.startDistanceMeters + 1) return null;
    const now = crossing?.createdAt ?? "preview";
    return {
      id: crossing?.id ?? "ferry-preview",
      routeId: route.id,
      // Text edits do not change preview geometry. Keeping the geometry model
      // independent avoids re-preparing and refitting the map while typing.
      name: crossing?.name ?? "Ferry crossing",
      ...span,
      effectiveStartDistanceMeters: toDisplayDistanceMeters(span.startDistanceMeters),
      effectiveEndDistanceMeters: toDisplayDistanceMeters(span.endDistanceMeters),
      durationMinutes: crossing?.durationMinutes ?? 0,
      assumedWaitMinutes: crossing?.assumedWaitMinutes ?? 0,
      boardingBufferMinutes: crossing?.boardingBufferMinutes ?? 0,
      source: isManualSpan ? "manual" : (crossing?.source ?? "osm"),
      sourceId: crossing?.sourceId ?? null,
      sourceUrl: crossing?.sourceUrl ?? null,
      operator: crossing?.operator ?? null,
      timetableUrl: crossing?.timetableUrl ?? null,
      bicycleAccess: crossing?.bicycleAccess ?? "unknown",
      providerRefs: previewProviderRefs,
      tags: crossing?.tags ?? {},
      createdAt: now,
      updatedAt: now,
    };
  }, [crossing, isManualSpan, previewProviderRefs, route.id, span]);
  const layers = useMemo<RoutePreviewMapLayer[]>(() => {
    const pieces = previewFerry
      ? buildFerryMapLandPieces(route.points, [previewFerry])
      : [route.points];
    const geometryKey = previewFerry ? ferryMapGeometrySignature([previewFerry]) : "none";
    return pieces.map((points, index) => ({
      id: `${route.id}-land-${index}`,
      cacheKey: `${route.id}:ferry-preview:${geometryKey}:land:${index}`,
      points,
      isActive: true,
    }));
  }, [previewFerry, route.id, route.points]);

  const runLookup = useCallback(
    async (latitude: number, longitude: number, hintDistance: number) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setStage("lookup");
      setLookupMessage("Searching nearby OSM ferry routes…");
      setError(null);
      try {
        const found = await lookupFerriesNearPoint(latitude, longitude, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if (routeSpatialIndexRef.current?.points !== route.points) {
          routeSpatialIndexRef.current = {
            points: route.points,
            index: buildRouteSegmentSpatialIndex(route.points, 1_500),
          };
        }
        const nextMatches: Record<string, MatchedFerrySpan> = {};
        const matchable = found.filter((candidate) => {
          const match = matchFerryCandidateToRoute(
            candidate,
            route.points,
            hintDistance,
            1_500,
            routeSpatialIndexRef.current?.index,
          );
          if (match) nextMatches[candidate.id] = match;
          return match != null;
        });
        setCandidates(matchable);
        setCandidateMatches(nextMatches);
        setStage("candidates");
        setLookupMessage(
          matchable.length > 0
            ? null
            : "No ferry route could be matched here. Select the landing point manually.",
        );
      } catch (lookupError) {
        if (controller.signal.aborted) return;
        setCandidates([]);
        setCandidateMatches({});
        setStage("candidates");
        setLookupMessage(
          lookupError instanceof Error
            ? `Lookup unavailable: ${lookupError.message}`
            : "Lookup unavailable. Select the landing point manually.",
        );
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [route.points],
  );

  useEffect(() => {
    if (!visible) {
      abortRef.current?.abort();
      enturAbortRef.current?.abort();
      return;
    }
    setCandidates([]);
    setCandidateMatches({});
    setLookupMessage(null);
    setError(null);
    setIsSaving(false);
    setSourceCandidate(null);
    setIsManualSpan(false);
    setEnturError(null);
    setIsEnturSearching(false);
    setEnturProviderRefs(pickEnturFerryProviderRefs(crossing?.providerRefs ?? {}));
    if (crossing) {
      const existingSpan = crossingSpan(crossing);
      setSpan(existingSpan);
      setBoardingHint(crossing.startDistanceMeters);
      setName(crossing.name);
      setDuration(String(crossing.durationMinutes));
      setAssumedWait(String(crossing.assumedWaitMinutes));
      setBoardingBuffer(String(crossing.boardingBufferMinutes));
      setTimetableUrl(crossing.timetableUrl ?? crossing.sourceUrl ?? "");
      setOperator(crossing.operator ?? "");
      if (refreshMetadata) {
        void runLookup(
          crossing.startLatitude,
          crossing.startLongitude,
          crossing.startDistanceMeters,
        );
      } else {
        setStage("confirm");
      }
    } else {
      setSpan(null);
      setBoardingHint(null);
      setName("Ferry crossing");
      setDuration("20");
      setAssumedWait("15");
      setBoardingBuffer("5");
      setTimetableUrl("");
      setOperator("");
      setStage("boarding");
    }
  }, [crossing, refreshMetadata, runLookup, visible]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      enturAbortRef.current?.abort();
    },
    [],
  );

  const clearEnturLink = useCallback(() => {
    enturAbortRef.current?.abort();
    enturAbortRef.current = null;
    setEnturProviderRefs({});
    setEnturError(null);
    setIsEnturSearching(false);
  }, []);

  const handleMapPress = useCallback(
    ({ latitude, longitude }: { latitude: number; longitude: number }) => {
      if (stage !== "boarding" && stage !== "landing") return;
      const match = computePOIRouteAssociation(latitude, longitude, route.points);
      if (match.distanceFromRouteMeters > 1_000) {
        setError("Tap closer to the route line.");
        return;
      }
      const point = interpolateRoutePointAtDistance(route.points, match.distanceAlongRouteMeters);
      if (!point) return;
      setError(null);
      if (stage === "boarding") {
        const nextSpan: MatchedFerrySpan = {
          startDistanceMeters: match.distanceAlongRouteMeters,
          endDistanceMeters: match.distanceAlongRouteMeters,
          startLatitude: point.latitude,
          startLongitude: point.longitude,
          endLatitude: point.latitude,
          endLongitude: point.longitude,
        };
        setSpan(nextSpan);
        setBoardingHint(match.distanceAlongRouteMeters);
        void runLookup(point.latitude, point.longitude, match.distanceAlongRouteMeters);
        return;
      }
      if (!span || match.distanceAlongRouteMeters <= span.startDistanceMeters + 1) {
        setError("Landing must be after boarding on the route.");
        return;
      }
      setSpan({
        ...span,
        endDistanceMeters: match.distanceAlongRouteMeters,
        endLatitude: point.latitude,
        endLongitude: point.longitude,
      });
      setSourceCandidate(null);
      setIsManualSpan(true);
      clearEnturLink();
      setStage("confirm");
    },
    [clearEnturLink, route.points, runLookup, span, stage],
  );

  const chooseCandidate = useCallback(
    (candidate: FerryLookupCandidate) => {
      if (boardingHint == null) return;
      const matched =
        candidateMatches[candidate.id] ??
        matchFerryCandidateToRoute(
          candidate,
          route.points,
          boardingHint,
          1_500,
          routeSpatialIndexRef.current?.points === route.points
            ? routeSpatialIndexRef.current.index
            : null,
        );
      if (!matched) {
        setError("This ferry could not be matched to the route.");
        return;
      }
      setSpan(matched);
      setSourceCandidate(candidate);
      setIsManualSpan(false);
      if (candidate.id !== crossing?.sourceId) clearEnturLink();
      setName(candidate.name);
      if (candidate.durationMinutes != null) setDuration(String(candidate.durationMinutes));
      setTimetableUrl(candidate.timetableUrl ?? candidate.sourceUrl);
      setOperator(candidate.operator ?? "");
      setStage("confirm");
      setError(null);
    },
    [boardingHint, candidateMatches, clearEnturLink, crossing?.sourceId, route.points],
  );

  const chooseManual = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStage("landing");
    setLookupMessage(null);
    setCandidates([]);
    setCandidateMatches({});
    setError(null);
    setIsManualSpan(true);
  }, []);

  const restartBoarding = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setSpan(null);
    setBoardingHint(null);
    setCandidates([]);
    setCandidateMatches({});
    setLookupMessage(null);
    setError(null);
    setIsManualSpan(false);
    clearEnturLink();
    setStage("boarding");
  }, [clearEnturLink]);

  const handleEnturLookup = useCallback(async () => {
    if (!span) return;
    enturAbortRef.current?.abort();
    const controller = new AbortController();
    enturAbortRef.current = controller;
    setIsEnturSearching(true);
    setEnturError(null);
    try {
      const pair = await resolveEnturFerryStopPair(
        { latitude: span.startLatitude, longitude: span.startLongitude },
        { latitude: span.endLatitude, longitude: span.endLongitude },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setEnturProviderRefs(enturProviderRefsForPair(pair));
    } catch (lookupError) {
      if (controller.signal.aborted) return;
      setEnturError(
        lookupError instanceof Error
          ? lookupError.message
          : "Entur ferry stops could not be matched.",
      );
    } finally {
      if (enturAbortRef.current === controller) {
        enturAbortRef.current = null;
        setIsEnturSearching(false);
      }
    }
  }, [span]);

  const handleSave = useCallback(async () => {
    if (!span) return;
    const now = new Date().toISOString();
    const candidate = sourceCandidate;
    const orientedCandidateGeometry =
      candidate == null
        ? null
        : orientFerryGeometry(
            candidate.geometry,
            { latitude: span.startLatitude, longitude: span.startLongitude },
            { latitude: span.endLatitude, longitude: span.endLongitude },
          );
    const encodedCandidateGeometry = orientedCandidateGeometry
      ? encodeOSMFerryGeometry(orientedCandidateGeometry)
      : null;
    const reusableProviderRefs =
      candidate == null
        ? isManualSpan
          ? {}
          : (crossing?.providerRefs ?? {})
        : candidate.id === crossing?.sourceId
          ? (crossing?.providerRefs ?? {})
          : {};
    const reusableProviderRefsWithoutManagedGeometry = Object.fromEntries(
      Object.entries(withoutEnturFerryProviderRefs(reusableProviderRefs)).filter(
        ([key]) => key !== OSM_FERRY_GEOMETRY_PROVIDER_REF,
      ),
    );
    const providerGeometry =
      encodedCandidateGeometry ??
      (!candidate && !isManualSpan
        ? (crossing?.providerRefs[OSM_FERRY_GEOMETRY_PROVIDER_REF] ?? null)
        : null);
    const providerRefs = {
      ...reusableProviderRefsWithoutManagedGeometry,
      ...(providerGeometry ? { [OSM_FERRY_GEOMETRY_PROVIDER_REF]: providerGeometry } : {}),
      ...enturProviderRefs,
    };
    const next: FerryCrossing = {
      id: crossing?.id ?? generateId(),
      routeId: route.id,
      name: name.trim(),
      ...span,
      durationMinutes: numericValue(duration),
      assumedWaitMinutes: numericValue(assumedWait),
      boardingBufferMinutes: numericValue(boardingBuffer),
      source: candidate ? "osm" : isManualSpan ? "manual" : (crossing?.source ?? "manual"),
      sourceId: candidate ? candidate.id : isManualSpan ? null : (crossing?.sourceId ?? null),
      sourceUrl: candidate
        ? candidate.sourceUrl
        : isManualSpan
          ? null
          : (crossing?.sourceUrl ?? null),
      operator: operator.trim() || null,
      timetableUrl: timetableUrl.trim() || null,
      bicycleAccess: candidate
        ? candidate.bicycleAccess
        : isManualSpan
          ? "unknown"
          : (crossing?.bicycleAccess ?? "unknown"),
      providerRefs,
      tags: candidate ? candidate.tags : isManualSpan ? {} : (crossing?.tags ?? {}),
      createdAt: crossing?.createdAt ?? now,
      updatedAt: now,
    };
    const validationError = validateFerryCrossing(next, route.totalDistanceMeters);
    if (validationError) {
      setError(validationError);
      return;
    }
    setIsSaving(true);
    try {
      await saveFerry(next);
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save this ferry.");
    } finally {
      setIsSaving(false);
    }
  }, [
    assumedWait,
    boardingBuffer,
    crossing,
    duration,
    enturProviderRefs,
    isManualSpan,
    name,
    onClose,
    operator,
    route.id,
    route.totalDistanceMeters,
    saveFerry,
    sourceCandidate,
    span,
    timetableUrl,
  ]);

  const instruction =
    stage === "boarding"
      ? "Tap the boarding point on the route"
      : stage === "landing"
        ? "Tap the landing point farther along the route"
        : stage === "lookup"
          ? "Looking for ferries near the boarding point"
          : stage === "candidates"
            ? "Choose a ferry or select the landing manually"
            : "Confirm the excluded ferry span";

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        className="flex-1 bg-background"
      >
        <View className="flex-row items-center justify-between border-b border-border px-4 pb-3 pt-4">
          <View className="flex-1 pr-2">
            <Text className="text-[22px] font-barlow-semibold text-foreground">
              {crossing ? "Edit ferry" : "Add ferry"}
            </Text>
            <Text className="mt-1 text-[14px] font-barlow text-muted-foreground">
              {instruction}
            </Text>
          </View>
          <TouchableOpacity
            className="h-[48px] w-[48px] items-center justify-center"
            onPress={onClose}
            accessibilityLabel="Close ferry editor"
          >
            <X size={22} color={colors.textPrimary} />
          </TouchableOpacity>
        </View>

        <View className={stage === "confirm" ? "h-[38%]" : "flex-1"}>
          <RoutePreviewMap
            layers={layers}
            selectionPoints={selectionPoints}
            onMapPress={stage === "boarding" || stage === "landing" ? handleMapPress : undefined}
            accessibilityLabel="Ferry route selection map"
          />
        </View>

        {stage === "confirm" ? (
          <ScrollView
            className="flex-1 px-4 pt-4"
            contentContainerStyle={{ paddingBottom: 28 }}
            keyboardShouldPersistTaps="handled"
          >
            {span && (
              <View className="mb-4 rounded-xl bg-info/10 px-3 py-2">
                <Text className="text-[15px] font-barlow-semibold text-info">
                  B {formatDistance(span.startDistanceMeters, units)} → L{" "}
                  {formatDistance(span.endDistanceMeters, units)}
                </Text>
                <Text className="mt-0.5 text-[13px] font-barlow-medium text-info">
                  {formatDistance(span.endDistanceMeters - span.startDistanceMeters, units)}{" "}
                  excluded from riding
                </Text>
              </View>
            )}
            <Field label="Ferry name" value={name} onChangeText={setName} />
            <View className="flex-row gap-3">
              <View className="flex-1">
                <Field
                  label="Crossing minutes"
                  value={duration}
                  onChangeText={setDuration}
                  keyboardType="numeric"
                />
              </View>
              <View className="flex-1">
                <Field
                  label="Assumed wait minutes"
                  value={assumedWait}
                  onChangeText={setAssumedWait}
                  keyboardType="numeric"
                />
              </View>
            </View>
            <Field
              label="Boarding buffer minutes"
              value={boardingBuffer}
              onChangeText={setBoardingBuffer}
              keyboardType="numeric"
            />
            <View className="mb-4 rounded-xl border border-border bg-card p-3">
              <Text className="text-[16px] font-barlow-semibold text-foreground">
                Entur departures
              </Text>
              {linkedEnturStops ? (
                <Text className="mt-1 text-[14px] font-barlow-medium text-info">
                  {linkedEnturStops.fromName} → {linkedEnturStops.toName}
                </Text>
              ) : (
                <Text className="mt-1 text-[13px] leading-5 text-muted-foreground">
                  Match the nearest ferry stops to show the next departure at your ETA.
                </Text>
              )}
              {enturError && (
                <Text className="mt-2 text-[13px] leading-5 text-destructive">{enturError}</Text>
              )}
              <View className="mt-3 flex-row items-center gap-3">
                {isEnturSearching && <ActivityIndicator color={colors.accent} />}
                <Button
                  className="flex-1"
                  variant="secondary"
                  label={
                    isEnturSearching
                      ? "Searching Entur…"
                      : linkedEnturStops
                        ? "Refresh Entur link"
                        : "Find Entur timetable"
                  }
                  disabled={isEnturSearching}
                  onPress={handleEnturLookup}
                  accessibilityLabel={
                    linkedEnturStops ? "Refresh Entur ferry stops" : "Find Entur ferry stops"
                  }
                />
              </View>
              <Text className="mt-2 text-[12px] leading-4 text-muted-foreground">
                Requires internet. Manual crossing and wait times remain the offline fallback.
              </Text>
            </View>
            <Field
              label="Operator (optional)"
              value={operator}
              onChangeText={setOperator}
              placeholder="Ferry operator"
            />
            <Field
              label="Timetable URL (optional)"
              value={timetableUrl}
              onChangeText={setTimetableUrl}
              keyboardType="url"
            />
            {error && <Text className="mb-3 text-[14px] text-destructive">{error}</Text>}
            <Button
              label={isSaving ? "Saving…" : "Save ferry"}
              disabled={isSaving}
              onPress={handleSave}
              accessibilityLabel="Save ferry"
            />
          </ScrollView>
        ) : (
          <View className="border-t border-border bg-background px-4 py-4">
            {stage === "lookup" && (
              <View className="items-center gap-3">
                <ActivityIndicator color={colors.accent} />
                <Text className="text-center text-[15px] text-muted-foreground">
                  {lookupMessage}
                </Text>
                <View className="w-full flex-row gap-3">
                  <Button
                    className="flex-1"
                    variant="secondary"
                    label="Cancel lookup"
                    onPress={restartBoarding}
                    accessibilityLabel="Cancel ferry lookup"
                  />
                  <Button
                    className="flex-1"
                    variant="secondary"
                    label="Choose manually"
                    onPress={chooseManual}
                    accessibilityLabel="Choose landing manually"
                  />
                </View>
              </View>
            )}
            {stage === "candidates" && (
              <View className="max-h-[280px]">
                {lookupMessage && (
                  <Text className="mb-3 text-[14px] text-muted-foreground">{lookupMessage}</Text>
                )}
                <ScrollView className="mb-3" keyboardShouldPersistTaps="handled">
                  {candidates.map((candidate) => (
                    <TouchableOpacity
                      key={candidate.id}
                      className="mb-2 min-h-[64px] justify-center rounded-xl border border-border bg-card px-4 py-3"
                      onPress={() => chooseCandidate(candidate)}
                      accessibilityLabel={`Select ferry ${candidate.name}`}
                    >
                      <Text className="text-[16px] font-barlow-semibold text-foreground">
                        {candidate.name}
                      </Text>
                      <Text className="mt-1 text-[13px] text-muted-foreground">
                        {[
                          candidate.durationMinutes == null
                            ? null
                            : `${candidate.durationMinutes} min`,
                          candidate.operator,
                          candidate.bicycleAccess === "unknown"
                            ? "bike access unknown"
                            : `bikes ${candidate.bicycleAccess}`,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
                <Button
                  variant="secondary"
                  label="Choose landing manually"
                  onPress={chooseManual}
                  accessibilityLabel="Choose landing manually"
                />
              </View>
            )}
            {(stage === "boarding" || stage === "landing") && error && (
              <Text className="text-center text-[14px] text-destructive">{error}</Text>
            )}
          </View>
        )}
      </KeyboardAvoidingView>
    </Modal>
  );
}
