import { useEffect, useRef, useState } from "react";
import { peekRouteMapGeoJSONForKey, prepareRouteMapGeoJSONForKey } from "@/utils/geo";
import type { RoutePoint } from "@/types";

export interface PreparedRouteGeometryRequest {
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
  geoJSON: GeoJSON.Feature<GeoJSON.LineString>;
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
      av.geoJSON !== bv.geoJSON
    ) {
      return false;
    }
  }
  return true;
}

function nextPreparedGeometryState(
  previous: PreparedRouteGeometryMap,
  requests: readonly PreparedRouteGeometryRequest[],
  prepared: PreparedRouteGeometryMap,
): PreparedRouteGeometryMap {
  const next: PreparedRouteGeometryMap = {};

  for (const request of requests) {
    if (!request.points || request.points.length < 2) continue;
    const ready = prepared[request.id];
    if (ready) {
      next[request.id] = ready;
      continue;
    }

    const previousReady = previous[request.id];
    if (
      previousReady &&
      previousReady.cacheKey === request.cacheKey &&
      previousReady.points === request.points
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
  const generationRef = useRef(0);

  useEffect(() => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    let cancelled = false;

    const cachedById: PreparedRouteGeometryMap = {};
    const missing: PreparedRouteGeometryRequest[] = [];

    for (const request of requests) {
      if (!request.points || request.points.length < 2) continue;
      const cached = peekRouteMapGeoJSONForKey(
        request.cacheKey,
        request.points,
        request.toleranceMeters,
      );
      if (cached) {
        cachedById[request.id] = {
          id: request.id,
          cacheKey: request.cacheKey,
          points: request.points,
          toleranceMeters: request.toleranceMeters,
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

    const timeout = setTimeout(() => {
      const computedById: PreparedRouteGeometryMap = {};
      for (const request of missing) {
        if (cancelled || generationRef.current !== generation) return;
        if (!request.points || request.points.length < 2) continue;
        computedById[request.id] = {
          id: request.id,
          cacheKey: request.cacheKey,
          points: request.points,
          toleranceMeters: request.toleranceMeters,
          geoJSON: prepareRouteMapGeoJSONForKey(
            request.cacheKey,
            request.points,
            request.toleranceMeters,
          ),
        };
      }

      if (cancelled || generationRef.current !== generation) return;
      setPreparedById((previous) => nextPreparedGeometryState(previous, requests, computedById));
    }, 0);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [requests]);

  return preparedById;
}
