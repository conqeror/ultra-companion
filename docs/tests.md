# Tests

Current test strategy and remaining gaps.

Last reviewed: 2026-05-07

## Commands

- `npm test` - run the Vitest suite once
- `npm run test:watch` - run Vitest in watch mode
- `npx tsc --noEmit` - TypeScript strict-mode check
- `npm run lint` - oxlint
- `npm run format:check` - oxfmt check
- `./scripts/smoke-test.sh` - AXe-driven iOS simulator smoke screenshots

## Current Coverage

The app has a pure-logic Vitest suite for the bug classes that TypeScript and linting cannot catch. As of this review: 30 test files, 172 tests.

Covered areas:

- Route import/export helpers and GPX serialization
- Route geometry, distance buckets, route markers, route progress, and riding horizon helpers
- Route snapping, including segment projection and ambiguous route progress behavior
- ETA calculator, power model, planned stops, and active timing helpers
- POI parsing, classification, map feature generation, list modeling, Google Places, Overpass, and saved custom POIs
- Collection stitching and stitched POI/climb/ETA coordinate behavior
- Weather service behavior and route-aware upcoming timeline helpers
- Route, POI, offline, and ETA/climb store behavior through focused store tests

## Manual / Native Coverage

React Native component rendering, Mapbox rendering, file picker/share-sheet behavior, SQLite migrations on device, and native offline tile downloads are still verified manually through the app and AXe screenshots rather than RN component tests.

This is intentional for now: the riskiest pure logic has fast tests, while native/runtime surfaces are expensive to fake well. Use `./scripts/smoke-test.sh` after UI or navigation changes and visually inspect `.axe-screenshots/`.

## Gaps To Add When Touched

- More opening-hours parser edge cases for country-specific and malformed rules
- Store recovery tests for persisted stale download/fetch state after interrupted app sessions
- Surface/descents tests when those features land
- A small native smoke checklist for share-sheet GPX/KML import and offline tile cancel/retry
