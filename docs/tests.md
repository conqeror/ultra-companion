# Unit Test Backlog

Areas we want covered before taking on larger refactors (especially the coordinate-system unification in `docs/ideas.md`). No tests exist yet — this is a seed list, reprioritise as we go.

## Why these, why now

Every bug traced so far in the ETA / stitched-collection code was invisible to TypeScript and oxlint: wrong math, wrong coordinate space, stale cache. The primary guardrail in this codebase is `tsc`, which catches none of those. The tests below target the exact classes of bug we've hit.

## Tooling

We use **Vitest** for pure-logic tests. It runs in a Node environment and avoids React Native runtime dependencies for service-level math and stitching logic.

- Run once: `npm test`
- Watch mode: `npm run test:watch`

## Priority 1 — ETA correctness (the bug class that actually bit us)

### `services/etaCalculator.ts`

- `computeRouteETA`
  - Empty input returns `[]`.
  - Single point returns `[0]`.
  - Two flat points: time matches `distance / expectedFlatSpeed` for the default `PowerModelConfig`.
  - Monotonic: cumulative time is non-decreasing over a mixed-gradient route.
  - Pure climb vs. pure descent of equal length: climb takes longer; descent clamped at `maxDescentSpeedKmh`.
  - Missing elevation (`null`) on a point is treated as flat, not NaN.
- `getETAToDistance`
  - Target exactly at a point index → returns that point's cumulative time.
  - Target between two points → linearly interpolated time.
  - Target before `fromIndex`'s distance → returns `null` (current behaviour; codify it).
  - Target past the last point → returns last point's time (clamped).
  - Empty `points` or `cumulativeTime` → returns `null`.
  - Zero-length segment (two points at same distance) doesn't divide by zero.
- `getETABetweenIndices`
  - Negative / out-of-range indices return `0`.
  - `from > to` returns a negative number (or codify the guard we want).

### `store/etaStore.ts`

- `computeETAForRoute`
  - First call populates `cumulativeTime` + caches `routeId` and `cachedPoints`.
  - Second call with same `routeId` + same `points` reference is a no-op.
  - Second call with same `routeId` but **new** `points` reference (variant swap) recomputes. Regression test for the cache-staleness bug.
  - `updatePowerConfig` invalidates the cache.
- `getETAToPOI`
  - Standalone route: raw POI distance is used as-is.
  - Stitched collection, POI in segment 0: no offset applied (offset is 0).
  - Stitched collection, POI in segment N≥1 with raw distance < `segment.distanceOffsetMeters`: caller passing raw POI gets correct stitched result. Regression test for the POI detail bug.
  - Stitched collection, caller passes a **pre-stitched** POI (from `stitchPOIs`): store looks up raw from `poiStore` and offsets correctly — no double-count.
  - No snapped position → returns `null`.
  - POI not in `poiStore` (edge case) falls back to the passed-in POI.

## Priority 2 — Stitching correctness

### `services/stitchingService.ts`

- `stitchCollection`
  - Single segment: stitched points identical to source, `distanceOffsetMeters = 0`, totals match.
  - Two segments: offset of segment 1 = `segment 0.totalDistanceMeters`, stitched `distanceFromStartMeters` monotonically increasing across the boundary, no duplicate point at the seam.
  - Segment ordering respects `position` (shuffle input, verify output order).
  - Unselected variants are excluded.
  - Empty collection returns zeroed totals and empty arrays.
- `stitchPOIs`
  - POIs from segment N have `distanceAlongRouteMeters += segment.distanceOffsetMeters`.
  - Output is sorted by stitched distance across segments.
  - POI belonging to a routeId not in `segments` is skipped (not duplicated, not errored).

## Priority 3 — Climb distances (same coordinate-system class)

### `store/climbStore.ts:getClimbsForDisplay`

- Standalone route: distances unchanged.
- Stitched collection: `startDistanceMeters` / `endDistanceMeters` offset per segment.
- Sort order matches offset distance, not raw distance.
- Cross-segment merge (if/when implemented): two climbs meeting at a segment boundary merge into one with correct aggregate ascent / length.

### `utils/climbSelect.ts:resolveActiveClimb`

- Inside a climb range → returns that climb.
- Between climbs → returns the next upcoming.
- Past all climbs → returns `null`.
- Explicit `selectedClimb` overrides the distance-based pick.

## Priority 4 — Power model

### `services/powerModel.ts:computeSegmentTime`

- Flat segment: speed solves the cubic correctly within tolerance (cross-check against hand-computed value).
- Uphill: slower than flat for same distance.
- Downhill: clamped at `maxDescentSpeedKmh`.
- `drivetrainEfficiency < 1` reduces effective power (slower than `1.0`).
- Zero distance → zero time, no divide-by-zero.

## Priority 5 — Supporting utilities

### `utils/geo.ts:haversineDistance`

- Same point → 0.
- Known city-pair distances within a few metres of reference values.
- Antimeridian crossing doesn't blow up.

### `services/openingHoursParser.ts`

- `getOpeningHoursStatus` on `"24/7"` → open, detail `"24/7"`.
- Standard weekday rule (`"Mo-Fr 08:00-18:00"`) evaluated on an open vs. closed day / hour.
- `isOpenAt(rule, future ETA)` correctly predicts open/closed at a specific `Date`.
- Malformed rule doesn't throw.

### `services/routeSnapping.ts:snapToRoute`

- Point exactly on route → returns that point's index, `distanceAlongRouteMeters` = its `distanceFromStartMeters`.
- Point off route → returns nearest point (not interpolated — codify current behaviour).
- Empty route → returns `null`.

## Not in scope (for now)

- React component rendering tests — UI is exercised via AXe smoke tests (`./scripts/smoke-test.sh`). Hitting components adds a RN runtime dependency and duplicates visual verification we already do.
- DB layer — covered end-to-end by the app itself and intentionally easy to reset (`feedback_no_migrations`).
- Network fetchers (Overpass, Google Places, weather) — exercised in practice; mocking the HTTP layer costs more than it's worth for a personal tool.
