import type { POI, POICategory, RoutePoint } from "@/types";
import {
  buildGooglePlaceTags,
  fetchGooglePlaceDetails,
  fetchGooglePlaceTextSearch,
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

interface ExpandedGoogleMapsUrl {
  url: string;
  body: string | null;
}

const URL_RE = /https?:\/\/[^\s]+/i;
const PLACE_ID_RE = /(?:place_id|query_place_id)=([^&#]+)/i;
const COORD_RE = /(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/;
const MAX_GOOGLE_MAPS_REDIRECTS = 4;
const GOOGLE_MAPS_READ_TIMEOUT_MS = 8_000;
const GOOGLE_MAPS_READ_TIMEOUT_MESSAGE =
  "Could not read this Google Maps link. Enter coordinates manually.";

function sanitizeSourcePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 96);
}

function namespaceCustomSourceId(sourceId: string): string {
  return sourceId.startsWith("custom:") ? sourceId : `custom:${sourceId}`;
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

function buildValidCoordinate(
  latitude: number | null,
  longitude: number | null,
): { latitude: number; longitude: number } | null {
  if (latitude == null || longitude == null) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude };
}

function parseCoordinatesFromText(text: string): { latitude: number; longitude: number } | null {
  const match = text.match(COORD_RE);
  if (!match) return null;
  const latitude = parseNumber(match[1]);
  const longitude = parseNumber(match[2]);
  return buildValidCoordinate(latitude, longitude);
}

function extractPlaceQueryFromSharedText(text: string): string | null {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || URL_RE.test(trimmed)) continue;
    if (/^(google maps|directions|route|share)$/i.test(trimmed)) continue;
    return trimmed;
  }
  return null;
}

