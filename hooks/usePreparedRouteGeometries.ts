import { useEffect, useRef, useState } from "react";
import { peekRouteMapGeoJSONForKey, prepareRouteMapGeoJSONForKey } from "@/utils/geo";
import type { RoutePointIndexRange } from "@/utils/geo";
import type { RoutePoint } from "@/types";

export interface PreparedRouteGeometryRequest extends RoutePointIndexRange {
  id: string;
  cacheKey: string;
  points: RoutePoint[] | null | undefined;
  toleranceMeters: number;
}

export interface PreparedRouteGeometry {
  id: string;
  cacheKey: string;
  points: RoutePoint[];
  toleranceMeters: number;
  startPointIndex?: number;
  endPointIndex?: number;
  maxPoints?: number;
  geoJSON: GeoJSON.Feature<GeoJSON.LineString>;
  preparationError?: boolean;
}

export type PreparedRouteGeometryMap = Record<string, PreparedRouteGeometry>;

function samePreparedGeometryMap(
  a: PreparedRouteGeometryMap,
  b: PreparedRouteGeometryMap,
): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    const av = a[key];
    const bv = b[key];
    if (
      !bv ||
      av.cacheKey !== bv.cacheKey ||
      av.points !== bv.points ||
      av.toleranceMeters !== bv.toleranceMeters ||
      av.startPointIndex !== bv.startPointIndex ||
      av.endPointIndex !== bv.endPointIndex ||
      av.maxPoints !== bv.maxPoints ||
      av.geoJSON !== bv.geoJSON ||
      av.preparationError !== bv.preparationError
    ) {
      return false;
    }
  }
  return true;
}

export function preparedRouteGeometryHasError(
  prepared: PreparedRouteGeometry | undefined,
  request: PreparedRouteGeometryRequest,
): boolean {
  if (!prepared) return false;
  return (
    preparedRouteGeometryMatchesRequest(prepared, request) && prepared.preparationError === true
  );
}

export function preparedRouteGeometryMatchesRequest(
  prepared: PreparedRouteGeometry | undefined,
  request: PreparedRouteGeometryRequest,
): boolean {
  return (
    prepared != null &&
    prepared.cacheKey === request.cacheKey &&
    prepared.points === request.points &&
    prepared.toleranceMeters === request.toleranceMeters &&
    prepared.startPointIndex === request.startPointIndex &&
    prepared.endPointIndex === request.endPointIndex &&
    prepared.maxPoints === request.maxPoints
  );
}

export function isRouteGeometryRequestRenderable(request: PreparedRouteGeometryRequest): boolean {
  if (!request.points) return false;
  const startPointIndex = Math.max(0, request.startPointIndex ?? 0);
  const endPointIndex = Math.min(
    request.points.length - 1,
    request.endPointIndex ?? request.points.length - 1,
  );
  return endPointIndex - startPointIndex + 1 >= 2;
}

function requestRange(request: PreparedRouteGeometryRequest): RoutePointIndexRange {
  return {
    startPointIndex: request.startPointIndex,
    endPointIndex: request.endPointIndex,
    maxPoints: request.maxPoints,
  };
}

function nextPreparedGeometryState(
  previous: PreparedRouteGeometryMap,
  requests: readonly PreparedRouteGeometryRequest[],
  prepared: PreparedRouteGeometryMap,
): PreparedRouteGeometryMap {
  const next: PreparedRouteGeometryMap = {};

  for (const request of requests) {
    if (!isRouteGeometryRequestRenderable(request)) continue;
    const ready = prepared[request.id];
    if (ready) {
      next[request.id] = ready;
      continue;
    }

    const previousReady = previous[request.id];
    if (
      previousReady &&
      previousReady.cacheKey === request.cacheKey &&
      previousReady.points === request.points &&
      previousReady.startPointIndex === request.startPointIndex &&
      previousReady.endPointIndex === request.endPointIndex &&
      previousReady.maxPoints === request.maxPoints
    ) {
      next[request.id] = previousReady;
    }
  }

  return samePreparedGeometryMap(previous, next) ? previous : next;
}

export function usePreparedRouteGeometries(
  requests: readonly PreparedRouteGeometryRequest[],
): PreparedRouteGeometryMap {
  const [preparedById, setPreparedById] = useState<PreparedRouteGeometryMap>({});
  const preparedByIdRef = useRef(preparedById);
  preparedByIdRef.current = preparedById;
  const generationRef = useRef(0);

  useEffect(() => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const cachedById: PreparedRouteGeometryMap = {};
    const missing: PreparedRouteGeometryRequest[] = [];

    for (const request of requests) {
      if (!isRouteGeometryRequestRenderable(request) || !request.points) continue;
      const cached = peekRouteMapGeoJSONForKey(
        request.cacheKey,
        request.points,
        request.toleranceMeters,
        requestRange(request),
      );
      if (cached) {
        cachedById[request.id] = {
          id: request.id,
          cacheKey: request.cacheKey,
          points: request.points,
          toleranceMeters: request.toleranceMeters,
          startPointIndex: request.startPointIndex,
          endPointIndex: request.endPointIndex,
          maxPoints: request.maxPoints,
          geoJSON: cached,
        };
      } else {
        missing.push(request);
      }
    }

    setPreparedById((previous) => nextPreparedGeometryState(previous, requests, cachedById));

    if (missing.length === 0) {
      return () => {
        cancelled = true;
      };
    }

    let missingIndex = 0;
    const computedById: PreparedRouteGeometryMap = { ...cachedById };
    const prepareNext = () => {
      if (cancelled || generationRef.current !== generation) return;
      const request = missing[missingIndex++];
      if (!request?.points) return;
      let geoJSON: GeoJSON.Feature<GeoJSON.LineString>;
      let preparationError = false;
      try {
        geoJSON = prepareRouteMapGeoJSONForKey(
          request.cacheKey,
          request.points,
          request.toleranceMeters,
          undefined,
          requestRange(request),
        );
      } catch (error) {
        console.warn(`Failed to prepare map geometry for ${request.id}:`, error);
        preparationError = true;
        const previous = preparedByIdRef.current[request.id];
        const previousMatchesSource =
          previous?.cacheKey === request.cacheKey &&
          previous.points === request.points &&
          previous.startPointIndex === request.startPointIndex &&
          previous.endPointIndex === request.endPointIndex &&
          previous.maxPoints === request.maxPoints;
        geoJSON = previousMatchesSource
          ? previous.geoJSON
          : {
              type: "Feature",
              properties: {},
              geometry: { type: "LineString", coordinates: [] },
            };
      }
      computedById[request.id] = {
        id: request.id,
        cacheKey: request.cacheKey,
        points: request.points,
        toleranceMeters: request.toleranceMeters,
        startPointIndex: request.startPointIndex,
        endPointIndex: request.endPointIndex,
        maxPoints: request.maxPoints,
        geoJSON,
        preparationError,
      };

      if (cancelled || generationRef.current !== generation) return;
      if (missingIndex < missing.length) {
        // One segment per task gives React Native a chance to paint progress and
        // handle input between large collection geometry preparations.
        timeout = setTimeout(prepareNext, 0);
      } else {
        // Publish the finished batch once so Mapbox receives one source update
        // instead of retransferring an increasingly large partial collection.
        setPreparedById((previous) => nextPreparedGeometryState(previous, requests, computedById));
      }
    };
    timeout = setTimeout(prepareNext, 0);

    return () => {
      cancelled = true;
      if (timeout != null) clearTimeout(timeout);
    };
  }, [requests]);

  return preparedById;
}
