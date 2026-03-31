#!/usr/bin/env node
/**
 * Generate a dark variant of outdoors-v12 for bundling.
 *
 * Usage: node scripts/generate-dark-style.mjs
 *
 * Reads  assets/map-styles/outdoors-v12.json
 * Writes assets/map-styles/outdoors-v12-dark.json
 */

import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const INPUT = resolve(__dirname, "../assets/map-styles/outdoors-v12.json");
const OUTPUT = resolve(__dirname, "../assets/map-styles/outdoors-v12-dark.json");

// ---------------------------------------------------------------------------
// HSL parsing / serialization
// ---------------------------------------------------------------------------

const HSL_RE =
  /^hsla?\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*(?:,\s*([\d.]+))?\s*\)$/;

function parseHSL(color) {
  const m = color.match(HSL_RE);
  if (!m) return null;
  return {
    h: parseFloat(m[1]),
    s: parseFloat(m[2]),
    l: parseFloat(m[3]),
    a: m[4] !== undefined ? parseFloat(m[4]) : 1,
  };
}

function toHSL({ h, s, l, a }) {
  h = Math.round(h);
  s = Math.round(s);
  l = Math.round(l);
  if (a < 1) return `hsla(${h}, ${s}%, ${l}%, ${Number(a.toFixed(2))})`;
  return `hsl(${h}, ${s}%, ${l}%)`;
}

// ---------------------------------------------------------------------------
// Transform helpers
// ---------------------------------------------------------------------------

const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
const setL = (c, l) => ({ ...c, l: clamp(l) });
const desat = (c, f) => ({ ...c, s: clamp(c.s * f) });

// ---------------------------------------------------------------------------
// Per-category color transforms
// ---------------------------------------------------------------------------

const transforms = {
  background: (c) => ({ ...c, s: Math.min(c.s, 8), l: 12 }),
  water: (c) => desat(setL(c, 20), 0.6),
  landcover: (c) => ({
    ...c,
    s: clamp(c.s * 0.5, 0, 35),
    l: Math.max(18, c.l * 0.25),
    a: Math.min(c.a, 0.6),
  }),
  hillshade: (c) =>
    c.l < 50
      ? { ...c, l: 30, a: Math.min(c.a * 1.5, 0.15) }
      : { ...c, l: 5, a: Math.min(c.a * 1.5, 0.2) },
  building: (c) => desat(setL(c, 22), 0.3),
  roadFill: (c) =>
    c.s < 15 && c.l > 80
      ? { ...c, s: 0, l: 30 }
      : { ...c, s: Math.min(c.s, 60), l: Math.max(35, c.l * 0.5) },
  roadCase: (c) => desat(setL(c, 15), 0.3),
  path: (c) => (c.l > 60 ? { ...c, l: 30, s: Math.min(c.s, 20) } : { ...c, l: Math.min(c.l + 10, 45) }),
  contour: (c) => setL(c, 48),
  boundary: (c) => ({ ...c, s: Math.min(c.s, 25), l: Math.max(35, c.l) }),

  // Labels
  labelText: (c) => (c.l < 50 ? { ...c, s: Math.min(c.s, 10), l: 82 } : c),
  labelHalo: (c) =>
    c.l > 60 ? { ...c, s: Math.min(c.s, 8), l: 12, a: Math.min(c.a, 0.85) } : c,
  contourLabelText: (c) => setL(c, 50),
  contourLabelHalo: (c) => setL(c, 12),
  waterLabel: (c) => desat(setL(c, 55), 0.7),
  poiText: (c) => ({
    ...c,
    s: clamp(c.s * 0.7, 0, 50),
    l: Math.max(55, 100 - c.l),
  }),
  naturalLabel: (c) => setL(c, 60),
  // Building/block numbers — very subtle, low-priority info
  buildingLabel: (c) => ({ ...c, s: 0, l: 35, a: 0.6 }),
  buildingLabelHalo: (c) => ({ ...c, s: 0, l: 12, a: 0.4 }),
  genericFill: (c) => desat({ ...c, l: clamp(100 - c.l - 10) }, 0.5),
  genericLine: (c) =>
    c.l > 60
      ? desat(setL(c, 30), 0.5)
      : c.l < 30
        ? desat(setL(c, 50), 0.5)
        : desat(c, 0.5),
};

// ---------------------------------------------------------------------------
// Recursive expression walker
// ---------------------------------------------------------------------------

