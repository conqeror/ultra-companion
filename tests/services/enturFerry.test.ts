import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ENTUR_CLIENT_NAME,
  ENTUR_FROM_STOP_PLACE_NAME_PROVIDER_REF,
  ENTUR_FROM_STOP_PLACE_PROVIDER_REF,
  ENTUR_GEOCODER_URL,
  ENTUR_JOURNEY_PLANNER_URL,
  ENTUR_TO_STOP_PLACE_NAME_PROVIDER_REF,
  ENTUR_TO_STOP_PLACE_PROVIDER_REF,
  buildEnturStopSearchUrl,
  clearEnturDepartureCache,
  enturDepartureSearchTime,
  enturProviderRefsForPair,
  fetchEnturFerryDepartures,
  parseEnturFerryDepartures,
  parseEnturStopPlaces,
  readLinkedEnturFerryStops,
  resolveEnturFerryStopPair,
  searchEnturFerryStopsNear,
  selectEnturFerryStopPair,
  withoutEnturFerryProviderRefs,
  type EnturStopPlaceCandidate,
} from "@/services/enturFerry";

function stopFeature({
  id,
  name,
  distanceKm,
  role = "parent",
  mode = "water",
  latitude = 59.4,
  longitude = 10.4,
}: {
  id: string;
  name: string;
  distanceKm: number;
  role?: "parent" | "child";
  mode?: string;
  latitude?: number;
  longitude?: number;
}) {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [longitude, latitude] },
    properties: {
      id,
      names: { default: name, display: `${name}, Norway` },
      layer: "stopPlace",
      transportModes: [{ mode }],
      stopPlaceRole: role,
      distance: distanceKm,
    },
  };
}

function stop(
  id: string,
  distanceMeters: number,
  role: EnturStopPlaceCandidate["role"] = "parent",
): EnturStopPlaceCandidate {
  return {
    id,
    name: id,
    latitude: 59.4,
    longitude: 10.4,
    distanceMeters,
    role,
  };
}

function tripPayload(departureTime = "2026-07-18T14:20:00Z") {
  return {
    data: {
      trip: {
        tripPatterns: [
          {
            startTime: departureTime,
            endTime: "2026-07-18T14:55:00Z",
            legs: [
              {
                mode: "water",
                line: { name: "Rv. 19 Moss-Horten", publicCode: "1000" },
                fromEstimatedCall: {
                  aimedDepartureTime: departureTime,
                  expectedDepartureTime: departureTime,
                  actualDepartureTime: null,
                  realtime: true,
                },
                toEstimatedCall: {
                  aimedArrivalTime: "2026-07-18T14:55:00Z",
                  expectedArrivalTime: "2026-07-18T14:55:00Z",
                  actualArrivalTime: null,
                  realtime: true,
                },
              },
            ],
          },
        ],
      },
    },
  };
}

const providerRefs = {
  [ENTUR_FROM_STOP_PLACE_PROVIDER_REF]: "NSR:StopPlace:58374",
  [ENTUR_TO_STOP_PLACE_PROVIDER_REF]: "NSR:StopPlace:58092",
  [ENTUR_FROM_STOP_PLACE_NAME_PROVIDER_REF]: "Horten ferjekai",
  [ENTUR_TO_STOP_PLACE_NAME_PROVIDER_REF]: "Moss ferjekai",
};

