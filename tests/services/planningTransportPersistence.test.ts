import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  collectionSegments,
  collections,
  planningMetadata,
  pois,
  relativeEtaCache,
  routePoints,
  routes,
  starredItems,
} from "@/db/schema";
import { buildPoi } from "@/tests/fixtures/poi";
import { createSQLiteHarness } from "@/tests/helpers/sqliteHarness";
import type { Route } from "@/types";

const databaseMocks = vi.hoisted(() => ({
  nativeDatabase: vi.fn(),
  webDatabase: vi.fn(),
}));

vi.mock("expo-sqlite", () => ({
  deserializeDatabaseSync: vi.fn(),
  deserializeDatabaseAsync: vi.fn(),
}));

vi.mock("@/db/database", () => ({
  get appSQLiteDb() {
    return databaseMocks.nativeDatabase().sqlite;
  },
  get db() {
    return databaseMocks.nativeDatabase().db;
  },
  getAllCollections: vi.fn(),
  getAllRoutes: vi.fn(),
  setPlanningMetadata: vi.fn(),
}));

vi.mock("@/db/database.web", () => ({
  getWebSQLiteDatabase: async () => databaseMocks.webDatabase().sqlite,
  getAllCollections: vi.fn(),
  getAllRoutes: vi.fn(),
  getPlanningMetadata: vi.fn(),
  setPlanningMetadata: vi.fn(),
}));

import { importPlanningDatabase as importNative } from "@/services/planningTransportCore";
import { importPlanningDatabase as importWeb } from "@/services/planningTransportCore.web";

type Harness = ReturnType<typeof createSQLiteHarness>;
const openDatabases: Harness[] = [];
let source: Harness;
let target: Harness;

function openDatabase(): Harness {
  const database = createSQLiteHarness();
  openDatabases.push(database);
  return database;
}

function route(id: string): Route {
  return {
    id,
    name: id,
    fileName: `${id}.gpx`,
    color: "#123456",
    isActive: false,
    isVisible: true,
    totalDistanceMeters: 1_000,
    totalAscentMeters: 100,
    totalDescentMeters: 0,
    pointCount: 2,
    createdAt: "2026-09-23T10:00:00.000Z",
  };
}

function metadata(database: Harness, key: string, value: string): void {
  database.db
    .insert(planningMetadata)
    .values({ key, value, updatedAt: "2026-09-23T10:00:00.000Z" })
    .run();
}

function seedPlan(database: Harness, id: string): void {
  database.db.insert(routes).values(route(id)).run();
  database.db
    .insert(routePoints)
    .values([
      {
        routeId: id,
        idx: 0,
        latitude: 48,
        longitude: 17,
        elevationMeters: 0,
        distanceFromStartMeters: 0,
      },
      {
        routeId: id,
        idx: 1,
        latitude: 48,
        longitude: 17.01,
        elevationMeters: 100,
        distanceFromStartMeters: 1_000,
      },
    ])
    .run();
  database.db
    .insert(collections)
    .values({ id: `collection-${id}`, name: id, isActive: false, createdAt: route(id).createdAt })
    .run();
  database.db
    .insert(collectionSegments)
    .values({ collectionId: `collection-${id}`, routeId: id, position: 0, isSelected: true })
    .run();
  database.db
    .insert(pois)
    .values(
      buildPoi(`poi-${id}`, id, 500, { source: "custom", tags: { notes: `Notes for ${id}` } }),
    )
    .run();
  database.db
    .insert(starredItems)
    .values({ entityType: "poi", entityId: `poi-${id}`, createdAt: route(id).createdAt })
    .run();
  database.db
    .insert(relativeEtaCache)
    .values({
      cacheKey: `cache-${id}`,
      scope: "route",
      scopeId: id,
      signature: "old-geometry",
      powerConfigKey: "power",
      algorithmVersion: 1,
      pointCount: 2,
      totalDurationSeconds: 100,
      cumulativeSeconds: new Uint8Array(new Float64Array([0, 100]).buffer),
      updatedAt: route(id).createdAt,
    })
    .run();
  metadata(database, "transport_version", "2");
}

function planningRows(database: Harness) {
  return Object.fromEntries(
    [
      "routes",
      "route_points",
      "collections",
      "collection_segments",
      "pois",
      "starred_items",
      "climbs",
      "ferry_crossings",
      "planning_metadata",
      "relative_eta_cache",
    ].map((table) => [table, database.raw.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]),
  );
}

beforeEach(() => {
  source = openDatabase();
  target = openDatabase();
  databaseMocks.nativeDatabase.mockImplementation(() => target);
  databaseMocks.webDatabase.mockImplementation(() => target);
});

afterEach(() => {
  for (const database of openDatabases.splice(0)) database.close();
});

