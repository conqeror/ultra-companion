import type {
  FerryDeparture,
  FerryDepartureCacheRecord,
  FerryTimetableProvider,
} from "./ferryTimetable";

export const ENTUR_CLIENT_NAME = "conqeror-ultra-companion";
export const ENTUR_GEOCODER_URL = "https://api.entur.io/geocoder/v3/reverse";
export const ENTUR_JOURNEY_PLANNER_URL = "https://api.entur.io/journey-planner/v3/graphql";
export const ENTUR_FROM_STOP_PLACE_PROVIDER_REF = "enturFromStopPlaceId";
export const ENTUR_TO_STOP_PLACE_PROVIDER_REF = "enturToStopPlaceId";
export const ENTUR_FROM_STOP_PLACE_NAME_PROVIDER_REF = "enturFromStopPlaceName";
export const ENTUR_TO_STOP_PLACE_NAME_PROVIDER_REF = "enturToStopPlaceName";

const ENTUR_STOP_SEARCH_RADIUS_KM = 2;
const ENTUR_STOP_SEARCH_LIMIT = 20;
const ENTUR_DEPARTURE_CACHE_TTL_MS = 5 * 60_000;
const CHILD_STOP_PENALTY_METERS = 500;
const MAX_DEPARTURES = 8;
const MAX_CONTEXT_DEPARTURES = 16;
const PREVIOUS_DEPARTURE_WINDOW_MS = 60 * 60_000;

const ENTUR_PROVIDER_REF_KEYS = new Set([
  ENTUR_FROM_STOP_PLACE_PROVIDER_REF,
  ENTUR_TO_STOP_PLACE_PROVIDER_REF,
  ENTUR_FROM_STOP_PLACE_NAME_PROVIDER_REF,
  ENTUR_TO_STOP_PLACE_NAME_PROVIDER_REF,
]);

const FERRY_TRIPS_QUERY = `
query FerryTrips(
  $from: String!
  $to: String!
  $dateTime: DateTime!
  $arriveBy: Boolean!
  $numTripPatterns: Int!
) {
  trip(
    from: { place: $from }
    to: { place: $to }
    dateTime: $dateTime
    arriveBy: $arriveBy
    numTripPatterns: $numTripPatterns
  ) {
    tripPatterns {
      startTime
      endTime
      legs {
        mode
        line {
          name
          publicCode
        }
        fromEstimatedCall {
          aimedDepartureTime
          expectedDepartureTime
          actualDepartureTime
          realtime
        }
        toEstimatedCall {
          aimedArrivalTime
          expectedArrivalTime
          actualArrivalTime
          realtime
        }
      }
    }
  }
}`;

export type EnturStopPlaceRole = "parent" | "child" | null;

export interface EnturStopPlaceCandidate {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  distanceMeters: number;
  role: EnturStopPlaceRole;
}

export interface EnturFerryStopPair {
  from: EnturStopPlaceCandidate;
  to: EnturStopPlaceCandidate;
}

export interface LinkedEnturFerryStops {
  fromId: string;
  fromName: string;
  toId: string;
  toName: string;
}

export interface EnturFerryTimetableContext {
  previousDeparture: FerryDeparture | null;
  nextDepartures: FerryDeparture[];
  lastDepartureOfDay: FerryDeparture | null;
}

const ENTUR_TERMINAL_SUFFIX = /\s+(?:(?:ferje|ferge)kai|ferry (?:terminal|quay))$/iu;

const departureCache = new Map<string, FerryDepartureCacheRecord>();

