import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..");
const distRoot = resolve(projectRoot, "dist");
const sqliteWasmSource = resolve(
  projectRoot,
  "node_modules/expo-sqlite/web/wa-sqlite/wa-sqlite.wasm",
);
const workerDir = resolve(distRoot, "_expo/static/js/web");
const sqliteWasmAssetPattern =
  /\/assets\/node_modules\/expo-sqlite\/web\/wa-sqlite\/wa-sqlite\.[a-f0-9]+\.wasm/g;

function listFiles(dir, files = []) {
  if (!existsSync(dir)) return files;

  for (const entry of readdirSync(dir)) {
    const filePath = join(dir, entry);
    const stat = statSync(filePath);
    if (stat.isDirectory()) {
      listFiles(filePath, files);
    } else {
      files.push(filePath);
    }
  }

  return files;
}

if (!existsSync(sqliteWasmSource)) {
  throw new Error(`Missing Expo SQLite WASM source at ${sqliteWasmSource}`);
}

const workerFiles = listFiles(workerDir).filter((filePath) => filePath.endsWith(".js"));
const wasmAssetPaths = new Set();

for (const workerFile of workerFiles) {
  const source = readFileSync(workerFile, "utf8");
  for (const match of source.matchAll(sqliteWasmAssetPattern)) {
    wasmAssetPaths.add(match[0]);
  }
}

if (wasmAssetPaths.size === 0) {
  console.warn("No Expo SQLite WASM asset reference found in the web export.");
  process.exit(0);
}

for (const assetPath of wasmAssetPaths) {
  const outputPath = join(distRoot, assetPath);
  mkdirSync(dirname(outputPath), { recursive: true });
  copyFileSync(sqliteWasmSource, outputPath);
  console.log(`Copied Expo SQLite WASM asset to ${outputPath}`);
}
