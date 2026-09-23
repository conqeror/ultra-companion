import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildPoi } from "@/tests/fixtures/poi";
import { createSQLiteHarness } from "@/tests/helpers/sqliteHarness";
import type { Route } from "@/types";

const sqliteMocks = vi.hoisted(() => ({
  openDatabaseSync: vi.fn(),
  openDatabaseAsync: vi.fn(),
  deleteDatabaseAsync: vi.fn(),
}));
vi.mock("expo-sqlite", () => sqliteMocks);
vi.mock("drizzle-orm/expo-sqlite", () => import("drizzle-orm/expo-sqlite/driver"));

type POIDatabase = Pick<
  typeof import("@/db/database"),
  | "insertRoute"
  | "insertPOIs"
  | "replacePOIsBySource"
  | "getPOIsForRoute"
  | "setStarredItem"
  | "getStarredItems"
  | "deletePOIsBySource"
  | "updatePOITags"
>;

function route(id: string): Route {
  return {
    id,
    name: id,
    fileName: `${id}.gpx`,
    color: "#000000",
    isActive: false,
    isVisible: true,
    totalDistanceMeters: 1000,
    totalAscentMeters: 0,
    totalDescentMeters: 0,
    pointCount: 0,
    createdAt: "2026-07-20T00:00:00Z",
  };
}

