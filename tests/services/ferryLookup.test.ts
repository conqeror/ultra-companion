import { afterEach, describe, expect, it, vi } from "vitest";
import { OVERPASS_API_URLS, OVERPASS_USER_AGENT } from "@/constants";
import {
  buildFerryLookupQuery,
  lookupFerriesNearPoint,
  matchFerryCandidateToRoute,
  parseFerryDurationMinutes,
  parseFerryLookupCandidates,
  type FerryLookupCandidate,
} from "@/services/ferryLookup";
import type { OverpassElement } from "@/services/overpassClient";
import type { RoutePoint } from "@/types";

function candidate(overrides: Partial<FerryLookupCandidate> = {}): FerryLookupCandidate {
  return {
    id: "way/42",
    name: "Test ferry",
    fromName: null,
    toName: null,
    geometry: [
      { latitude: 0, longitude: 0.008 },
      { latitude: 0, longitude: 0.022 },
    ],
    durationMinutes: 20,
    bicycleAccess: "unknown",
    operator: null,
    sourceUrl: "https://www.openstreetmap.org/way/42",
    timetableUrl: null,
    tags: { route: "ferry" },
    ...overrides,
  };
}

function routePoints(): RoutePoint[] {
  return [0, 1_000, 2_000, 3_000].map((distance, idx) => ({
    idx,
    distanceFromStartMeters: distance,
    latitude: 0,
    longitude: distance / 100_000,
    elevationMeters: 100,
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ferry lookup query", () => {
  it("builds a small bbox query for ferry routes and terminals", () => {
    const query = buildFerryLookupQuery(60, 5);
    const bbox = query
      .match(/\[bbox:([^\]]+)\]/)?.[1]
      .split(",")
      .map(Number);

    expect(query).toMatch(/^\[out:json\]\[timeout:12\]\[bbox:/);
    expect(query).toContain('way["route"="ferry"];');
    expect(query).toContain('relation["route"="ferry"];');
    expect(query).toContain('node["amenity"="ferry_terminal"];');
    expect(query).toContain("out body geom;");
    expect(bbox).toHaveLength(4);
    expect(bbox![0]).toBeCloseTo(59.977542, 5);
    expect(bbox![1]).toBeCloseTo(4.955084, 5);
    expect(bbox![2]).toBeCloseTo(60.022458, 5);
    expect(bbox![3]).toBeCloseTo(5.044916, 5);
  });

  it("clamps lookup bounds at valid latitude and longitude limits", () => {
    expect(buildFerryLookupQuery(90, 180, 2_500)).toContain("[bbox:89.977542,179.775422,90,180]");
  });
});

describe("ferry candidate parsing", () => {
  it.each([
    [undefined, null],
    ["", null],
    ["01:30", 90],
    ["1 h 35 min", 95],
    ["1.5h", 90],
    ["45 min", 45],
    ["20", 20],
    ["unknown", null],
    ["-5", null],
  ])("parses OSM duration %s", (value, expected) => {
    expect(parseFerryDurationMinutes(value)).toBe(expected);
  });

  it("extracts ferry metadata, names endpoints, and ignores unusable elements", () => {
    const elements: OverpassElement[] = [
      {
        type: "way",
        id: 42,
        tags: {
          route: "ferry",
          from: "North quay",
          to: "South quay",
          duration: "00:25",
          bicycle: "designated",
          operator: "Island Ferries",
          website: "https://ferry.example/timetable",
        },
        geometry: [
          { lat: 60, lon: 5 },
          { lat: 60.1, lon: 5.1 },
        ],
      },
      {
        type: "relation",
        id: 7,
        tags: { route: "ferry", name: "Named crossing", bicycle: "no", url: "https://r.example" },
        members: [
          {
            type: "way",
            ref: 70,
            geometry: [
              { lat: 61, lon: 6 },
              { lat: 61.05, lon: 6.05 },
            ],
          },
          {
            type: "way",
            ref: 71,
            geometry: [
              { lat: 61.1, lon: 6.1 },
              { lat: 61.05, lon: 6.05 },
            ],
          },
        ],
      },
      {
        type: "node",
        id: 9,
        tags: { amenity: "ferry_terminal", name: "North terminal" },
        lat: 60,
        lon: 5,
      },
      {
        type: "way",
        id: 8,
        tags: { route: "bus" },
        geometry: [
          { lat: 0, lon: 0 },
          { lat: 1, lon: 1 },
        ],
      },
      { type: "way", id: 10, tags: { route: "ferry" }, geometry: [{ lat: 0, lon: 0 }] },
      {
        type: "way",
        id: 42,
        tags: { route: "ferry", name: "Duplicate" },
        geometry: [
          { lat: 1, lon: 1 },
          { lat: 2, lon: 2 },
        ],
      },
    ];

    expect(parseFerryLookupCandidates(elements)).toEqual([
      {
        id: "way/42",
        name: "North quay – South quay",
        fromName: "North quay",
        toName: "South quay",
        geometry: [
          { latitude: 60, longitude: 5 },
          { latitude: 60.1, longitude: 5.1 },
        ],
        durationMinutes: 25,
        bicycleAccess: "yes",
        operator: "Island Ferries",
        sourceUrl: "https://www.openstreetmap.org/way/42",
        timetableUrl: "https://ferry.example/timetable",
        tags: elements[0].tags,
      },
      {
        id: "relation/7",
        name: "Named crossing",
        fromName: null,
        toName: null,
        geometry: [
          { latitude: 61, longitude: 6 },
          { latitude: 61.05, longitude: 6.05 },
          { latitude: 61.1, longitude: 6.1 },
        ],
        durationMinutes: null,
        bicycleAccess: "no",
        operator: null,
        sourceUrl: "https://www.openstreetmap.org/relation/7",
        timetableUrl: "https://r.example",
        tags: elements[1].tags,
      },
    ]);
  });

  it("uses nearby ferry-terminal names when the route has no from/to tags", () => {
    const elements: OverpassElement[] = [
      {
        type: "way",
        id: 1,
        tags: { route: "ferry" },
        geometry: [
          { lat: 60, lon: 5 },
          { lat: 60.1, lon: 5.1 },
        ],
      },
      {
        type: "node",
        id: 2,
        lat: 60,
        lon: 5,
        tags: { amenity: "ferry_terminal", name: "West quay" },
      },
      {
        type: "node",
        id: 3,
        lat: 60.1,
        lon: 5.1,
        tags: { amenity: "ferry_terminal", name: "East quay" },
      },
    ];

    expect(parseFerryLookupCandidates(elements)[0]).toMatchObject({
      name: "West quay – East quay",
      fromName: "West quay",
      toName: "East quay",
    });
  });

  it("rejects relation geometry with disconnected member joins", () => {
    const candidates = parseFerryLookupCandidates([
      {
        type: "relation",
        id: 99,
        tags: { route: "ferry" },
        members: [
          {
            type: "way",
            ref: 1,
            geometry: [
              { lat: 60, lon: 5 },
              { lat: 60.01, lon: 5.01 },
            ],
          },
          {
            type: "way",
            ref: 2,
            geometry: [
              { lat: 61, lon: 6 },
              { lat: 61.01, lon: 6.01 },
            ],
          },
        ],
      },
    ]);

    expect(candidates).toEqual([]);
  });

  it("uses a generic name when OSM has neither a name nor endpoint labels", () => {
    expect(
      parseFerryLookupCandidates([
        {
          type: "way",
          id: 1,
          tags: { route: "ferry" },
          geometry: [
            { lat: 0, lon: 0 },
            { lat: 1, lon: 1 },
          ],
        },
      ])[0].name,
    ).toBe("Ferry crossing");
  });
});

describe("ferry candidate route matching", () => {
  it("snaps candidate endpoints to the route around the boarding hint", () => {
    const match = matchFerryCandidateToRoute(candidate(), routePoints(), 750);

    expect(match?.startDistanceMeters).toBeCloseTo(800);
    expect(match?.endDistanceMeters).toBeCloseTo(2_200);
    expect(match?.startLongitude).toBeCloseTo(0.008);
    expect(match?.endLongitude).toBeCloseTo(0.022);
  });

  it("handles ferry geometry digitized in the opposite direction", () => {
    const match = matchFerryCandidateToRoute(
      candidate({ geometry: candidate().geometry.toReversed() }),
      routePoints(),
      750,
    );

    expect(match?.startDistanceMeters).toBeCloseTo(800);
    expect(match?.endDistanceMeters).toBeCloseTo(2_200);
  });

  it("rejects endpoints too far from the route or without downstream ordering", () => {
    expect(
      matchFerryCandidateToRoute(
        candidate({
          geometry: [
            { latitude: 1, longitude: 1 },
            { latitude: 1.1, longitude: 1.1 },
          ],
        }),
        routePoints(),
        750,
      ),
    ).toBeNull();
    expect(matchFerryCandidateToRoute(candidate(), routePoints(), 2_100)).toBeNull();
    expect(matchFerryCandidateToRoute(candidate(), [routePoints()[0]], 0)).toBeNull();
  });
});

describe("ferry lookup requests", () => {
  it("falls back across Overpass servers and sends the targeted query with a real user agent", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            elements: [
              {
                type: "way",
                id: 42,
                tags: { route: "ferry", name: "Found ferry" },
                geometry: [
                  { lat: 60, lon: 5 },
                  { lat: 60.1, lon: 5.1 },
                ],
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await lookupFerriesNearPoint(60, 5);

    expect(result.map(({ name }) => name)).toEqual(["Found ferry"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(OVERPASS_API_URLS.slice(0, 2));
    const request = fetchMock.mock.calls[0][1];
    expect(request?.method).toBe("POST");
    expect(request?.headers).toEqual({
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": OVERPASS_USER_AGENT,
    });
    expect(request?.body).toContain("data=%5Bout%3Ajson%5D");
    expect(decodeURIComponent(String(request?.body))).toContain('way["route"="ferry"]');
  });

  it("returns the final server error after every mirror fails", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("down", { status: 502 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(lookupFerriesNearPoint(60, 5)).rejects.toThrow("Overpass error (502)");
    expect(fetchMock).toHaveBeenCalledTimes(OVERPASS_API_URLS.length);
  });

  it("honors an already-aborted external signal without making a request", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    controller.abort();

    const lookup = lookupFerriesNearPoint(60, 5, { signal: controller.signal });

    await expect(lookup).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
