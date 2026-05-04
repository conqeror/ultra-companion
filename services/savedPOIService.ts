import type { POI, POICategory, RoutePoint } from "@/types";
import {
  buildGooglePlaceTags,
  fetchGooglePlaceDetails,
  inferPOICategoryFromGoogleTypes,
  type GooglePlace,
} from "@/services/googlePlacesClient";
import { computePOIRouteAssociation, haversineDistance } from "@/utils/geo";
import { generateId } from "@/utils/generateId";

export interface SavedPOITarget {
  routeId: string;
  routeName: string;
  points: RoutePoint[];
}

export interface SavedPOIInput {
  name: string | null;
  category: POICategory;
  latitude: number;
  longitude: number;
  notes?: string;
  tags?: Record<string, string>;
  sourceId?: string;
}

export interface ResolvedGoogleMapsLink {
  name: string | null;
  category: POICategory;
  latitude: number | null;
  longitude: number | null;
  tags: Record<string, string>;
  sourceId?: string;
  resolvedUrl: string;
}

interface ParsedGoogleMapsLink {
  url: string;
  placeId: string | null;
  latitude: number | null;
  longitude: number | null;
}

const URL_RE = /https?:\/\/[^\s]+/i;
const PLACE_ID_RE = /(?:place_id|query_place_id)=([^&#]+)/i;
const COORD_RE = /(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/;

function sanitizeSourcePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 96);
}

export function extractFirstUrl(text: string): string | null {
  const match = text.match(URL_RE);
  return match?.[0] ?? null;
}

function parseNumber(value: string | null | undefined): number | null {
  if (!value) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseCoordinatesFromText(text: string): { latitude: number; longitude: number } | null {
  const match = text.match(COORD_RE);
  if (!match) return null;
  const latitude = parseNumber(match[1]);
  const longitude = parseNumber(match[2]);
  if (latitude == null || longitude == null) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude };
}

function parseGoogleMapsLink(rawText: string): ParsedGoogleMapsLink | null {
  const urlText = extractFirstUrl(rawText.trim()) ?? rawText.trim();
  if (!urlText) return null;

  let url: URL;
  try {
    url = new URL(urlText);
  } catch {
    return null;
  }

  const placeId = urlText.match(PLACE_ID_RE)?.[1];
  const atCoords = urlText.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  const bangCoords = urlText.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  const queryCoords =
    parseCoordinatesFromText(url.searchParams.get("query") ?? "") ??
    parseCoordinatesFromText(url.searchParams.get("q") ?? "") ??
    parseCoordinatesFromText(url.searchParams.get("ll") ?? "");
  const genericCoords = parseCoordinatesFromText(urlText);

  const latitude =
    parseNumber(bangCoords?.[1]) ??
    parseNumber(atCoords?.[1]) ??
    queryCoords?.latitude ??
    genericCoords?.latitude ??
    null;
  const longitude =
    parseNumber(bangCoords?.[2]) ??
    parseNumber(atCoords?.[2]) ??
    queryCoords?.longitude ??
    genericCoords?.longitude ??
    null;

  return {
    url: url.toString(),
    placeId: placeId ? decodeURIComponent(placeId) : null,
    latitude,
    longitude,
  };
}

async function expandGoogleMapsUrl(rawText: string): Promise<string> {
  const url = extractFirstUrl(rawText.trim()) ?? rawText.trim();
  if (!url) return rawText;

  try {
    const response = await fetch(url, { method: "GET" });
    return response.url || url;
  } catch {
    return url;
  }
}

function resolvedFromPlace(place: GooglePlace, fallbackUrl: string): ResolvedGoogleMapsLink {
  return {
    name: place.displayName?.text ?? null,
    category: inferPOICategoryFromGoogleTypes(place.types),
    latitude: place.location.latitude,
    longitude: place.location.longitude,
    tags: {
      ...buildGooglePlaceTags(place),
      google_maps_url: place.googleMapsUri ?? fallbackUrl,
    },
    sourceId: `google:${place.id}`,
    resolvedUrl: place.googleMapsUri ?? fallbackUrl,
  };
}

export async function resolveGoogleMapsLink(
  rawText: string,
  apiKey?: string,
): Promise<ResolvedGoogleMapsLink> {
  const expandedUrl = await expandGoogleMapsUrl(rawText);
  const parsed = parseGoogleMapsLink(expandedUrl) ?? parseGoogleMapsLink(rawText);
  if (!parsed) {
    throw new Error("Paste a Google Maps link or coordinates.");
  }

  if (parsed.placeId && apiKey) {
    const place = await fetchGooglePlaceDetails(parsed.placeId, apiKey);
    return resolvedFromPlace(place, parsed.url);
  }

  if (parsed.latitude == null || parsed.longitude == null) {
    throw new Error(
      parsed.placeId
        ? "Google Places API key is not configured. Enter coordinates manually."
        : "Could not resolve this link. Enter coordinates manually.",
    );
  }

  return {
    name: null,
    category: "other",
    latitude: parsed.latitude,
    longitude: parsed.longitude,
    tags: {
      google_maps_url: parsed.url,
      ...(parsed.placeId ? { google_place_id: parsed.placeId } : {}),
    },
    sourceId: parsed.placeId ? `google:${parsed.placeId}` : undefined,
    resolvedUrl: parsed.url,
  };
}

export function findNearestSavedPOITarget(
  latitude: number,
  longitude: number,
  targets: SavedPOITarget[],
): { target: SavedPOITarget; distanceFromRouteMeters: number } | null {
  let best: { target: SavedPOITarget; distanceFromRouteMeters: number } | null = null;

  for (const target of targets) {
    if (target.points.length === 0) continue;
    const assoc = computePOIRouteAssociation(latitude, longitude, target.points);
    const distanceFromRouteMeters =
      Number.isFinite(assoc.distanceFromRouteMeters) && assoc.distanceFromRouteMeters !== Infinity
        ? assoc.distanceFromRouteMeters
        : haversineDistance(
            latitude,
            longitude,
            target.points[0].latitude,
            target.points[0].longitude,
          );
    if (!best || distanceFromRouteMeters < best.distanceFromRouteMeters) {
      best = { target, distanceFromRouteMeters };
    }
  }

  return best;
}

export function buildSavedPOI(input: SavedPOIInput, target: SavedPOITarget): POI {
  const association = computePOIRouteAssociation(input.latitude, input.longitude, target.points);
  const sourceId = input.sourceId ?? `manual:${generateId()}`;
  const tags: Record<string, string> = {
    ...input.tags,
    custom_created_at: new Date().toISOString(),
  };

  const notes = input.notes?.trim();
  if (notes) tags.notes = notes;

  return {
    id: `${target.routeId}_custom_${sanitizeSourcePart(sourceId)}`,
    sourceId,
    source: "custom",
    name: input.name?.trim() || null,
    category: input.category,
    latitude: input.latitude,
    longitude: input.longitude,
    tags,
    distanceFromRouteMeters: association.distanceFromRouteMeters,
    distanceAlongRouteMeters: association.distanceAlongRouteMeters,
    routeId: target.routeId,
  };
}

export function getPOINotes(poi: POI): string {
  return poi.tags?.notes ?? "";
}

export function isGoogleDerivedPOI(poi: POI): boolean {
  return poi.source === "google" || Boolean(poi.tags?.google_place_id || poi.tags?.google_maps_url);
}

export function getGoogleMapsUrlForPOI(poi: POI): string | null {
  if (poi.tags?.google_maps_url) return poi.tags.google_maps_url;
  if (poi.tags?.google_place_id) {
    const query = encodeURIComponent(`${poi.latitude},${poi.longitude}`);
    const placeId = encodeURIComponent(poi.tags.google_place_id);
    return `https://www.google.com/maps/search/?api=1&query=${query}&query_place_id=${placeId}`;
  }
  if (poi.source === "custom") {
    const query = encodeURIComponent(`${poi.latitude},${poi.longitude}`);
    return `https://www.google.com/maps/search/?api=1&query=${query}`;
  }
  return null;
}
