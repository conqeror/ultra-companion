# Performance Notes

Long-route performance is designed around 4,000 km collections. This document describes the implemented memory ownership, rendering, responsiveness, and profiling contract.

## Route Point Loading

Before: app startup and the map tab called `loadRoutesAndPoints()`, which loaded full point arrays for every visible route.

After: normal startup loads route metadata only. The map tab lazy-loads full points only for the active standalone route, while active collections are loaded through the collection stitching path. Route and collection detail screens still load full geometry when opened explicitly.

Planner import follows the same contract: it clears stale view state, reloads route metadata, and loads points only for an active standalone route. An active collection loads its selected stitched geometry through the collection store; no unrelated visible route points are populated.

Representative memory shape:

- 4 visible imported routes × 100k points: startup changes from 400k loaded route points to metadata only.
- Active standalone route: map keeps only that route's full point array.
- Active collection: map uses the stitched collection geometry and no longer injects raw per-segment point arrays into `routeStore`.

## Collection Activation

Before: collection activation stored both a stitched full-resolution point array and `pointsByRouteId` raw arrays in long-lived store state, then copied those raw arrays into `routeStore.visibleRoutePoints`.

After: active collection stitching omits `pointsByRouteId`, loads selected segments sequentially, and keeps only the stitched points plus segment offsets in the active collection view model. Collection detail still requests raw per-segment points because the planning screen needs mini-map routes and per-segment ETA rows.

The active map queries geometry only for collection positions that have alternatives, plus a patch variant's base route when it is needed to calculate its effective metric. It loads those routes sequentially, computes metric labels, and retains only the alternative line geometry that Mapbox renders. Raw selected/base arrays are released after preparation; positions without variants issue no route-point queries.

Representative 3 × 100k-point collection:

- Before: 300k raw point objects retained plus 300k stitched point objects retained.
- Active activation: 300k stitched point objects retained; raw selected segment arrays are temporary and loaded sequentially during stitching.

Route-point reads use Expo SQLite's native asynchronous query API. `db.routePoints.read` and `collection.stitch.active` User Timing spans separate storage latency from collection assembly during profiling.

## Lookup And Rendering

- ETA-to-distance lookup now uses binary search over cumulative route distance instead of scanning forward from the current point.
- Upcoming elevation and climb slice boundaries use binary distance lookups before slicing.
- Snapping builds a cached route-segment spatial index, scores nearby segment-projection candidates, and uses recent snap history/heading to disambiguate overlapping route legs.
- Mapbox route layers receive cached, zoom-sensitive Ramer-Douglas-Peucker simplified geometry: coarser at overview zooms, the previous 20 m tolerance around normal riding zoom, and finer detail when zoomed in.
- Multi-segment collections prepare each segment directly instead of first creating and discarding one whole-route GeoJSON object. Segment coordinates are reused by the alternating-color collection layer; the base-route source is capped at 60,000 coordinates and all alternative overlays share a separate 20,000-coordinate budget.
- Collection-detail previews also share a 60,000-coordinate budget across their layers and prepare asynchronously on native and web.
- Keyed map geometry uses a compact streaming fingerprint and a 32-entry least-recently-used cache. Cache entries hold source identity weakly so inactive full point arrays can be reclaimed. Each line is sampled to its coordinate budget before fingerprinting and simplification, geometry preparation yields between collection segments, and the hook publishes one complete Mapbox source update.
- POI map rendering is route-distance windowed during ordinary riding, while the expanded POI list preserves full-list behavior.
- Offline POI association builds a route-segment grid once per fetch so each candidate POI checks nearby route segments first, with full-route fallback for sparse/out-of-window cases.

## Responsiveness Contract

Any user-triggered operation that can load or process route geometry paints feedback before starting expensive work:

- route and collection activation show a disabled, per-row progress state;
- the map shows a non-blocking `Preparing route…` pill while geometry is being prepared and an alert if preparation fails;
- collection detail names its current initial-load stage and labels mutation overlays;
- segment ETA totals run after first paint and yield between chunks;
- share-sheet imports, planner database transfer, and GPX export paint progress before parsing, database work, or serialization.

