import { OVERPASS_API_URLS, OVERPASS_USER_AGENT } from "@/constants";
import type { FerryBicycleAccess, RoutePoint } from "@/types";
import {
  computePOIRouteAssociation,
  haversineDistance,
  interpolateRoutePointAtDistance,
  type RouteSegmentSpatialIndex,
} from "@/utils/geo";
import type { OverpassElement } from "./overpassClient";

const LOOKUP_RADIUS_METERS = 2_500;
const LOOKUP_TIMEOUT_MS = 12_000;
const METERS_PER_DEGREE_LAT = 111_320;
const TERMINAL_NAME_MATCH_METERS = 1_000;
const MAX_RELATION_MEMBER_JOIN_GAP_METERS = 250;

export interface FerryLookupCandidate {
  id: string;
  name: string;
  fromName: string | null;
  toName: string | null;
  geometry: Array<{ latitude: number; longitude: number }>;
  durationMinutes: number | null;
  bicycleAccess: FerryBicycleAccess;
  operator: string | null;
  sourceUrl: string;
  timetableUrl: string | null;
  tags: Record<string, string>;
}

export interface MatchedFerrySpan {
  startDistanceMeters: number;
  endDistanceMeters: number;
  startLatitude: number;
  startLongitude: number;
  endLatitude: number;
  endLongitude: number;
}

function coord(value: number): string {
  return value.toFixed(6).replace(/\.?0+$/, "");
}

export function buildFerryLookupQuery(
  latitude: number,
  longitude: number,
  radiusMeters = LOOKUP_RADIUS_METERS,
): string {
  const latPadding = radiusMeters / METERS_PER_DEGREE_LAT;
  const longitudeScale = Math.max(0.1, Math.cos((latitude * Math.PI) / 180));
  const lonPadding = radiusMeters / (METERS_PER_DEGREE_LAT * longitudeScale);
  const bbox = [
    coord(Math.max(-90, latitude - latPadding)),
    coord(Math.max(-180, longitude - lonPadding)),
    coord(Math.min(90, latitude + latPadding)),
    coord(Math.min(180, longitude + lonPadding)),
  ].join(",");

  return `[out:json][timeout:12][bbox:${bbox}];
(
  way["route"="ferry"];
  relation["route"="ferry"];
  node["amenity"="ferry_terminal"];
);
out body geom;`;
}

export function parseFerryDurationMinutes(value: string | undefined): number | null {
  if (!value?.trim()) return null;
  const normalized = value.trim().toLowerCase();
  const clock = normalized.match(/^(\d{1,2}):(\d{2})$/);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
  const hours = normalized.match(/([\d.]+)\s*h/);
  const minutes = normalized.match(/([\d.]+)\s*m/);
  if (hours || minutes) {
    return Math.round(Number(hours?.[1] ?? 0) * 60 + Number(minutes?.[1] ?? 0));
  }
  const numeric = Number(normalized);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
}

function bicycleAccess(tags: Record<string, string>): FerryBicycleAccess {
  if (tags.bicycle === "yes" || tags.bicycle === "designated") return "yes";
  if (tags.bicycle === "no") return "no";
  return "unknown";
}

function ferryGeometry(element: OverpassElement): Array<{ lat: number; lon: number }> {
  if (element.geometry && element.geometry.length >= 2) return element.geometry;
  if (element.type !== "relation") return [];

  const joined: Array<{ lat: number; lon: number }> = [];
  for (const member of element.members ?? []) {
    if (!member.geometry?.length) continue;
    let geometry = member.geometry;
    const tail = joined[joined.length - 1];
    if (tail && geometry.length > 1) {
      const distanceToFirst = haversineDistance(
        tail.lat,
        tail.lon,
        geometry[0].lat,
        geometry[0].lon,
      );
      const last = geometry[geometry.length - 1];
      const distanceToLast = haversineDistance(tail.lat, tail.lon, last.lat, last.lon);
      if (distanceToLast < distanceToFirst) geometry = geometry.toReversed();
      if (Math.min(distanceToFirst, distanceToLast) > MAX_RELATION_MEMBER_JOIN_GAP_METERS) {
        return [];
      }
    }
    const first = geometry[0];
    const duplicateJoin =
      tail != null && haversineDistance(tail.lat, tail.lon, first.lat, first.lon) < 1;
    joined.push(...(duplicateJoin ? geometry.slice(1) : geometry));
  }
  return joined;
}

function nearestTerminalName(
  endpoint: { lat: number; lon: number },
  terminals: Array<{ lat: number; lon: number; name: string }>,
): string | null {
  let nearest: { name: string; distanceMeters: number } | null = null;
  for (const terminal of terminals) {
    const distanceMeters = haversineDistance(
      endpoint.lat,
      endpoint.lon,
      terminal.lat,
      terminal.lon,
    );
    if (distanceMeters > TERMINAL_NAME_MATCH_METERS) continue;
    if (!nearest || distanceMeters < nearest.distanceMeters) {
      nearest = { name: terminal.name, distanceMeters };
    }
  }
  return nearest?.name ?? null;
}