function buildGoogleMapsSearchUrl(query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function parseGoogleMapsLinkParam(url: URL): ParsedGoogleMapsLink | null {
  const nestedUrl = url.searchParams.get("link") ?? url.searchParams.get("url");
  return nestedUrl ? parseGoogleMapsLink(nestedUrl) : null;
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

  const nested = parseGoogleMapsLinkParam(url);
  if (nested) return nested;

  const placeId = urlText.match(PLACE_ID_RE)?.[1];
  const atCoords = urlText.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  const bangCoords = urlText.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  const queryCoords =
    parseCoordinatesFromText(url.searchParams.get("query") ?? "") ??
    parseCoordinatesFromText(url.searchParams.get("q") ?? "") ??
    parseCoordinatesFromText(url.searchParams.get("ll") ?? "") ??
    parseCoordinatesFromText(url.searchParams.get("center") ?? "");
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

function parseCoordinatesFromGoogleMapsHtml(html: string): {
  latitude: number;
  longitude: number;
} | null {
  const normalized = normalizeGoogleMapsHtml(html);

  const staticMapCenter = normalized.match(
    /[?&]center=(-?\d+(?:\.\d+)?)(?:%2C|,)(-?\d+(?:\.\d+)?)/i,
  );
  if (staticMapCenter) {
    const latitude = parseNumber(staticMapCenter[1]);
    const longitude = parseNumber(staticMapCenter[2]);
    const coords = buildValidCoordinate(latitude, longitude);
    if (coords) return coords;
  }

  const decoded = safeDecodeURIComponent(normalized);
  const pbCenter = decoded.match(/!2d(-?\d+(?:\.\d+)?)!3d(-?\d+(?:\.\d+)?)/);
  if (pbCenter) {
    const longitude = parseNumber(pbCenter[1]);
    const latitude = parseNumber(pbCenter[2]);
    const coords = buildValidCoordinate(latitude, longitude);
    if (coords) return coords;
  }

  return null;
}

function extractGoogleMapsUrlFromHtml(html: string): string | null {
  const normalized = normalizeGoogleMapsHtml(html);
  const decoded = safeDecodeURIComponent(normalized);
  const candidates = [normalized, decoded];

  for (const candidate of candidates) {
    const matches = candidate.match(
      /https:\/\/(?:(?:www\.)?google\.[^"'<>\s\\]+\/maps|maps\.google\.[^"'<>\s\\]+\/maps)[^"'<>\s\\]*/gi,
    );
    for (const match of matches ?? []) {
      const url = safeDecodeURIComponent(match);
      if (parseGoogleMapsLink(url)) return url;
    }
  }

  return null;
}

function normalizeGoogleMapsHtml(html: string): string {
  return html
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/\\u0026/g, "&")
    .replace(/\\u003d/g, "=")
    .replace(/\\u002f/gi, "/")
    .replace(/\\\//g, "/");
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function resolveRedirectUrl(location: string | null, baseUrl: string): string | null {
  if (!location) return null;
  try {
    return new URL(location, baseUrl).toString();
  } catch {
    return null;
  }
}

function getResponseHeader(response: Response, name: string): string | null {
  return response.headers?.get(name) ?? null;
}

async function withGoogleMapsReadTimeout<T>(task: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      task,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(GOOGLE_MAPS_READ_TIMEOUT_MESSAGE)),
          GOOGLE_MAPS_READ_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function expandGoogleMapsUrl(rawText: string): Promise<ExpandedGoogleMapsUrl> {
  let url = extractFirstUrl(rawText.trim()) ?? rawText.trim();
  if (!url) return { url: rawText, body: null };
  let latest: ExpandedGoogleMapsUrl = { url, body: null };

  for (let i = 0; i < MAX_GOOGLE_MAPS_REDIRECTS; i++) {
    try {
      const response = await withGoogleMapsReadTimeout(fetch(url, { method: "GET" }));
      latest = {
        url: response.url || url,
        body: await withGoogleMapsReadTimeout(response.text()).catch(() => null),
      };

      const redirectUrl = resolveRedirectUrl(getResponseHeader(response, "location"), latest.url);
      if (response.status >= 300 && response.status < 400 && redirectUrl) {
        url = redirectUrl;
        latest = { url, body: null };
        continue;
      }

      if (!latest.body || parseCoordinatesFromGoogleMapsHtml(latest.body)) return latest;

      const htmlUrl = extractGoogleMapsUrlFromHtml(latest.body);
      if (htmlUrl && htmlUrl !== latest.url && htmlUrl !== url) {
        const htmlParsed = parseGoogleMapsLink(htmlUrl);
        if (htmlParsed?.latitude != null && htmlParsed.longitude != null) {
          return { url: htmlUrl, body: latest.body };
        }

        url = htmlUrl;
        latest = { url, body: null };
        continue;
      }

      return latest;
    } catch {
      return latest;
    }
  }

  return latest;
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
  const rawParsed = parseGoogleMapsLink(rawText);
  const shouldExpand =
    !rawParsed ||
    (rawParsed.latitude == null && rawParsed.longitude == null && (!rawParsed.placeId || !apiKey));
  const expanded = shouldExpand ? await expandGoogleMapsUrl(rawText) : null;
  const parsed = (expanded ? parseGoogleMapsLink(expanded.url) : null) ?? rawParsed;
  if (!parsed) {
    throw new Error("Paste a Google Maps link or coordinates.");
  }

  if (parsed.placeId && apiKey) {
    const place = await withGoogleMapsReadTimeout(fetchGooglePlaceDetails(parsed.placeId, apiKey));
    return resolvedFromPlace(place, parsed.url);
  }

  const htmlCoords = expanded?.body ? parseCoordinatesFromGoogleMapsHtml(expanded.body) : null;
  const latitude = parsed.latitude ?? htmlCoords?.latitude ?? null;
  const longitude = parsed.longitude ?? htmlCoords?.longitude ?? null;

  if (latitude == null || longitude == null) {
    const placeQuery = extractPlaceQueryFromSharedText(rawText);
    if (placeQuery && apiKey) {
      const place = await withGoogleMapsReadTimeout(fetchGooglePlaceTextSearch(placeQuery, apiKey));
      if (place) {
        return resolvedFromPlace(place, parsed.url || buildGoogleMapsSearchUrl(placeQuery));
      }
    }

    throw new Error(
      parsed.placeId
        ? "Google Places API key is not configured. Enter coordinates manually."
        : "Could not resolve this link. Enter coordinates manually.",
    );
  }

  return {
    name: null,
    category: "other",
    latitude,
    longitude,
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
  const sourceId = namespaceCustomSourceId(input.sourceId ?? `manual:${generateId()}`);
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