describe("native planning import persistence", () => {
  it.each(["absent", "empty"])("imports all POI sources when fetched metadata is %s", (mode) => {
    seedPlan(source, "incoming");
    seedPlan(target, "local-only");
    if (mode === "empty") metadata(source, "planner_fetched_sources", "[]");
    source.db
      .insert(pois)
      .values([
        buildPoi("water", "incoming", 100, { source: "osm" }),
        buildPoi("shop", "incoming", 200, { source: "google", category: "groceries" }),
      ])
      .run();
    source.db
      .insert(starredItems)
      .values({ entityType: "poi", entityId: "shop", createdAt: route("incoming").createdAt })
      .run();

    const summary = importNative(source.sqlite);

    expect(summary).toMatchObject({
      routes: 1,
      pois: 3,
      starredItems: 2,
      replacedFetchedSources: 0,
    });
    expect(target.raw.prepare("SELECT id FROM pois ORDER BY id").all()).toEqual([
      { id: "poi-incoming" },
      { id: "poi-local-only" },
      { id: "shop" },
      { id: "water" },
    ]);
    expect(
      target.raw.prepare("SELECT entityId FROM starred_items ORDER BY entityId").all(),
    ).toEqual([{ entityId: "poi-incoming" }, { entityId: "poi-local-only" }, { entityId: "shop" }]);
  });

  it("merges fetched tag edits without replacing local provider details or other POIs", () => {
    seedPlan(source, "shared");
    seedPlan(target, "shared");
    const local = buildPoi("shared-poi", "shared", 150, {
      name: "Local provider name",
      latitude: 48,
      tags: { notes: "Old note" },
    });
    target.db
      .insert(pois)
      .values([local, buildPoi("local-only", "shared", 300)])
      .run();
    source.db
      .insert(pois)
      .values({
        ...local,
        name: "Exported name",
        latitude: 49,
        distanceAlongRouteMeters: 200,
        tags: { notes: "Planner edit", planned_stop_duration_minutes: "30" },
      })
      .run();

    importNative(source.sqlite);

    const merged = target.db
      .select()
      .from(pois)
      .all()
      .find((poi) => poi.id === local.id);
    expect(merged).toEqual({
      ...local,
      tags: { notes: "Planner edit", planned_stop_duration_minutes: "30" },
    });
    expect(target.raw.prepare("SELECT id FROM pois WHERE id = 'local-only'").get()).toEqual({
      id: "local-only",
    });
  });

  it("still replaces an explicitly authoritative fetched source", () => {
    seedPlan(source, "shared");
    seedPlan(target, "shared");
    metadata(
      source,
      "planner_fetched_sources",
      JSON.stringify([{ routeId: "shared", source: "osm" }]),
    );
    target.db
      .insert(pois)
      .values([
        buildPoi("old-osm", "shared", 100),
        buildPoi("retained-google", "shared", 200, { source: "google" }),
      ])
      .run();
    target.db
      .insert(starredItems)
      .values({ entityType: "poi", entityId: "old-osm", createdAt: route("shared").createdAt })
      .run();
    source.db
      .insert(pois)
      .values(buildPoi("new-osm", "shared", 300))
      .run();

    expect(importNative(source.sqlite).replacedFetchedSources).toBe(1);

    expect(target.raw.prepare("SELECT id FROM pois ORDER BY id").all()).toEqual([
      { id: "new-osm" },
      { id: "poi-shared" },
      { id: "retained-google" },
    ]);
    expect(
      target.raw.prepare("SELECT entityId FROM starred_items WHERE entityId = 'old-osm'").get(),
    ).toBeUndefined();
  });
});

describe("browser planning import persistence", () => {
  beforeEach(() => {
    seedPlan(source, "incoming");
    seedPlan(target, "unsaved-local");
  });

  it("keeps the entire previous workspace when a source row violates a foreign key", async () => {
    const previous = planningRows(target);
    source.raw.exec(
      "PRAGMA foreign_keys = OFF; UPDATE pois SET routeId = 'missing-route'; PRAGMA foreign_keys = ON;",
    );

    await expect(importWeb(source.sqlite)).rejects.toThrow("FOREIGN KEY constraint failed");

    expect(planningRows(target)).toEqual(previous);
  });

  it("rolls back every table and derived cache after a late SQLite write failure", async () => {
    const previous = planningRows(target);
    target.raw.exec(
      "CREATE TRIGGER reject_import BEFORE INSERT ON planning_metadata BEGIN SELECT RAISE(ABORT, 'injected write failure'); END;",
    );

    await expect(importWeb(source.sqlite)).rejects.toThrow("injected write failure");

    expect(planningRows(target)).toEqual(previous);
  });

  it("replaces the workspace on success and discards derived ETA caches", async () => {
    const summary = await importWeb(source.sqlite);

    expect(summary).toMatchObject({ routes: 1, collections: 1, pois: 1, starredItems: 1 });
    expect(planningRows(target)).toEqual({ ...planningRows(source), relative_eta_cache: [] });
  });

  it("serializes overlapping imports so both complete with a whole workspace", async () => {
    const secondSource = openDatabase();
    seedPlan(secondSource, "second-incoming");

    const summaries = await Promise.all([importWeb(source.sqlite), importWeb(secondSource.sqlite)]);

    expect(summaries).toHaveLength(2);
    expect(planningRows(target)).toEqual({
      ...planningRows(secondSource),
      relative_eta_cache: [],
    });
  });
});
