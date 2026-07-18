/**
 * Provider-neutral boundary for a later timetable integration. Ferry editing
 * stores only opaque providerRefs; concrete departures belong in a short-lived
 * cache so seasonal schedules are never mistaken for durable route data.
 */
export interface FerryDeparture {
  departureTime: string;
  arrivalTime: string | null;
  serviceName: string | null;
  realtime: boolean;
}

export interface FerryDepartureCacheRecord {
  provider: string;
  directionKey: string;
  queryAfter: string;
  departures: FerryDeparture[];
  fetchedAt: string;
  expiresAt: string;
}

export interface FerryTimetableProvider {
  id: string;
  departures(
    providerRefs: Readonly<Record<string, string>>,
    after: Date,
    signal?: AbortSignal,
  ): Promise<FerryDeparture[]>;
}