function record(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function validDateMs(value: string): number | null {
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

function firstDateString(...values: unknown[]): string | null {
  for (const value of values) {
    const text = nonEmptyString(value);
    if (text && validDateMs(text) != null) return text;
  }
  return null;
}

function abortError(): Error {
  const error = new Error("The Entur request was cancelled.");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function enturHeaders(contentType = false): Record<string, string> {
  return {
    "ET-Client-Name": ENTUR_CLIENT_NAME,
    ...(contentType ? { "Content-Type": "application/json" } : {}),
  };
}

export function buildEnturStopSearchUrl(latitude: number, longitude: number): string {
  const params = new URLSearchParams({
    lat: String(latitude),
    lon: String(longitude),
    radius: String(ENTUR_STOP_SEARCH_RADIUS_KM),
    limit: String(ENTUR_STOP_SEARCH_LIMIT),
    layers: "stopPlace",
    stopPlaceTypes: "harbourPort,ferryPort,ferryStop",
    multimodal: "all",
  });
  return `${ENTUR_GEOCODER_URL}?${params.toString()}`;
}

export function parseEnturStopPlaces(payload: unknown): EnturStopPlaceCandidate[] {
  const features = record(payload)?.features;
  if (!Array.isArray(features)) return [];

  const candidates: EnturStopPlaceCandidate[] = [];
  const seen = new Set<string>();
  for (const featureValue of features) {
    const feature = record(featureValue);
    const properties = record(feature?.properties);
    const geometry = record(feature?.geometry);
    const coordinates = geometry?.coordinates;
    const id = nonEmptyString(properties?.id);
    const names = record(properties?.names);
    const name = nonEmptyString(names?.default) ?? nonEmptyString(names?.display);
    const longitude = Array.isArray(coordinates) ? finiteNumber(coordinates[0]) : null;
    const latitude = Array.isArray(coordinates) ? finiteNumber(coordinates[1]) : null;
    const distanceKm = finiteNumber(properties?.distance);
    const modes = properties?.transportModes;
    const hasWaterMode =
      Array.isArray(modes) &&
      modes.some((mode) => nonEmptyString(record(mode)?.mode)?.toLowerCase() === "water");
    const rawRole = nonEmptyString(properties?.stopPlaceRole);
    const role: EnturStopPlaceRole = rawRole === "parent" || rawRole === "child" ? rawRole : null;

    if (
      !id ||
      !name ||
      latitude == null ||
      longitude == null ||
      distanceKm == null ||
      !hasWaterMode ||
      seen.has(id)
    ) {
      continue;
    }
    seen.add(id);
    candidates.push({
      id,
      name,
      latitude,
      longitude,
      distanceMeters: Math.max(0, distanceKm * 1_000),
      role,
    });
  }

  return candidates.sort(
    (a, b) =>
      a.distanceMeters +
      (a.role === "child" ? CHILD_STOP_PENALTY_METERS : 0) -
      (b.distanceMeters + (b.role === "child" ? CHILD_STOP_PENALTY_METERS : 0)),
  );
}

export async function searchEnturFerryStopsNear(
  latitude: number,
  longitude: number,
  signal?: AbortSignal,
): Promise<EnturStopPlaceCandidate[]> {
  throwIfAborted(signal);
  const response = await fetch(buildEnturStopSearchUrl(latitude, longitude), {
    headers: enturHeaders(),
    signal,
  });
  if (!response.ok) throw new Error(`Entur stop search error (${response.status})`);
  return parseEnturStopPlaces(await response.json());
}

export function selectEnturFerryStopPair(
  fromCandidates: readonly EnturStopPlaceCandidate[],
  toCandidates: readonly EnturStopPlaceCandidate[],
): EnturFerryStopPair | null {
  let best: { pair: EnturFerryStopPair; score: number } | null = null;
  for (const from of fromCandidates) {
    for (const to of toCandidates) {
      if (from.id === to.id) continue;
      const score =
        from.distanceMeters +
        to.distanceMeters +
        (from.role === "child" ? CHILD_STOP_PENALTY_METERS : 0) +
        (to.role === "child" ? CHILD_STOP_PENALTY_METERS : 0);
      if (!best || score < best.score) best = { pair: { from, to }, score };
    }
  }
  return best?.pair ?? null;
}

export async function resolveEnturFerryStopPair(
  start: { latitude: number; longitude: number },
  end: { latitude: number; longitude: number },
  signal?: AbortSignal,
): Promise<EnturFerryStopPair> {
  const [fromCandidates, toCandidates] = await Promise.all([
    searchEnturFerryStopsNear(start.latitude, start.longitude, signal),
    searchEnturFerryStopsNear(end.latitude, end.longitude, signal),
  ]);
  throwIfAborted(signal);
  if (fromCandidates.length === 0) {
    throw new Error("No Entur ferry stop was found near the boarding point.");
  }
  if (toCandidates.length === 0) {
    throw new Error("No Entur ferry stop was found near the landing point.");
  }
  const pair = selectEnturFerryStopPair(fromCandidates, toCandidates);
  if (!pair) throw new Error("Entur returned the same stop for both ferry terminals.");
  return pair;
}

export function enturProviderRefsForPair(pair: EnturFerryStopPair): Record<string, string> {
  return {
    [ENTUR_FROM_STOP_PLACE_PROVIDER_REF]: pair.from.id,
    [ENTUR_TO_STOP_PLACE_PROVIDER_REF]: pair.to.id,
    [ENTUR_FROM_STOP_PLACE_NAME_PROVIDER_REF]: pair.from.name,
    [ENTUR_TO_STOP_PLACE_NAME_PROVIDER_REF]: pair.to.name,
  };
}

export function pickEnturFerryProviderRefs(
  providerRefs: Readonly<Record<string, string>>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(providerRefs).filter(
      ([key, value]) => ENTUR_PROVIDER_REF_KEYS.has(key) && value.trim(),
    ),
  );
}

export function withoutEnturFerryProviderRefs(
  providerRefs: Readonly<Record<string, string>>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(providerRefs).filter(([key]) => !ENTUR_PROVIDER_REF_KEYS.has(key)),
  );
}

export function readLinkedEnturFerryStops(
  providerRefs: Readonly<Record<string, string>>,
): LinkedEnturFerryStops | null {
  const fromId = providerRefs[ENTUR_FROM_STOP_PLACE_PROVIDER_REF]?.trim();
  const toId = providerRefs[ENTUR_TO_STOP_PLACE_PROVIDER_REF]?.trim();
  if (!fromId || !toId || fromId === toId) return null;
  return {
    fromId,
    fromName: providerRefs[ENTUR_FROM_STOP_PLACE_NAME_PROVIDER_REF]?.trim() || fromId,
    toId,
    toName: providerRefs[ENTUR_TO_STOP_PLACE_NAME_PROVIDER_REF]?.trim() || toId,
  };
}

function conciseEnturTerminalName(name: string): string {
  const concise = name.replace(ENTUR_TERMINAL_SUFFIX, "").trim();
  return concise || name.trim();
}

export function directionalEnturFerryName(
  providerRefs: Readonly<Record<string, string>>,
): string | null {
  const stops = readLinkedEnturFerryStops(providerRefs);
  if (!stops) return null;
  return `${conciseEnturTerminalName(stops.fromName)} – ${conciseEnturTerminalName(stops.toName)}`;
}

export function enturDepartureSearchTime(
  quayEta: Date,
  boardingBufferMinutes: number,
): Date | null {
  const quayEtaMs = quayEta.getTime();
  if (Number.isNaN(quayEtaMs)) return null;
  const safeBufferMinutes = Number.isFinite(boardingBufferMinutes)
    ? Math.max(0, boardingBufferMinutes)
    : 0;
  return new Date(quayEtaMs + safeBufferMinutes * 60_000);
}

function parseEnturFerryTripDepartures(payload: unknown): FerryDeparture[] {
  const data = record(record(payload)?.data);
  const trip = record(data?.trip);
  const patterns = trip?.tripPatterns;
  if (!Array.isArray(patterns)) return [];

  const departures: FerryDeparture[] = [];
  const seen = new Set<string>();
  for (const patternValue of patterns) {
    const pattern = record(patternValue);
    const legs = pattern?.legs;
    if (!Array.isArray(legs)) continue;
    for (const legValue of legs) {
      const leg = record(legValue);
      if (nonEmptyString(leg?.mode)?.toLowerCase() !== "water") continue;
      const fromCall = record(leg?.fromEstimatedCall);
      const toCall = record(leg?.toEstimatedCall);
      const departureTime = firstDateString(
        fromCall?.actualDepartureTime,
        fromCall?.expectedDepartureTime,
        fromCall?.aimedDepartureTime,
        pattern?.startTime,
      );
      const arrivalTime = firstDateString(
        toCall?.actualArrivalTime,
        toCall?.expectedArrivalTime,
        toCall?.aimedArrivalTime,
        pattern?.endTime,
      );
      if (!departureTime) continue;
      const departureMs = validDateMs(departureTime);
      if (departureMs == null) continue;
      const safeArrivalTime =
        arrivalTime != null && (validDateMs(arrivalTime) ?? -1) >= departureMs ? arrivalTime : null;
      const line = record(leg?.line);
      const serviceName = nonEmptyString(line?.name) ?? nonEmptyString(line?.publicCode);
      const key = `${departureTime}|${safeArrivalTime ?? ""}|${serviceName ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      departures.push({
        departureTime,
        arrivalTime: safeArrivalTime,
        serviceName,
        realtime:
          fromCall?.realtime === true ||
          toCall?.realtime === true ||
          nonEmptyString(fromCall?.actualDepartureTime) != null ||
          nonEmptyString(toCall?.actualArrivalTime) != null,
      });
    }
  }

  return departures.sort(
    (a, b) =>
      (validDateMs(a.departureTime) ?? Number.POSITIVE_INFINITY) -
      (validDateMs(b.departureTime) ?? Number.POSITIVE_INFINITY),
  );
}

export function parseEnturFerryDepartures(payload: unknown, after: Date): FerryDeparture[] {
  const afterMs = after.getTime();
  if (Number.isNaN(afterMs)) return [];
  return parseEnturFerryTripDepartures(payload)
    .filter((departure) => (validDateMs(departure.departureTime) ?? -1) >= afterMs)
    .slice(0, MAX_DEPARTURES);
}

function graphqlErrorMessage(payload: unknown): string | null {
  const errors = record(payload)?.errors;
  if (!Array.isArray(errors) || errors.length === 0) return null;
  const message = nonEmptyString(record(errors[0])?.message);
  return message ? `Entur timetable error: ${message}` : "Entur timetable request failed.";
}

function cacheKey(stops: LinkedEnturFerryStops): string {
  return `${stops.fromId}|${stops.toId}`;
}

function departuresAtOrAfter(departures: readonly FerryDeparture[], after: Date): FerryDeparture[] {
  const afterMs = after.getTime();
  return departures.filter((departure) => {
    const departureMs = validDateMs(departure.departureTime);
    return departureMs != null && departureMs >= afterMs;
  });
}

function lastMatchingDeparture(
  departures: readonly FerryDeparture[],
  predicate: (departure: FerryDeparture) => boolean,
): FerryDeparture | null {
  for (let index = departures.length - 1; index >= 0; index -= 1) {
    const departure = departures[index];
    if (departure && predicate(departure)) return departure;
  }
  return null;
}

async function requestEnturFerryTripDepartures(
  stops: LinkedEnturFerryStops,
  dateTime: Date,
  arriveBy: boolean,
  numTripPatterns: number,
  signal?: AbortSignal,
): Promise<FerryDeparture[]> {
  throwIfAborted(signal);
  const response = await fetch(ENTUR_JOURNEY_PLANNER_URL, {
    method: "POST",
    headers: enturHeaders(true),
    body: JSON.stringify({
      query: FERRY_TRIPS_QUERY,
      variables: {
        from: stops.fromId,
        to: stops.toId,
        dateTime: dateTime.toISOString(),
        arriveBy,
        numTripPatterns,
      },
    }),
    signal,
  });
  if (!response.ok) throw new Error(`Entur timetable error (${response.status})`);
  const payload: unknown = await response.json();
  const graphqlError = graphqlErrorMessage(payload);
  if (graphqlError) throw new Error(graphqlError);
  return parseEnturFerryTripDepartures(payload);
}

export async function fetchEnturFerryDepartures(
  providerRefs: Readonly<Record<string, string>>,
  after: Date,
  signal?: AbortSignal,
): Promise<FerryDeparture[]> {
  throwIfAborted(signal);
  const stops = readLinkedEnturFerryStops(providerRefs);
  if (!stops) throw new Error("This ferry is not linked to two Entur stops.");
  if (Number.isNaN(after.getTime())) throw new Error("The ferry ETA is invalid.");

  const directionKey = cacheKey(stops);
  const nowMs = Date.now();
  const cached = departureCache.get(directionKey);
  if (
    cached &&
    new Date(cached.expiresAt).getTime() > nowMs &&
    new Date(cached.queryAfter).getTime() <= after.getTime()
  ) {
    const matching = departuresAtOrAfter(cached.departures, after);
    if (matching.length > 0) return matching;
  }

  const departures = departuresAtOrAfter(
    await requestEnturFerryTripDepartures(stops, after, false, MAX_DEPARTURES, signal),
    after,
  ).slice(0, MAX_DEPARTURES);
  const fetchedAt = new Date(nowMs).toISOString();
  if (departures.length > 0) {
    departureCache.set(directionKey, {
      provider: "entur",
      directionKey,
      queryAfter: after.toISOString(),
      departures,
      fetchedAt,
      expiresAt: new Date(nowMs + ENTUR_DEPARTURE_CACHE_TTL_MS).toISOString(),
    });
  }
  return departures;
}

function sameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function lastDepartureArrivalCutoff(boardableTime: Date, crossingDurationMinutes: number): Date {
  const cutoff = new Date(boardableTime);
  cutoff.setHours(24, 0, 0, 0);
  const safeCrossingMinutes = Number.isFinite(crossingDurationMinutes)
    ? Math.max(0, crossingDurationMinutes)
    : 0;
  cutoff.setMinutes(Math.max(60, Math.ceil(safeCrossingMinutes) + 15));
  return cutoff;
}

export async function fetchEnturFerryTimetableContext(
  providerRefs: Readonly<Record<string, string>>,
  boardableTime: Date,
  crossingDurationMinutes: number,
  signal?: AbortSignal,
): Promise<EnturFerryTimetableContext> {
  throwIfAborted(signal);
  const stops = readLinkedEnturFerryStops(providerRefs);
  if (!stops) throw new Error("This ferry is not linked to two Entur stops.");
  const boardableTimeMs = boardableTime.getTime();
  if (Number.isNaN(boardableTimeMs)) throw new Error("The ferry ETA is invalid.");

  const previousWindowStart = new Date(boardableTimeMs - PREVIOUS_DEPARTURE_WINDOW_MS);
  const lastDepartureCutoff = lastDepartureArrivalCutoff(boardableTime, crossingDurationMinutes);
  const [nextResult, previousResult, lastResult] = await Promise.allSettled([
    fetchEnturFerryDepartures(providerRefs, boardableTime, signal),
    requestEnturFerryTripDepartures(
      stops,
      previousWindowStart,
      false,
      MAX_CONTEXT_DEPARTURES,
      signal,
    ),
    requestEnturFerryTripDepartures(
      stops,
      lastDepartureCutoff,
      true,
      MAX_CONTEXT_DEPARTURES,
      signal,
    ),
  ]);
  throwIfAborted(signal);

  const successfulResults = [nextResult, previousResult, lastResult].filter(
    (result) => result.status === "fulfilled",
  );
  if (successfulResults.length === 0) {
    throw nextResult.status === "rejected" ? nextResult.reason : new Error("Entur unavailable.");
  }

  const nextDepartures = nextResult.status === "fulfilled" ? nextResult.value : [];
  const previousCandidates = previousResult.status === "fulfilled" ? previousResult.value : [];
  const previousDeparture = lastMatchingDeparture(previousCandidates, (departure) => {
    const departureMs = validDateMs(departure.departureTime);
    return (
      departureMs != null &&
      departureMs >= previousWindowStart.getTime() &&
      departureMs < boardableTimeMs
    );
  });
  const lastCandidates = lastResult.status === "fulfilled" ? lastResult.value : [];
  const lastDepartureOfDay = lastMatchingDeparture(lastCandidates, (departure) => {
    const departureDate = new Date(departure.departureTime);
    return !Number.isNaN(departureDate.getTime()) && sameLocalDay(departureDate, boardableTime);
  });

  return { previousDeparture, nextDepartures, lastDepartureOfDay };
}

export function clearEnturDepartureCache(): void {
  departureCache.clear();
}

export const enturFerryTimetableProvider: FerryTimetableProvider = {
  id: "entur",
  departures: fetchEnturFerryDepartures,
};
