/** Provider-neutral scheduled ferry departure. */
export interface FerryDeparture {
  departureTime: string;
  arrivalTime: string | null;
  serviceName: string | null;
}

export interface FerryTimetableProvider {
  id: string;
  departures(
    providerRefs: Readonly<Record<string, string>>,
    after: Date,
    signal?: AbortSignal,
  ): Promise<FerryDeparture[]>;
}
