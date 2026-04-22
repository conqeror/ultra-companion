#!/usr/bin/env node
/**
 * Reads drizzle-kit generated SQL + journal and produces drizzle/migrations.ts
 * that Metro can bundle at runtime.
 *
 * Usage: node scripts/bundle-migrations.mjs
 */
import { readFileSync, readdirSync, writeFileSync } from "fs";
import { join } from "path";

const drizzleDir = join(import.meta.dirname, "..", "drizzle");
const journal = JSON.parse(readFileSync(join(drizzleDir, "meta", "_journal.json"), "utf-8"));

const sqlFiles = readdirSync(drizzleDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

const migrationEntries = sqlFiles.map((file, i) => {
  const sql = readFileSync(join(drizzleDir, file), "utf-8");
  // Escape backticks and ${} for template literal embedding
  const escaped = sql.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
  // Drizzle migrator looks up by `m${idx.padStart(4, '0')}`, not by tag name
  const key = `m${String(i).padStart(4, "0")}`;
  return `    "${key}": \`${escaped}\``;
});

const journalEntries = journal.entries.map(
  (e) => `      { idx: ${e.idx}, when: ${e.when}, tag: "${e.tag}", breakpoints: ${e.breakpoints} }`,
);

const output = `// Generated from db/schema.ts — regenerate with: npm run db:migrate
// Do not edit manually.

export default {
  journal: {
    entries: [
${journalEntries.join(",\n")},
    ],
  },
  migrations: {
${migrationEntries.join(",\n")},
  },
};
`;

const outPath = join(drizzleDir, "migrations.ts");
writeFileSync(outPath, output, "utf-8");
console.log(`Wrote ${outPath} (${sqlFiles.length} migration(s))`);
