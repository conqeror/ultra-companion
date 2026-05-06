import { describe, expect, it } from "vitest";
import { activeRouteTiming, futureStartMs } from "@/utils/activeRouteTiming";
import type { ActiveRouteData, Collection } from "@/types";

const routeData = {
  id: "route-1",
  type: "route",
} as ActiveRouteData;

const collectionData = {
  id: "collection-1",
  type: "collection",
} as ActiveRouteData;

const collections: Collection[] = [
  {
    id: "collection-1",
    name: "Race",
    isActive: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    plannedStartMs: new Date("2026-01-01T06:00:00.000Z").getTime(),
  },
];

describe("activeRouteTiming", () => {
  it("returns no planned start for standalone routes", () => {
    expect(activeRouteTiming(routeData, collections)).toEqual({
      plannedStartMs: null,
      futureStartMs: null,
    });
  });

  it("resolves collection planned start and future clock base", () => {
    expect(
      activeRouteTiming(
        collectionData,
        collections,
        new Date("2026-01-01T05:00:00.000Z").getTime(),
      ),
    ).toEqual({
      plannedStartMs: new Date("2026-01-01T06:00:00.000Z").getTime(),
      futureStartMs: new Date("2026-01-01T06:00:00.000Z").getTime(),
    });
  });

  it("keeps the planned start for display but drops the future base after start", () => {
    expect(
      activeRouteTiming(
        collectionData,
        collections,
        new Date("2026-01-01T07:00:00.000Z").getTime(),
      ),
    ).toEqual({
      plannedStartMs: new Date("2026-01-01T06:00:00.000Z").getTime(),
      futureStartMs: null,
    });
  });

  it("normalizes non-future starts", () => {
    expect(
      futureStartMs(
        new Date("2026-01-01T06:00:00.000Z").getTime(),
        new Date("2026-01-01T06:00:00.000Z").getTime(),
      ),
    ).toBeNull();
  });
});