Progress UI is not considered a substitute for eliminating long tasks. The remaining synchronous candidates—stitching/copying a full selected segment, patch-route construction, planner-database transactions, cumulative ETA calculation, and GPX string serialization—must be measured on the real route and split or moved off the JS thread if they create visible stalls.

## Elevation Profile Renderer

Skia is the default elevation renderer on iOS. Use the SVG renderer as an emergency rollback or A/B baseline:

```bash
EXPO_PUBLIC_ELEVATION_RENDERER=svg npm start
```

Rebuild the native iOS client once after adding Skia; changing the flag alone cannot add the native pod to an older installed binary. If the native module is unavailable, iOS safely uses SVG. Web and Android always use SVG. On iOS, Skia shows visible preparation progress while it builds static chart pictures; if preparation fails, the profile falls back to a bounded, fit-to-width SVG instead of recreating the long scroll surface or leaving an empty/frozen surface. Profiling spans separate model work (`profile.skia.model`) from picture recording (`profile.skia.pictures`).

Validate both renderers against the same real 4,000 km collection in a release-device Instruments recording with Time Profiler and Hangs. The Skia rollout gate is:

- zero elevation-chart hangs longer than 250 ms;
- no SVG/Core Animation `aa_render` gradient stack while the Skia renderer is active;
- changing the current-position marker does not rebuild static Skia pictures.

## Synthetic Guardrail

This is a local Node reference rather than a device result. On 300,000 generated points spread across 4,000 km, the 2026-07-13 implementation measured:

- 60,000-point map fingerprint: 13.9 ms;
- overview geometry at 120 m tolerance: 24.1 ms and 2 output coordinates;
- detailed capped geometry: 19.7 ms and 60,000 output coordinates;
- cumulative ETA: 74.9 ms;
- GPX serialization: 325.3 ms for a 29.4 MB string;
- post-run JavaScript heap: 187.1 MB.

The map preparation numbers are useful regression guards. ETA, GPX, and memory remain real-device profiling targets because Node timings and allocation behavior do not represent Hermes, Mapbox transfer, SQLite, or iOS share-sheet costs.

## Real-route Profiling Runbook

Use the same physical iPhone, route database, power settings, and initial camera for every comparison. Run each measured flow three times: once cold, then twice warm.

### 1. React and JavaScript trace

Run the dev build with app-specific User Timing spans enabled:

```bash
EXPO_PUBLIC_ENABLE_PERF_MARKS=1 npm start
```

Open React Native DevTools (`j` in the Metro terminal), start both the React Profiler and JavaScript profiler, then perform this exact flow:

1. Open Routes and activate the 4,000 km collection.
2. Wait for `Preparing route…` to disappear, then pan and zoom from overview to riding zoom.
3. Open collection detail, wait for segment times, scroll through the profile, and switch one variant.
4. Return to the map, open Upcoming/Profile/POIs, then export GPX.

Record the heaviest React commit, JS long tasks, rerender counts, and these User Timing spans when present:

- `db.routePoints.read`
- `collection.stitch.active`
- `collection.proposePatchVariant`
- `map.routeGeoJSON`
- `eta.computeRouteETA`, `eta.computeRouteTotalETA`, and `eta.computeRouteTotalETAInChunks`
- `profile.resampleElevation`
- `gpx.serializeRoute` and `gpx.serializeCollection`
- `planning.importDatabase` and `planning.exportDatabase`

### 2. Release-device CPU and memory

Build the same revision for a physical device:

```bash
EXPO_PUBLIC_ELEVATION_RENDERER=skia EXPO_PUBLIC_ENABLE_PERF_MARKS=1 npx expo run:ios --configuration Release --device
```

Repeat with `EXPO_PUBLIC_ELEVATION_RENDERER=svg` for the baseline recording.

In Xcode Instruments, record the same flow with:

- Time Profiler, split between the main thread and JavaScript thread;
- Hangs, to catch periods where the app appears unresponsive;
- Allocations, noting peak and post-flow resident memory.

Capture timestamps for tap-to-feedback, tap-to-map-ready, detail-ready, and GPX share-sheet-ready. Also record peak memory, the largest main/JS-thread stall, and whether the loading indicator continued animating. A regression is actionable when it reproduces in at least two of the three runs; prioritize any missing feedback, hang, crash, or memory growth that does not settle after leaving the detail screen.
