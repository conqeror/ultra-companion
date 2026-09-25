# Tests

Current test strategy and remaining gaps.

Last reviewed: 2026-09-23

## Commands

- `npm test` - run the Vitest suite once
- `npm run test:watch` - run Vitest in watch mode
- `npx tsc --noEmit` - TypeScript strict-mode check
- `npm run lint` - oxlint
- `npm run format:check` - oxfmt check
- `./scripts/smoke-test.sh` - AXe-driven iOS simulator smoke screenshots

## Current Coverage

The app has a Vitest suite for the bug classes that TypeScript and linting cannot catch, including pure calculations, store behavior, and SQLite persistence regression tests. Run `npm test` for the current file and test counts. The SQLite integration tests require `node:sqlite`; they have been verified with Node.js 22.14.

Covered areas:

- BRouter response validation, coordinate order, request failures/timeouts/cancellation, and route-planner stale-response rejection, retry, preview invalidation, and duplicate-save protection
- Route import/export helpers and GPX serialization
- Route geometry, distance buckets, route markers, route progress, and riding horizon helpers
- Bounded long-route map geometry, compact fingerprints, and keyed-cache eviction
- Bounded elevation-profile sampling and renderer-neutral layout, ticks, markers, and tile models
- Route snapping, including segment projection and ambiguous route progress behavior
- ETA calculator, power model, planned stops, and active timing helpers
- POI parsing, classification, map feature generation, list modeling, Google Places, Overpass, and saved custom POIs
- Collection stitching and stitched POI/climb/ETA coordinate behavior, exercised through the production stitching service
- Sequential active-collection route loading and chunked collection-segment ETA totals
- Native and web planning-database transport, validation, and replacement behavior
- Planner import rollback on write failure, fetched POIs missing from the native destination, and POI cache reload after import
- Fetched POI replacement preserving rider notes/planned stops and previous data on failure, including overlapping browser transactions
- Weather service behavior and route-aware upcoming timeline helpers
- Weather projection invalidation, offline forecast reuse, overlapping requests, and stale completion rejection
- Shared route-detail cancellation/error recovery and ferry-adjusted presentation
- Active-route restoration, GPS completion against the latest plan, and native/browser panel return navigation
- Ferry schema recovery, span mapping, local OSM lookup, stored map geometry, Entur stop/departure parsing and cache behavior, riding-distance/elevation exclusion, ETA propagation, horizons, transport persistence, and Upcoming rows
- Route, POI, offline, and ETA/climb store behavior through focused store tests
- Offline readiness reconciliation for partial regions, missing style packs, interrupted sessions, and native enumeration errors

## Manual / Native Coverage

iOS route-planner check: Routes → New Route, tap a start and end, verify the route/distance/ascent,
add a via point by extending the route, Undo, Clear, and retry after a connection failure.
Save with a name and check route details, elevation, and GPX export. Check that leaving an unsaved
draft offers discard, reopening starts empty, and web Routes has no New Route action.

React Native component rendering, Mapbox rendering, file picker/share-sheet behavior, SQLite migrations on device, and native offline tile downloads are still verified manually through the app and AXe screenshots rather than RN component tests.

This is intentional for now: the riskiest pure logic has fast tests, while native/runtime surfaces are expensive to fake well. Use `./scripts/smoke-test.sh` after UI or navigation changes and visually inspect `.axe-screenshots/`.

## Gaps To Add When Touched

- More opening-hours parser edge cases for country-specific and malformed rules
- Store recovery tests for persisted stale POI fetch state after interrupted app sessions
- Surface/descents tests when those features land
- A small native smoke checklist for share-sheet GPX/KML import and offline tile cancel/retry
- End-to-end native and browser smoke coverage for `.ultra-plan.db` transfer

After changing native offline code, rebuild the iOS app. Check a completed download after relaunch, a cancelled/interrupted download followed by retry, and a downloaded route in airplane mode after ordinary map-cache eviction. Both bundled styles should retain labels and icons. Simulator compilation verifies SDK API compatibility but does not establish offline map availability on a device.
