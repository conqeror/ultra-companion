import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..");
const root = resolve(process.argv[2] ?? "dist");
const port = Number(process.env.PORT ?? process.argv[3] ?? 8090);
const sqliteWasmSource = resolve(
  projectRoot,
  "node_modules/expo-sqlite/web/wa-sqlite/wa-sqlite.wasm",
);
const sqliteWasmRequestPattern =
  /^\/assets\/node_modules\/expo-sqlite\/web\/wa-sqlite\/wa-sqlite\.[a-f0-9]+\.wasm$/;

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".webp": "image/webp",
};

function setIsolationHeaders(res) {
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Embedder-Policy", "credentialless");
  res.setHeader("Origin-Agent-Cluster", "?1");
  res.setHeader("Cache-Control", "no-store");
}

function resolveRequestPath(urlPath) {
  const decodedPath = decodeURIComponent(urlPath.split("?")[0] ?? "/");
  const normalizedPath = normalize(decodedPath).replace(/^(\.\.[/\\])+/, "");
  const candidate = join(root, normalizedPath);
  if (!candidate.startsWith(root)) return null;

  if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  if (existsSync(candidate) && statSync(candidate).isDirectory()) {
    const indexFile = join(candidate, "index.html");
    if (existsSync(indexFile)) return indexFile;
  }

  if (sqliteWasmRequestPattern.test(decodedPath) && existsSync(sqliteWasmSource)) {
    return sqliteWasmSource;
  }

  const spaFallback = join(root, "index.html");
  return existsSync(spaFallback) ? spaFallback : null;
}

const server = createServer((req, res) => {
  setIsolationHeaders(res);

  const filePath = resolveRequestPath(req.url ?? "/");
  if (!filePath) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const ext = extname(filePath);
  res.setHeader("Content-Type", mimeTypes[ext] ?? "application/octet-stream");
  createReadStream(filePath)
    .on("error", () => {
      res.writeHead(500);
      res.end("Internal server error");
    })
    .pipe(res);
});

server.listen(port, () => {
  const scriptName = fileURLToPath(import.meta.url);
  console.log(`Serving ${root} with SQLite web headers on http://localhost:${port}`);
  console.log(`Stop with Ctrl+C (${scriptName})`);
});