function walkValue(value, fn) {
  if (typeof value === "string") {
    const parsed = parseHSL(value);
    return parsed ? toHSL(fn(parsed)) : value;
  }
  if (Array.isArray(value)) return value.map((v) => walkValue(v, fn));
  return value;
}

// ---------------------------------------------------------------------------
// Layer classification
// ---------------------------------------------------------------------------

function classifyLayer(layer) {
  const { id, type } = layer;

  if (type === "background") return "background";
  if (id.startsWith("water") && type === "fill") return "water";
  if (id === "hillshade") return "hillshade";
  if (
    id === "landcover" ||
    id === "landuse" ||
    id.startsWith("national-park") ||
    id.startsWith("wetland")
  )
    return "landcover";
  if (id === "building-number-label" || id === "block-number-label" || id === "building-entrance")
    return "buildingLabel";
  if (id.startsWith("building")) return "building";
  if (id === "contour-label") return "contourLabel";
  if (id.startsWith("contour")) return "contour";

  const isRoadLike =
    id.startsWith("road-") || id.startsWith("bridge-") || id.startsWith("tunnel-");
  if (isRoadLike && id.endsWith("-case")) return "roadCase";
  if (
    id.includes("path") ||
    id.includes("pedestrian") ||
    id.includes("steps") ||
    id.includes("cycleway") ||
    id.includes("trail")
  ) {
    if (type === "line") return "path";
  }
  if (isRoadLike && type === "line") return "roadFill";
  if (id.startsWith("admin")) return "boundary";
  if (id.startsWith("waterway")) return "water";

  // Symbol sub-categories
  if (type === "symbol") {
    if (id.startsWith("water") || id === "waterway-label") return "waterLabel";
    if (id === "poi-label") return "poiLabel";
    if (id.startsWith("natural-")) return "naturalLabel";
    return "label";
  }

  if (type === "fill") return "genericFill";
  if (type === "line") return "genericLine";
  return "other";
}

// ---------------------------------------------------------------------------
// Apply per-layer transforms
// ---------------------------------------------------------------------------

/** Map from (paintProp → transformFn) for each category. */
const categoryRules = {
  background: { "background-color": transforms.background },
  water: {
    "fill-color": transforms.water,
    "fill-outline-color": transforms.water,
    "line-color": transforms.water,
  },
  landcover: {
    "fill-color": transforms.landcover,
    "fill-outline-color": transforms.landcover,
    "line-color": transforms.landcover,
  },
  hillshade: { "fill-color": transforms.hillshade },
  building: {
    "fill-color": transforms.building,
    "fill-outline-color": transforms.building,
  },
  buildingLabel: {
    "text-color": transforms.buildingLabel,
    "text-halo-color": transforms.buildingLabelHalo,
  },
  roadFill: { "line-color": transforms.roadFill },
  roadCase: { "line-color": transforms.roadCase },
  path: { "line-color": transforms.path },
  contour: { "line-color": transforms.contour },
  boundary: { "line-color": transforms.boundary },
  contourLabel: {
    "text-color": transforms.contourLabelText,
    "text-halo-color": transforms.contourLabelHalo,
  },
  label: {
    "text-color": transforms.labelText,
    "text-halo-color": transforms.labelHalo,
  },
  waterLabel: {
    "text-color": transforms.waterLabel,
    "text-halo-color": transforms.labelHalo,
  },
  poiLabel: {
    "text-color": transforms.poiText,
    "text-halo-color": transforms.labelHalo,
  },
  naturalLabel: {
    "text-color": transforms.naturalLabel,
    "text-halo-color": transforms.labelHalo,
  },
  genericFill: {
    "fill-color": transforms.genericFill,
    "fill-outline-color": transforms.genericFill,
  },
  genericLine: { "line-color": transforms.genericLine },
};

function transformLayer(layer) {
  const cat = classifyLayer(layer);
  const rules = categoryRules[cat];
  if (!rules || !layer.paint) return layer;

  const paint = { ...layer.paint };
  for (const [prop, fn] of Object.entries(rules)) {
    if (paint[prop] !== undefined) {
      paint[prop] = walkValue(paint[prop], fn);
    }
  }
  return { ...layer, paint };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const style = JSON.parse(readFileSync(INPUT, "utf-8"));
const dark = { ...style, layers: style.layers.map(transformLayer) };

writeFileSync(OUTPUT, JSON.stringify(dark), "utf-8");

const lightLayers = style.layers.length;
const darkLayers = dark.layers.length;
console.log(
  `✓ Generated dark style: ${darkLayers} layers (from ${lightLayers} light layers)`,
);
console.log(`  → ${OUTPUT}`);
