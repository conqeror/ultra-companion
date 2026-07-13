# Performance Notes

Issue 18 focused on long ultra-distance routes and active collections. This document describes the implemented memory ownership and loading contract.

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
- Intended active activation: 300k stitched point objects retained; raw selected segment arrays are temporary during stitching.

## Lookup And Rendering

- ETA-to-distance lookup now uses binary search over cumulative route distance instead of scanning forward from the current point.
- Upcoming elevation and climb slice boundaries use binary distance lookups before slicing.
- Snapping builds a cached route-segment spatial index, scores nearby segment-projection candidates, and uses recent snap history/heading to disambiguate overlapping route legs.
- Mapbox route layers receive cached, zoom-sensitive Ramer-Douglas-Peucker simplified geometry: coarser at overview zooms, the previous 20 m tolerance around normal riding zoom, and finer detail when zoomed in.
- POI map rendering is route-distance windowed during ordinary riding, while the expanded POI list preserves full-list behavior.
- Offline POI association builds a route-segment grid once per fetch so each candidate POI checks nearby route segments first, with full-route fallback for sparse/out-of-window cases.