export function parseFerryLookupCandidates(
  elements: readonly OverpassElement[],
): FerryLookupCandidate[] {
  const candidates: FerryLookupCandidate[] = [];
  const seen = new Set<string>();
  const terminals = elements.flatMap((element) => {
    const name = element.tags?.name?.trim();
    if (
      element.type !== "node" ||
      element.tags?.amenity !== "ferry_terminal" ||
      !name ||
      element.lat == null ||
      element.lon == null
    ) {
      return [];
    }
    return [{ lat: element.lat, lon: element.lon, name }];
  });
  for (const element of elements) {
    if (element.type === "node") continue;
    const tags = element.tags ?? {};
    if (tags.route !== "ferry") continue;
    const geometry = ferryGeometry(element);
    if (geometry.length < 2) continue;
    const id = `${element.type}/${element.id}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const fromName = tags.from ?? nearestTerminalName(geometry[0], terminals);
    const toName = tags.to ?? nearestTerminalName(geometry[geometry.length - 1], terminals);
    candidates.push({
      id,
      name:
        tags.name ?? (fromName && toName ? `${fromName} – ${toName}` : null) ?? "Ferry crossing",
      fromName,
      toName,
      geometry: geometry.map((point) => ({
        latitude: point.lat,
        longitude: point.lon,
      })),
      durationMinutes: parseFerryDurationMinutes(tags.duration),
      bicycleAccess: bicycleAccess(tags),
      operator: tags.operator ?? null,
      sourceUrl: `https://www.openstreetmap.org/${id}`,
      timetableUrl: tags.website ?? tags.url ?? null,
      tags,
    });
  }
  return candidates;
}

function abortError(): Error {
  const error = new Error("Ferry lookup cancelled");
  error.name = "AbortError";
  return error;
}

async function requestServer(
  url: string,
  query: string,
  externalSignal?: AbortSignal,
): Promise<OverpassElement[]> {
  if (externalSignal?.aborted) throw abortError();
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  externalSignal?.addEventListener("abort", onAbort, { once: true });
  const timeout = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": OVERPASS_USER_AGENT,
      },
      body: `data=${encodeURIComponent(query)}`,
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Overpass error (${response.status})`);
    const body = (await response.json()) as { elements?: OverpassElement[] };
    return body.elements ?? [];
  } catch (error) {
    if (externalSignal?.aborted) throw abortError();
    throw error;
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", onAbort);
  }
}

export async function lookupFerriesNearPoint(
  latitude: number,
  longitude: number,
  options: { signal?: AbortSignal } = {},
): Promise<FerryLookupCandidate[]> {
  const query = buildFerryLookupQuery(latitude, longitude);
  let lastError: unknown = null;
  for (const server of OVERPASS_API_URLS) {
    if (options.signal?.aborted) throw abortError();
    try {
      return parseFerryLookupCandidates(await requestServer(server, query, options.signal));
    } catch (error) {
      if (options.signal?.aborted) throw error;
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Ferry lookup failed");
}

export function matchFerryCandidateToRoute(
  candidate: FerryLookupCandidate,
  routePoints: RoutePoint[],
  boardingHintDistanceMeters: number,
  maxEndpointDistanceMeters = 1_500,
  spatialIndex?: RouteSegmentSpatialIndex | null,
): MatchedFerrySpan | null {
  if (routePoints.length < 2 || candidate.geometry.length < 2) return null;
  const first = candidate.geometry[0];
  const last = candidate.geometry[candidate.geometry.length - 1];
  const firstMatch = computePOIRouteAssociation(
    first.latitude,
    first.longitude,
    routePoints,
    spatialIndex,
  );
  const lastMatch = computePOIRouteAssociation(
    last.latitude,
    last.longitude,
    routePoints,
    spatialIndex,
  );
  if (
    firstMatch.distanceFromRouteMeters > maxEndpointDistanceMeters ||
    lastMatch.distanceFromRouteMeters > maxEndpointDistanceMeters
  ) {
    return null;
  }

  const firstIsBoarding =
    Math.abs(firstMatch.distanceAlongRouteMeters - boardingHintDistanceMeters) <=
    Math.abs(lastMatch.distanceAlongRouteMeters - boardingHintDistanceMeters);
  const boarding = firstIsBoarding ? firstMatch : lastMatch;
  const landing = firstIsBoarding ? lastMatch : firstMatch;
  if (landing.distanceAlongRouteMeters <= boarding.distanceAlongRouteMeters + 1) return null;
  const startPoint = interpolateRoutePointAtDistance(
    routePoints,
    boarding.distanceAlongRouteMeters,
  );
  const endPoint = interpolateRoutePointAtDistance(routePoints, landing.distanceAlongRouteMeters);
  if (!startPoint || !endPoint) return null;
  return {
    startDistanceMeters: boarding.distanceAlongRouteMeters,
    endDistanceMeters: landing.distanceAlongRouteMeters,
    startLatitude: startPoint.latitude,
    startLongitude: startPoint.longitude,
    endLatitude: endPoint.latitude,
    endLongitude: endPoint.longitude,
  };
}

export function directionalFerryCandidateName(
  candidate: FerryLookupCandidate,
  span: MatchedFerrySpan,
): string {
  const first = candidate.geometry[0];
  const last = candidate.geometry[candidate.geometry.length - 1];
  if (!first || !last) return candidate.name;
  const firstIsBoarding =
    haversineDistance(span.startLatitude, span.startLongitude, first.latitude, first.longitude) <=
    haversineDistance(span.startLatitude, span.startLongitude, last.latitude, last.longitude);
  const fromName = firstIsBoarding ? candidate.fromName : candidate.toName;
  const toName = firstIsBoarding ? candidate.toName : candidate.fromName;
  if (fromName && toName) return `${fromName} – ${toName}`;
  if (!firstIsBoarding) {
    const nameParts = candidate.name.split(/\s+[–—-]\s+/u);
    if (nameParts.length === 2) return `${nameParts[1]} – ${nameParts[0]}`;
  }
  return candidate.name;
}
