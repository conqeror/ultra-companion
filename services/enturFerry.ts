import { createKeyValueStorage, type KeyValueStorage } from "@/lib/keyValueStorage";
import type { FerryDeparture, FerryTimetableProvider } from "./ferryTimetable";

export const ENTUR_CLIENT_NAME = "conqeror-ultra-companion";
export const ENTUR_GEOCODER_URL = "https://api.entur.io/geocoder/v3/reverse";
export const ENTUR_JOURNEY_PLANNER_URL = "https://api.entur.io/journey-planner/v3/graphql";
export const ENTUR_FROM_STOP_PLACE_PROVIDER_REF = "enturFromStopPlaceId";
export const ENTUR_TO_STOP_PLACE_PROVIDER_REF = "enturToStopPlaceId";
export const ENTUR_FROM_STOP_PLACE_NAME_PROVIDER_REF = "enturFromStopPlaceName";
export const ENTUR_TO_STOP_PLACE_NAME_PROVIDER_REF = "enturToStopPlaceName";

const ENTUR_STOP_SEARCH_RADIUS_KM = 2;
const ENTUR_STOP_SEARCH_LIMIT = 20;
const CHILD_STOP_PENALTY_METERS = 500;
const ENTUR_SCHEDULE_CACHE_VERSION = 1;
const ENTUR_SCHEDULE_QUERY_SECONDS = 36 * 60 * 60;
const ENTUR_SCHEDULE_QUERY_LIMIT = 400;
const ENTUR_SERVICE_TIME_ZONE = "Europe/Oslo";
const PREVIOUS_DEPARTURE_WINDOW_MS = 60 * 60_000;

const ENTUR_PROVIDER_REF_KEYS = new Set([
  ENTUR_FROM_STOP_PLACE_PROVIDER_REF,
  ENTUR_TO_STOP_PLACE_PROVIDER_REF,
  ENTUR_FROM_STOP_PLACE_NAME_PROVIDER_REF,
  ENTUR_TO_STOP_PLACE_NAME_PROVIDER_REF,
]);

