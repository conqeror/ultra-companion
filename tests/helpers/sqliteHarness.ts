import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { drizzle } from "drizzle-orm/expo-sqlite/driver";
import type { SQLiteDatabase } from "expo-sqlite";
import migrations from "@/drizzle/migrations";

function bindings(values: unknown[]): SQLInputValue[] {
  return (values.length === 1 && Array.isArray(values[0]) ? values[0] : values) as SQLInputValue[];
}

/** Real in-memory SQLite behind the Expo calls used by the database services. */
export function createSQLiteHarness() {
  const raw = new DatabaseSync(":memory:");
  const getAllSync = (query: string, ...values: unknown[]) =>
    raw.prepare(query).all(...bindings(values));
  const getFirstSync = (query: string, ...values: unknown[]) =>
    raw.prepare(query).get(...bindings(values)) ?? null;
  const runSync = (query: string, ...values: unknown[]) => {
    const result = raw.prepare(query).run(...bindings(values));
    return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) };
  };
  const withTransactionSync = (task: () => void) => {
    raw.exec("BEGIN");
    try {
      task();
      raw.exec("COMMIT");
    } catch (error) {
      raw.exec("ROLLBACK");
      throw error;
    }
  };
  const withTransactionAsync = async (task: () => Promise<void>) => {
    try {
      await sqlite.execAsync("BEGIN");
      await task();
      await sqlite.execAsync("COMMIT");
    } catch (error) {
      await sqlite.execAsync("ROLLBACK");
      throw error;
    }
  };

  const sqlite = {
    execSync: (query: string) => raw.exec(query),
    execAsync: async (query: string) => raw.exec(query),
    getAllSync,
    getAllAsync: async (query: string, ...values: unknown[]) => getAllSync(query, ...values),
    getFirstSync,
    getFirstAsync: async (query: string, ...values: unknown[]) => getFirstSync(query, ...values),
    runSync,
    runAsync: async (query: string, ...values: unknown[]) => runSync(query, ...values),
    withTransactionSync,
    withTransactionAsync,
    closeAsync: async () => raw.close(),
    prepareSync: (query: string) => ({
      executeSync: (values: SQLInputValue[]) => ({
        ...runSync(query, values),
        getAllSync: () => getAllSync(query, values),
        getFirstSync: () => getFirstSync(query, values),
      }),
      executeForRawResultSync: (values: SQLInputValue[]) => ({
        getAllSync: () => getAllSync(query, values).map((row) => Object.values(row)),
      }),
    }),
  } as unknown as SQLiteDatabase;

  raw.exec("PRAGMA foreign_keys = ON");
  raw.exec(
    "CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash TEXT NOT NULL, created_at NUMERIC)",
  );
  withTransactionSync(() => {
    for (const entry of migrations.journal.entries) {
      const key = `m${entry.idx.toString().padStart(4, "0")}` as keyof typeof migrations.migrations;
      raw.exec(migrations.migrations[key]);
      runSync("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)", "", entry.when);
    }
  });

  return { raw, sqlite, db: drizzle(sqlite), close: () => raw.close() };
}
