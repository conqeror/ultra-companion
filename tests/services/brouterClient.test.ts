import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchBRouterRoute, parseBRouterRoute } from "@/services/brouterClient";

const waypoints = [
  { longitude: 17.1, latitude: 48.1 },
  { longitude: 17.2, latitude: 48.2 },
];
function response(
  coordinates: unknown = [
    [17.1, 48.1, 100],
    [17.2, 48.2, 200],
  ],
) {
  return {
    type: "FeatureCollection",
    features: [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates } }],
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("BRouter", () => {
  const customProfile = {
    id: "local-id",
    name: "Quiet roads",
    content: "---context:way\nassign costfactor = 1",
  };

  it("uploads the exact selected source and routes with the returned temporary ID", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ profileid: "custom_123" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => response() });
    vi.stubGlobal("fetch", fetch);
    await fetchBRouterRoute(waypoints, undefined, customProfile);
    expect(fetch.mock.calls[0]).toEqual([
      "https://brouter.de/brouter/profile",
      expect.objectContaining({
        method: "POST",
        body: customProfile.content,
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
      }),
    ]);
    expect(new URL(fetch.mock.calls[1][0]).searchParams.get("profile")).toBe("custom_123");
  });

  it("surfaces profile syntax errors even when the upload returns HTTP 200", async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ profileid: "custom_123", error: "Profile error: invalid expression" }),
    });
    vi.stubGlobal("fetch", fetch);
    await expect(fetchBRouterRoute(waypoints, undefined, customProfile)).rejects.toThrow(
      "invalid expression",
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([{ profileid: "../bad" }, {}, { error: "Invalid profile" }])(
    "rejects unusable upload responses without routing (%j)",
    async (json) => {
      const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => json });
      vi.stubGlobal("fetch", fetch);
      await expect(fetchBRouterRoute(waypoints, undefined, customProfile)).rejects.toThrow();
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it("never starts routing after cancellation during a profile upload", async () => {
    const controller = new AbortController();
    const fetch = vi.fn().mockImplementation(async () => {
      controller.abort();
      return { ok: true, json: async () => ({ profileid: "custom_123" }) };
    });
    vi.stubGlobal("fetch", fetch);
    await expect(fetchBRouterRoute(waypoints, controller.signal, customProfile)).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("uploads fresh source on later calculations instead of reusing expiring IDs", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ profileid: "custom_123" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => response() })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ profileid: "custom_456" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => response() });
    vi.stubGlobal("fetch", fetch);
    await fetchBRouterRoute(waypoints, undefined, customProfile);
    await fetchBRouterRoute(waypoints, undefined, { ...customProfile, content: "edited source" });
    expect(fetch.mock.calls[2][1].body).toBe("edited source");
    expect(new URL(fetch.mock.calls[3][0]).searchParams.get("profile")).toBe("custom_456");
  });

  it("converts longitude-first coordinates and elevation into an ordinary cumulative route", () => {
    const parsed = parseBRouterRoute(response());
    expect(parsed.points[0]).toMatchObject({
      latitude: 48.1,
      longitude: 17.1,
      elevationMeters: 100,
      idx: 0,
      distanceFromStartMeters: 0,
    });
    expect(parsed.points[1].distanceFromStartMeters).toBeGreaterThan(10_000);
    expect(parsed.totalDistanceMeters).toBe(parsed.points[1].distanceFromStartMeters);
    expect(parsed.totalAscentMeters).toBeGreaterThan(0);
  });

  it.each(
    [
      [],
      [[17, 48]],
      [
        [17, 48],
        [17, 48],
      ],
      [
        ["17", 48],
        [18, 49],
      ],
      [
        [181, 48],
        [18, 49],
      ],
      [
        [17, 91],
        [18, 49],
      ],
      [
        [17, 48, Infinity],
        [18, 49, 5],
      ],
    ].map((coordinates) => ({ coordinates })),
  )("rejects malformed or degenerate coordinates ($coordinates)", ({ coordinates }) => {
    expect(() => parseBRouterRoute(response(coordinates))).toThrow();
  });

  it("accepts missing elevation without inventing elevation values", () => {
    const parsed = parseBRouterRoute(
      response([
        [17, 48],
        [18, 49, null],
      ]),
    );
    expect(parsed.points.every((point) => point.elevationMeters === null)).toBe(true);
  });

  it("rejects missing geometry and multiple disjoint tracks", () => {
    expect(() => parseBRouterRoute({ type: "FeatureCollection", features: [] })).toThrow();
    const data = response();
    data.features.push(data.features[0]);
    expect(() => parseBRouterRoute(data)).toThrow();
  });

  it("requests the road profile with waypoints in their selected order", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => response() });
    vi.stubGlobal("fetch", fetch);
    await fetchBRouterRoute(waypoints);
    const url = new URL(fetch.mock.calls[0][0]);
    expect(url.protocol).toBe("https:");
    expect(url.searchParams.get("profile")).toBe("fastbike");
    expect(url.searchParams.get("lonlats")).toBe("17.1,48.1|17.2,48.2");
  });

  it("does not call the provider for invalid input", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(fetchBRouterRoute([waypoints[0]])).rejects.toThrow("at least two");
    await expect(
      fetchBRouterRoute([waypoints[0], { latitude: NaN, longitude: 17 }]),
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    [400, "No cycling route"],
    [429, "busy or unavailable"],
    [503, "busy or unavailable"],
  ])("explains HTTP %i failures", async (status, message) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status }));
    await expect(fetchBRouterRoute(waypoints)).rejects.toThrow(message);
  });

  it("explains network and malformed-response failures", async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Network request failed"))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => {
          throw new SyntaxError();
        },
      });
    vi.stubGlobal("fetch", fetch);
    await expect(fetchBRouterRoute(waypoints)).rejects.toThrow("internet connection");
    await expect(fetchBRouterRoute(waypoints)).rejects.toThrow("unreadable route");
  });

  it("aborts timed-out requests and explains how to recover", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url, { signal }) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(new Error("aborted")));
          }),
      ),
    );
    const result = expect(fetchBRouterRoute(waypoints)).rejects.toThrow("took too long");
    await vi.advanceTimersByTimeAsync(60_000);
    await result;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("propagates caller cancellation to the network request", async () => {
    const controller = new AbortController();
    let requestSignal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url, { signal }) => {
        requestSignal = signal;
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")));
        });
      }),
    );
    const result = expect(fetchBRouterRoute(waypoints, controller.signal)).rejects.toThrow(
      "aborted",
    );
    controller.abort();
    await result;
    expect(requestSignal?.aborted).toBe(true);
  });
});
