# Performance Notes

Issue 18 focused on long ultra-distance routes and active collections. This document describes the intended memory model and calls out current regressions explicitly.

## Route Point Loading

Before: app startup and the map tab called `loadRoutesAndPoints()`, which loaded full point arrays for every visible route.

After: normal startup loads route metadata only. The map tab lazy-loads full points only for the active standalone route, while active collections are loaded through the collection stitching path. Route and collection detail screens still load full geometry when opened explicitly.

Current exception: importing a planner database refreshes through `loadRoutesAndPoints()`, temporarily loading points for every visible route. This is a regression from the intended metadata-first startup model and is tracked in [#43](https://github.com/conqeror/ultra-companion/issues/43).

Representative memory shape:

- 4 visible imported routes × 100k points: startup changes from 400k loaded route points to metadata only.
- Active standalone route: map keeps only that route's full point array.
- Active collection: map uses the stitched collection geometry and no longer injects raw per-segment point arrays into `routeStore`.

## Collection Activation

Before: collection activation stored both a stitched full-resolution point array and `pointsByRouteId` raw arrays in long-lived store state, then copied those raw arrays into `routeStore.visibleRoutePoints`.

After: active collection stitching omits `pointsByRouteId`, loads selected segments sequentially, and keeps only the stitched points plus segment offsets in the active collection view model. Collection detail still requests raw per-segment points because the planning screen needs mini-map routes and per-segment ETA rows.

Current exception: the active map also loads raw geometry for collection positions that have variants so it can draw base and alternative overlays. The implementation currently fetches more raw routes than the overlay requires; this long-route memory regression is tracked in [#43](https://github.com/conqeror/ultra-companion/issues/43).

Representative 3 × 100k-point collection:

- Before: 300k raw point objects retained plus 300k stitched point objects retained.
- Intended active activation: 300k stitched point objects retained; raw selected segment arrays are temporary during stitching.

## Lookup And Rendering

- ETA-to-distance lookup now uses binary search over cumulative route distance instead of scanning forward from the current point.
- Upcoming elevation and climb slice boundaries use binary distance lookups before slicing.
- Snapping builds a cached route-segment spatial index, scores nearby segment-projection candidates, and uses recent snap history/heading to disambiguate overlapping route legs.
- Mapbox route layers receive cached, zoom-sensitive Ramer-Douglas-Peucker simplified geometry: coarser at overview zooms, the previous 20 m tolerance around normal riding zoom, and finer detail when zoomed in.
- POI map rendering is route-distance windowed during ordinary riding, while the expanded POI list preserves full-list behavior.
- Offline POI association builds a route-segment grid once per fetch so each candidate POI checks nearby route segments first, with full-route fallback for sparse/out-of-window cases.