afterEach(() => {
  clearEnturDepartureCache();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Entur ferry stop matching", () => {
  it("parses water stop places, converts distance to metres, and prefers a nearby parent", () => {
    const candidates = parseEnturStopPlaces({
      features: [
        stopFeature({
          id: "NSR:StopPlace:child",
          name: "Horten ferjekai",
          distanceKm: 0.1,
          role: "child",
        }),
        stopFeature({
          id: "NSR:StopPlace:parent",
          name: "Horten ferjekai",
          distanceKm: 0.4,
        }),
        stopFeature({
          id: "NSR:StopPlace:bus",
          name: "Bus only",
          distanceKm: 0.05,
          mode: "bus",
        }),
      ],
    });

    expect(candidates.map(({ id }) => id)).toEqual(["NSR:StopPlace:parent", "NSR:StopPlace:child"]);
    expect(candidates[0]).toMatchObject({
      name: "Horten ferjekai",
      distanceMeters: 400,
      role: "parent",
    });
  });

  it("selects the lowest-scoring directional pair and never links a stop to itself", () => {
    expect(
      selectEnturFerryStopPair(
        [stop("same", 20), stop("from", 500)],
        [stop("same", 15), stop("to", 110)],
      ),
    ).toMatchObject({ from: { id: "same" }, to: { id: "to" } });
    expect(selectEnturFerryStopPair([stop("same", 20)], [stop("same", 15)])).toBeNull();
  });

  it("uses Geocoder v3 ferry filters and the required Entur client header", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          features: [
            stopFeature({
              id: "NSR:StopPlace:58374",
              name: "Horten ferjekai",
              distanceKm: 0.298,
            }),
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await searchEnturFerryStopsNear(59.4138, 10.4838);

    expect(result).toHaveLength(1);
    const requestUrl = new URL(String(fetchMock.mock.calls[0][0]));
    expect(`${requestUrl.origin}${requestUrl.pathname}`).toBe(ENTUR_GEOCODER_URL);
    expect(requestUrl.searchParams.get("layers")).toBe("stopPlace");
    expect(requestUrl.searchParams.get("stopPlaceTypes")).toBe("harbourPort,ferryPort,ferryStop");
    expect(requestUrl.searchParams.get("multimodal")).toBe("all");
    expect(fetchMock.mock.calls[0][1]?.headers).toEqual({
      "ET-Client-Name": ENTUR_CLIENT_NAME,
    });
  });

  it("resolves the boarding and landing searches as an ordered pair", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const isBoarding = new URL(String(input)).searchParams.get("lat") === "59.4";
      return new Response(
        JSON.stringify({
          features: [
            stopFeature({
              id: isBoarding ? "from" : "to",
              name: isBoarding ? "Boarding" : "Landing",
              distanceKm: 0.1,
            }),
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const pair = await resolveEnturFerryStopPair(
      { latitude: 59.4, longitude: 10.4 },
      { latitude: 59.5, longitude: 10.5 },
    );

    expect(pair).toMatchObject({ from: { id: "from" }, to: { id: "to" } });
    expect(enturProviderRefsForPair(pair)).toEqual({
      [ENTUR_FROM_STOP_PLACE_PROVIDER_REF]: "from",
      [ENTUR_TO_STOP_PLACE_PROVIDER_REF]: "to",
      [ENTUR_FROM_STOP_PLACE_NAME_PROVIDER_REF]: "Boarding",
      [ENTUR_TO_STOP_PLACE_NAME_PROVIDER_REF]: "Landing",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects an already-aborted search without making a request", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    controller.abort();

    await expect(searchEnturFerryStopsNear(59.4, 10.4, controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reads and removes only Entur provider references", () => {
    expect(readLinkedEnturFerryStops({ ...providerRefs, osmGeometryV1: "geometry" })).toEqual({
      fromId: "NSR:StopPlace:58374",
      fromName: "Horten ferjekai",
      toId: "NSR:StopPlace:58092",
      toName: "Moss ferjekai",
    });
    expect(withoutEnturFerryProviderRefs({ ...providerRefs, osmGeometryV1: "geometry" })).toEqual({
      osmGeometryV1: "geometry",
    });
  });
});

describe("Entur concrete departures", () => {
  it("searches from quay ETA plus the saved boarding buffer", () => {
    expect(enturDepartureSearchTime(new Date("2026-07-18T14:00:00Z"), 5)?.toISOString()).toBe(
      "2026-07-18T14:05:00.000Z",
    );
    expect(enturDepartureSearchTime(new Date("invalid"), 5)).toBeNull();
  });

  it("keeps only future water legs, prefers actual times, sorts, and deduplicates", () => {
    const payload = {
      data: {
        trip: {
          tripPatterns: [
            {
              startTime: "2026-07-18T14:20:00Z",
              endTime: "2026-07-18T14:55:00Z",
              legs: [
                { mode: "foot" },
                {
                  mode: "water",
                  line: { name: "Ferry 1" },
                  fromEstimatedCall: {
                    aimedDepartureTime: "2026-07-18T14:20:00Z",
                    expectedDepartureTime: "2026-07-18T14:22:00Z",
                    actualDepartureTime: "2026-07-18T14:23:00Z",
                    realtime: true,
                  },
                  toEstimatedCall: {
                    expectedArrivalTime: "2026-07-18T14:58:00Z",
                    realtime: true,
                  },
                },
              ],
            },
            {
              startTime: "2026-07-18T14:10:00Z",
              endTime: "2026-07-18T14:45:00Z",
              legs: [
                {
                  mode: "water",
                  line: { name: "Too early" },
                  fromEstimatedCall: { aimedDepartureTime: "2026-07-18T14:10:00Z" },
                  toEstimatedCall: { aimedArrivalTime: "2026-07-18T14:45:00Z" },
                },
              ],
            },
            {
              startTime: "2026-07-18T14:20:00Z",
              endTime: "2026-07-18T14:55:00Z",
              legs: [
                {
                  mode: "water",
                  line: { name: "Ferry 1" },
                  fromEstimatedCall: {
                    actualDepartureTime: "2026-07-18T14:23:00Z",
                    realtime: true,
                  },
                  toEstimatedCall: {
                    expectedArrivalTime: "2026-07-18T14:58:00Z",
                    realtime: true,
                  },
                },
              ],
            },
          ],
        },
      },
    };

    expect(parseEnturFerryDepartures(payload, new Date("2026-07-18T14:15:00Z"))).toEqual([
      {
        departureTime: "2026-07-18T14:23:00Z",
        arrivalTime: "2026-07-18T14:58:00Z",
        serviceName: "Ferry 1",
        realtime: true,
      },
    ]);
  });

  it("posts a directional trip query and safely reuses its short-lived concrete result", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () =>
      Promise.resolve(
        new Response(JSON.stringify(tripPayload()), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const first = await fetchEnturFerryDepartures(providerRefs, new Date("2026-07-18T14:00:00Z"));
    const cached = await fetchEnturFerryDepartures(providerRefs, new Date("2026-07-18T14:05:00Z"));
    await fetchEnturFerryDepartures(providerRefs, new Date("2026-07-18T13:55:00Z"));

    expect(first[0]).toMatchObject({
      departureTime: "2026-07-18T14:20:00Z",
      arrivalTime: "2026-07-18T14:55:00Z",
      realtime: true,
    });
    expect(cached).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe(ENTUR_JOURNEY_PLANNER_URL);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: "POST",
      headers: {
        "ET-Client-Name": ENTUR_CLIENT_NAME,
        "Content-Type": "application/json",
      },
    });
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.query).toContain("query FerryTrips");
    expect(body.variables).toEqual({
      from: "NSR:StopPlace:58374",
      to: "NSR:StopPlace:58092",
      dateTime: "2026-07-18T14:00:00.000Z",
    });
  });

  it("surfaces HTTP and GraphQL failures without replacing the manual fallback", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("down", { status: 503 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ errors: [{ message: "No trip patterns" }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchEnturFerryDepartures(providerRefs, new Date("2026-07-18T14:00:00Z")),
    ).rejects.toThrow("Entur timetable error (503)");
    await expect(
      fetchEnturFerryDepartures(providerRefs, new Date("2026-07-18T14:00:00Z")),
    ).rejects.toThrow("Entur timetable error: No trip patterns");
  });

  it("requires two directional stop references before calling Entur", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchEnturFerryDepartures(
        { [ENTUR_FROM_STOP_PLACE_PROVIDER_REF]: "from" },
        new Date("2026-07-18T14:00:00Z"),
      ),
    ).rejects.toThrow("not linked to two Entur stops");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("Entur URL construction", () => {
  it("retains precise terminal coordinates", () => {
    const url = new URL(buildEnturStopSearchUrl(59.4138, 10.4838));
    expect(url.searchParams.get("lat")).toBe("59.4138");
    expect(url.searchParams.get("lon")).toBe("10.4838");
  });
});
