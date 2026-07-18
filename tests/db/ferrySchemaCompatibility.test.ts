import { describe, expect, it } from "vitest";
import {
  FERRY_CROSSINGS_MIGRATION_CREATED_AT,
  hasSupportedFerryCrossingsSchema,
  shouldPrepareFerryCrossingsSchema,
} from "@/db/ferrySchemaCompatibility";

const supportedColumns = [
  "id",
  "routeId",
  "name",
  "startDistanceMeters",
  "endDistanceMeters",
  "startLatitude",
  "startLongitude",
  "endLatitude",
  "endLongitude",
  "durationMinutes",
  "assumedWaitMinutes",
  "boardingBufferMinutes",
  "source",
  "sourceId",
  "sourceUrl",
  "operator",
  "timetableUrl",
  "bicycleAccess",
  "providerRefs",
  "tags",
  "createdAt",
  "updatedAt",
].map((name) => ({ name, pk: name === "id" ? 1 : 0, notnull: name === "id" ? 1 : 0 }));

const cascadeRouteForeignKey = {
  table: "routes",
  from: "routeId",
  to: "id",
  on_delete: "CASCADE",
};

describe("ferry crossing schema compatibility", () => {
  it("runs the experimental-table recovery only through migration 0007", () => {
    expect(shouldPrepareFerryCrossingsSchema(0)).toBe(true);
    expect(shouldPrepareFerryCrossingsSchema(FERRY_CROSSINGS_MIGRATION_CREATED_AT)).toBe(true);
    expect(shouldPrepareFerryCrossingsSchema(FERRY_CROSSINGS_MIGRATION_CREATED_AT + 1)).toBe(false);
    expect(shouldPrepareFerryCrossingsSchema(Number.NaN)).toBe(false);
  });

  it("preserves the supported schema regardless of PRAGMA column order", () => {
    expect(
      hasSupportedFerryCrossingsSchema(supportedColumns.toReversed(), [cascadeRouteForeignKey]),
    ).toBe(true);
  });

  it("rejects an experimental schema with a missing supported column", () => {
    expect(
      hasSupportedFerryCrossingsSchema(
        supportedColumns.filter((column) => column.name !== "providerRefs"),
        [cascadeRouteForeignKey],
      ),
    ).toBe(false);
  });

  it("preserves a compatible experimental schema with extra columns", () => {
    expect(
      hasSupportedFerryCrossingsSchema(
        [...supportedColumns, { name: "departures", pk: 0, notnull: 0 }],
        [cascadeRouteForeignKey],
      ),
    ).toBe(true);
  });

  it("rejects a table without the id primary key or route cascade", () => {
    expect(
      hasSupportedFerryCrossingsSchema(
        supportedColumns.map((column) => ({ ...column, pk: 0 })),
        [cascadeRouteForeignKey],
      ),
    ).toBe(false);
    expect(hasSupportedFerryCrossingsSchema(supportedColumns, [])).toBe(false);
  });

  it("rejects an extra required column that current inserts cannot satisfy", () => {
    expect(
      hasSupportedFerryCrossingsSchema(
        [...supportedColumns, { name: "departures", pk: 0, notnull: 1, dflt_value: null }],
        [cascadeRouteForeignKey],
      ),
    ).toBe(false);
    expect(
      hasSupportedFerryCrossingsSchema(
        [...supportedColumns, { name: "departures", pk: 0, notnull: 1, dflt_value: "'[]'" }],
        [cascadeRouteForeignKey],
      ),
    ).toBe(true);
  });
});