const FERRY_DAY_SCHEDULE_QUERY = `
query FerryDaySchedule($from: String!, $startTime: DateTime!) {
  stopPlace(id: $from) {
    estimatedCalls(
      startTime: $startTime
      timeRange: ${ENTUR_SCHEDULE_QUERY_SECONDS}
      numberOfDepartures: ${ENTUR_SCHEDULE_QUERY_LIMIT}
      arrivalDeparture: departures
      filters: [{ select: [{ transportModes: [{ transportMode: water }] }] }]
    ) {
      aimedDepartureTime
      forBoarding
      serviceJourney {
        journeyPattern {
          line {
            name
            publicCode
            transportMode
          }
        }
      }
      serviceJourneyEstimatedCalls {
        next(count: 20) {
          aimedArrivalTime
          quay {
            stopPlace {
              id
            }
          }
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
  firstDepartureNextDay: FerryDeparture | null;
}

export interface EnturFerryDaySchedule {
  serviceDate: string;
  departures: FerryDeparture[];
  firstDepartureNextDay: FerryDeparture | null;
}

interface CachedEnturFerryDaySchedule extends EnturFerryDaySchedule {
  version: number;
  directionKey: string;
  fetchedAt: string;
}

const ENTUR_TERMINAL_SUFFIX = /\s+(?:(?:ferje|ferge)kai|ferry (?:terminal|quay))$/iu;

const dayScheduleCache = new Map<string, CachedEnturFerryDaySchedule>();
const dayScheduleRequests = new Map<string, Promise<CachedEnturFerryDaySchedule>>();
let dayScheduleStorage: KeyValueStorage | null = null;

function getDayScheduleStorage(): KeyValueStorage {
  dayScheduleStorage ??= createKeyValueStorage("entur-ferry-day-schedules-v1");
  return dayScheduleStorage;
}

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

function graphqlErrorMessage(payload: unknown): string | null {
  const errors = record(payload)?.errors;
  if (!Array.isArray(errors) || errors.length === 0) return null;
  const message = nonEmptyString(record(errors[0])?.message);
  return message ? `Entur timetable error: ${message}` : "Entur timetable request failed.";
}

function cacheKey(stops: LinkedEnturFerryStops): string {
  return `${stops.fromId}|${stops.toId}`;
}

function serviceDateFor(date: Date): string | null {
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ENTUR_SERVICE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return year && month && day ? `${year}-${month}-${day}` : null;
}

function addServiceDateDays(serviceDate: string, days: number): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(serviceDate);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  return date.toISOString().slice(0, 10);
}

function serviceDateStart(serviceDate: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(serviceDate);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utcGuess = Date.UTC(year, month - 1, day);
  const zonedParts = new Intl.DateTimeFormat("en-GB", {
    timeZone: ENTUR_SERVICE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(utcGuess));
  const value = (type: Intl.DateTimeFormatPartTypes): number | null => {
    const part = zonedParts.find((candidate) => candidate.type === type)?.value;
    return part == null ? null : Number(part);
  };
  const zonedYear = value("year");
  const zonedMonth = value("month");
  const zonedDay = value("day");
  const zonedHour = value("hour");
  const zonedMinute = value("minute");
  const zonedSecond = value("second");
  if (
    zonedYear == null ||
    zonedMonth == null ||
    zonedDay == null ||
    zonedHour == null ||
    zonedMinute == null ||
    zonedSecond == null
  ) {
    return null;
  }
  const offsetMs =
    Date.UTC(zonedYear, zonedMonth - 1, zonedDay, zonedHour, zonedMinute, zonedSecond) - utcGuess;
  return new Date(utcGuess - offsetMs);
}

function dayScheduleCacheKey(stops: LinkedEnturFerryStops, serviceDate: string): string {
  return `day:${cacheKey(stops)}:${serviceDate}`;
}

function validCachedDeparture(value: unknown): FerryDeparture | null {
  const candidate = record(value);
  const departureTime = nonEmptyString(candidate?.departureTime);
  const rawArrivalTime = candidate?.arrivalTime;
  const arrivalTime = rawArrivalTime == null ? null : nonEmptyString(rawArrivalTime);
  const rawServiceName = candidate?.serviceName;
  const serviceName = rawServiceName == null ? null : nonEmptyString(rawServiceName);
  if (!departureTime || validDateMs(departureTime) == null) return null;
  if (rawArrivalTime != null && !arrivalTime) return null;
  if (arrivalTime && validDateMs(arrivalTime) == null) return null;
  if (rawServiceName != null && !serviceName) return null;
  return { departureTime, arrivalTime, serviceName };
}

function readCachedDaySchedule(
  storageKey: string,
  directionKey: string,
  serviceDate: string,
): CachedEnturFerryDaySchedule | null {
  try {
    const raw = getDayScheduleStorage().getString(storageKey);
    if (!raw) return null;
    const parsed = record(JSON.parse(raw));
    const rawDepartures = parsed?.departures;
    if (
      parsed?.version !== ENTUR_SCHEDULE_CACHE_VERSION ||
      parsed?.directionKey !== directionKey ||
      parsed?.serviceDate !== serviceDate ||
      !Array.isArray(rawDepartures)
    ) {
      return null;
    }
    const departures = rawDepartures.map(validCachedDeparture);
    if (departures.some((departure) => departure == null)) return null;
    const rawFirstNextDay = parsed.firstDepartureNextDay;
    const firstDepartureNextDay =
      rawFirstNextDay == null ? null : validCachedDeparture(rawFirstNextDay);
    if (rawFirstNextDay != null && !firstDepartureNextDay) return null;
    const fetchedAt = nonEmptyString(parsed.fetchedAt);
    if (!fetchedAt || validDateMs(fetchedAt) == null) return null;
    return {
      version: ENTUR_SCHEDULE_CACHE_VERSION,
      directionKey,
      serviceDate,
      departures: departures as FerryDeparture[],
      firstDepartureNextDay,
      fetchedAt,
    };
  } catch {
    return null;
  }
}

function persistDaySchedule(storageKey: string, schedule: CachedEnturFerryDaySchedule): void {
  try {
    getDayScheduleStorage().set(storageKey, JSON.stringify(schedule));
  } catch {}
}

function scheduledDepartureFromCall(
  call: Record<string, unknown>,
  toStopPlaceId: string,
): FerryDeparture | null {
  if (call.forBoarding === false) return null;
  const serviceJourney = record(call.serviceJourney);
  const journeyPattern = record(serviceJourney?.journeyPattern);
  const line = record(journeyPattern?.line);
  if (nonEmptyString(line?.transportMode)?.toLowerCase() !== "water") return null;
  const departureTime = firstDateString(call.aimedDepartureTime);
  if (!departureTime) return null;
  const departureMs = validDateMs(departureTime);
  if (departureMs == null) return null;
  const serviceCalls = record(call.serviceJourneyEstimatedCalls);
  const nextCalls = serviceCalls?.next;
  if (!Array.isArray(nextCalls)) return null;
  const landingCall = nextCalls.find((nextCallValue) => {
    const nextCall = record(nextCallValue);
    const quay = record(nextCall?.quay);
    return nonEmptyString(record(quay?.stopPlace)?.id) === toStopPlaceId;
  });
  if (!landingCall) return null;
  const aimedArrivalTime = firstDateString(record(landingCall)?.aimedArrivalTime);
  const arrivalTime =
    aimedArrivalTime && (validDateMs(aimedArrivalTime) ?? -1) >= departureMs
      ? aimedArrivalTime
      : null;
  return {
    departureTime,
    arrivalTime,
    serviceName: nonEmptyString(line?.name) ?? nonEmptyString(line?.publicCode),
  };
}

function sortAndDedupeDepartures(departures: readonly FerryDeparture[]): FerryDeparture[] {
  const seen = new Set<string>();
  return [...departures]
    .sort(
      (a, b) =>
        (validDateMs(a.departureTime) ?? Number.POSITIVE_INFINITY) -
        (validDateMs(b.departureTime) ?? Number.POSITIVE_INFINITY),
    )
    .filter((departure) => {
      const key = `${departure.departureTime}|${departure.arrivalTime ?? ""}|${departure.serviceName ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function parseEnturFerryDaySchedule(
  payload: unknown,
  toStopPlaceId: string,
  serviceDate: string,
): EnturFerryDaySchedule {
  const stopPlace = record(record(record(payload)?.data)?.stopPlace);
  const calls = stopPlace?.estimatedCalls;
  const nextServiceDate = addServiceDateDays(serviceDate, 1);
  if (!Array.isArray(calls) || !nextServiceDate) {
    return { serviceDate, departures: [], firstDepartureNextDay: null };
  }

  const currentDay: FerryDeparture[] = [];
  const nextDay: FerryDeparture[] = [];
  for (const callValue of calls) {
    const call = record(callValue);
    if (!call) continue;
    const departure = scheduledDepartureFromCall(call, toStopPlaceId);
    if (!departure) continue;
    const departureServiceDate = serviceDateFor(new Date(departure.departureTime));
    if (departureServiceDate === serviceDate) currentDay.push(departure);
    else if (departureServiceDate === nextServiceDate) nextDay.push(departure);
  }
  const departures = sortAndDedupeDepartures(currentDay);
  const nextDayDepartures = sortAndDedupeDepartures(nextDay);
  return {
    serviceDate,
    departures,
    firstDepartureNextDay: nextDayDepartures[0] ?? null,
  };
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

async function requestEnturFerryDaySchedule(
  stops: LinkedEnturFerryStops,
  serviceDate: string,
  signal?: AbortSignal,
): Promise<CachedEnturFerryDaySchedule> {
  throwIfAborted(signal);
  const startTime = serviceDateStart(serviceDate);
  if (!startTime) throw new Error("The ferry service date is invalid.");
  const response = await fetch(ENTUR_JOURNEY_PLANNER_URL, {
    method: "POST",
    headers: enturHeaders(true),
    body: JSON.stringify({
      query: FERRY_DAY_SCHEDULE_QUERY,
      variables: {
        from: stops.fromId,
        startTime: startTime.toISOString(),
      },
    }),
    signal,
  });
  if (!response.ok) throw new Error(`Entur timetable error (${response.status})`);
  const payload: unknown = await response.json();
  const graphqlError = graphqlErrorMessage(payload);
  if (graphqlError) throw new Error(graphqlError);
  return {
    version: ENTUR_SCHEDULE_CACHE_VERSION,
    directionKey: cacheKey(stops),
    ...parseEnturFerryDaySchedule(payload, stops.toId, serviceDate),
    fetchedAt: new Date().toISOString(),
  };
}

export async function fetchEnturFerryDaySchedule(
  providerRefs: Readonly<Record<string, string>>,
  at: Date,
  signal?: AbortSignal,
): Promise<EnturFerryDaySchedule> {
  throwIfAborted(signal);
  const stops = readLinkedEnturFerryStops(providerRefs);
  if (!stops) throw new Error("This ferry is not linked to two Entur stops.");
  const serviceDate = serviceDateFor(at);
  if (!serviceDate) throw new Error("The ferry ETA is invalid.");
  const directionKey = cacheKey(stops);
  const storageKey = dayScheduleCacheKey(stops, serviceDate);
  const memoryCached = dayScheduleCache.get(storageKey);
  if (memoryCached) return memoryCached;
  const persisted = readCachedDaySchedule(storageKey, directionKey, serviceDate);
  if (persisted) {
    dayScheduleCache.set(storageKey, persisted);
    return persisted;
  }

  const existingRequest = dayScheduleRequests.get(storageKey);
  if (existingRequest) {
    const schedule = await existingRequest;
    throwIfAborted(signal);
    return schedule;
  }

  const request = requestEnturFerryDaySchedule(stops, serviceDate, signal);
  dayScheduleRequests.set(storageKey, request);
  try {
    const schedule = await request;
    dayScheduleCache.set(storageKey, schedule);
    if (schedule.departures.length > 0 || schedule.firstDepartureNextDay) {
      persistDaySchedule(storageKey, schedule);
    }
    return schedule;
  } finally {
    if (dayScheduleRequests.get(storageKey) === request) dayScheduleRequests.delete(storageKey);
  }
}

export async function fetchEnturFerryDepartures(
  providerRefs: Readonly<Record<string, string>>,
  after: Date,
  signal?: AbortSignal,
): Promise<FerryDeparture[]> {
  throwIfAborted(signal);
  const schedule = await fetchEnturFerryDaySchedule(providerRefs, after, signal);
  const departures = schedule.firstDepartureNextDay
    ? [...schedule.departures, schedule.firstDepartureNextDay]
    : schedule.departures;
  return departuresAtOrAfter(departures, after);
}

export async function fetchEnturFerryTimetableContext(
  providerRefs: Readonly<Record<string, string>>,
  boardableTime: Date,
  signal?: AbortSignal,
): Promise<EnturFerryTimetableContext> {
  const boardableTimeMs = boardableTime.getTime();
  if (Number.isNaN(boardableTimeMs)) throw new Error("The ferry ETA is invalid.");
  const schedule = await fetchEnturFerryDaySchedule(providerRefs, boardableTime, signal);
  const previousWindowStart = new Date(boardableTimeMs - PREVIOUS_DEPARTURE_WINDOW_MS);
  const previousDeparture = lastMatchingDeparture(schedule.departures, (departure) => {
    const departureMs = validDateMs(departure.departureTime);
    return (
      departureMs != null &&
      departureMs >= previousWindowStart.getTime() &&
      departureMs < boardableTimeMs
    );
  });
  const allForwardDepartures = schedule.firstDepartureNextDay
    ? [...schedule.departures, schedule.firstDepartureNextDay]
    : schedule.departures;
  const nextDepartures = departuresAtOrAfter(allForwardDepartures, boardableTime);
  const lastDepartureOfDay = schedule.departures[schedule.departures.length - 1] ?? null;
  return {
    previousDeparture,
    nextDepartures,
    lastDepartureOfDay,
    firstDepartureNextDay: schedule.firstDepartureNextDay,
  };
}

export function clearEnturDepartureCache(): void {
  dayScheduleCache.clear();
  dayScheduleRequests.clear();
}

export const enturFerryTimetableProvider: FerryTimetableProvider = {
  id: "entur",
  departures: fetchEnturFerryDepartures,
};