describe.each(["native", "web"] as const)("%s POI source replacement", (platform) => {
  let harness: ReturnType<typeof createSQLiteHarness>;
  let database: POIDatabase;

  beforeEach(async () => {
    vi.resetModules();
    harness = createSQLiteHarness();
    sqliteMocks.openDatabaseSync.mockReturnValue(harness.sqlite);
    sqliteMocks.openDatabaseAsync.mockResolvedValue(harness.sqlite);
    database = await vi.importActual<POIDatabase>(
      platform === "native" ? "@/db/database" : "@/db/database.web",
    );
    await database.insertRoute(route("route-1"), []);
    await database.insertRoute(route("route-2"), []);
  });

  afterEach(() => harness?.close());

  it.each(["osm", "google"] as const)(
    "retains rider tags and stars while replacing only %s provider data",
    async (source) => {
      const original = buildPoi("saved-id", "route-1", 100, {
        source,
        sourceId: "provider-1",
        tags: {
          notes: "Refill and eat",
          planned_stop_duration_minutes: "60",
          opening_hours: "old hours",
          removed_provider_tag: "outdated",
        },
      });
      const omitted = buildPoi("omitted", "route-1", 200, { source });
      const otherSource = buildPoi("other-source", "route-1", 300, {
        source: source === "osm" ? "google" : "osm",
      });
      const custom = buildPoi("custom", "route-1", 400, { source: "custom" });
      const otherRoute = buildPoi("other-route", "route-2", 500, { source });
      await database.insertPOIs([original, omitted, otherSource, custom, otherRoute]);
      await database.setStarredItem("poi", original.id, true);
      await database.setStarredItem("poi", omitted.id, true);
      const stars = await database.getStarredItems("poi");

      const incoming = buildPoi("new-derived-id", "route-1", 125, {
        source,
        sourceId: original.sourceId,
        name: "Updated provider name",
        tags: { opening_hours: "new hours", phone: "+123" },
      });
      await database.replacePOIsBySource("route-1", source, [incoming]);

      expect(await database.getPOIsForRoute("route-1")).toEqual([
        {
          ...incoming,
          id: original.id,
          tags: {
            opening_hours: "new hours",
            phone: "+123",
            notes: "Refill and eat",
            planned_stop_duration_minutes: "60",
          },
        },
        otherSource,
        custom,
      ]);
      expect(await database.getPOIsForRoute("route-2")).toEqual([otherRoute]);
      // Keep stars for temporarily absent provider results, as before refresh.
      expect(await database.getStarredItems("poi")).toEqual(stars);
    },
  );

  it("rolls back deletions and earlier insert batches when replacement fails", async () => {
    const original = buildPoi("original", "route-1", 100, {
      tags: { notes: "Keep me", planned_stop_duration_minutes: "60" },
    });
    await database.insertPOIs([original]);
    await database.setStarredItem("poi", original.id, true);
    const stars = await database.getStarredItems("poi");
    harness.raw.exec(`
      CREATE TRIGGER fail_poi_refresh BEFORE INSERT ON pois
      WHEN NEW.id = 'rejected'
      BEGIN SELECT RAISE(ABORT, 'simulated write failure'); END;
    `);
    const incoming = Array.from({ length: 500 }, (_, index) =>
      buildPoi(`new-${index}`, "route-1", index),
    );
    incoming.push(buildPoi("rejected", "route-1", 501));

    await expect(database.replacePOIsBySource("route-1", "osm", incoming)).rejects.toThrow();

    expect(await database.getPOIsForRoute("route-1")).toEqual([original]);
    expect(await database.getStarredItems("poi")).toEqual(stars);
  });

  it("keeps concurrent source refresh transactions independent when one fails", async () => {
    const osm = buildPoi("saved-osm", "route-1", 100, { tags: { notes: "Keep my note" } });
    const google = buildPoi("saved-google", "route-1", 200, {
      source: "google",
      tags: { planned_stop_duration_minutes: "60" },
    });
    await database.insertPOIs([osm, google]);
    harness.raw.exec(`
      CREATE TRIGGER fail_poi_refresh BEFORE INSERT ON pois
      WHEN NEW.id = 'rejected'
      BEGIN SELECT RAISE(ABORT, 'simulated write failure'); END;
    `);
    const incomingOsm = Array.from({ length: 500 }, (_, index) =>
      buildPoi(`new-${index}`, "route-1", index),
    );
    incomingOsm.push(buildPoi("rejected", "route-1", 501));
    const refreshedGoogle = { ...google, name: "New shop name", tags: { phone: "+123" } };

    const results = await Promise.allSettled([
      database.replacePOIsBySource("route-1", "osm", incomingOsm),
      database.replacePOIsBySource("route-1", "google", [refreshedGoogle]),
    ]);

    expect(results.map((result) => result.status)).toEqual(["rejected", "fulfilled"]);
    expect(await database.getPOIsForRoute("route-1")).toEqual([
      osm,
      { ...refreshedGoogle, tags: { phone: "+123", planned_stop_duration_minutes: "60" } },
    ]);
  });

  if (platform === "web") {
    it.each([true, false])(
      "commits rider edits after a paused refresh rolls back (starred: %s)",
      async (starred) => {
        const original = buildPoi("saved", "route-1", 100, { tags: { notes: "Old note" } });
        await database.insertPOIs([original]);
        await database.setStarredItem("poi", original.id, !starred);
        harness.raw.exec(`
          CREATE TRIGGER fail_poi_refresh BEFORE INSERT ON pois
          WHEN NEW.id = 'rejected'
          BEGIN SELECT RAISE(ABORT, 'simulated write failure'); END;
        `);
        let notifyPaused!: () => void;
        const paused = new Promise<void>((resolve) => {
          notifyPaused = resolve;
        });
        let resume!: () => void;
        const resumed = new Promise<void>((resolve) => {
          resume = resolve;
        });
        const runAsync = harness.sqlite.runAsync.bind(harness.sqlite);
        vi.spyOn(harness.sqlite, "runAsync").mockImplementation(async (query, ...params) => {
          const result = await runAsync(query, ...params);
          if (query === "DELETE FROM pois WHERE routeId = ? AND source = ?") {
            notifyPaused();
            await resumed;
          }
          return result;
        });
        const refresh = database.replacePOIsBySource("route-1", "osm", [
          original,
          buildPoi("rejected", "route-1", 200),
        ]);
        await paused;
        const tags = { notes: "New rider note", planned_stop_duration_minutes: "30" };
        const edits = Promise.all([
          database.updatePOITags(original.id, tags),
          database.setStarredItem("poi", original.id, starred),
        ]);
        const acknowledgedBeforeRefreshFinished = await Promise.race([
          edits.then(() => true),
          new Promise<boolean>((resolve) => {
            setTimeout(() => resolve(false), 0);
          }),
        ]);
        resume();
        const results = await Promise.allSettled([refresh, edits]);

        expect(acknowledgedBeforeRefreshFinished).toBe(false);
        expect(results.map((result) => result.status)).toEqual(["rejected", "fulfilled"]);
        expect(await database.getPOIsForRoute("route-1")).toEqual([{ ...original, tags }]);
        expect((await database.getStarredItems("poi")).map((star) => star.entityId)).toEqual(
          starred ? [original.id] : [],
        );
      },
    );
  }

  it("preserves unrelated sources on empty refresh and removes stars only on explicit clear", async () => {
    const fetched = buildPoi("fetched", "route-1", 100);
    const custom = buildPoi("custom", "route-1", 200, { source: "custom" });
    await database.insertPOIs([fetched, custom]);
    await database.setStarredItem("poi", fetched.id, true);
    await database.setStarredItem("poi", custom.id, true);

    await database.replacePOIsBySource("route-1", "osm", []);
    expect(await database.getPOIsForRoute("route-1")).toEqual([custom]);
    expect((await database.getStarredItems("poi")).map((star) => star.entityId).sort()).toEqual([
      "custom",
      "fetched",
    ]);

    await database.replacePOIsBySource("route-1", "osm", [fetched]);
    await database.deletePOIsBySource("route-1", "osm", { deleteStarredItems: true });
    expect(await database.getPOIsForRoute("route-1")).toEqual([custom]);
    expect((await database.getStarredItems("poi")).map((star) => star.entityId)).toEqual([
      "custom",
    ]);
  });
});
