import { describe, expect, it } from "vitest";
import {
  createWeatherProjectionInput,
  weatherProjectionMatchesRoute,
} from "@/services/weatherProjection";
import { buildRoutePoint } from "@/tests/fixtures/route";

describe("weather projection display ownership", () => {
  it("accepts equivalent route snapshots and rejects another route or changed geometry", () => {
    const points = [buildRoutePoint(0, 0), buildRoutePoint(1000, 1)];
    const { context } = createWeatherProjectionInput("route-a", points, 0, [0, 100]);

    expect(weatherProjectionMatchesRoute(context, "route-a", [...points])).toBe(true);
    expect(weatherProjectionMatchesRoute(context, "route-b", points)).toBe(false);
    expect(
      weatherProjectionMatchesRoute(
        context,
        "route-a",
        points.map((point) => ({ ...point, latitude: point.latitude + 1 })),
      ),
    ).toBe(false);
    expect(weatherProjectionMatchesRoute(null, "route-a", points)).toBe(false);
    expect(weatherProjectionMatchesRoute(context, null, null)).toBe(false);
  });
});
