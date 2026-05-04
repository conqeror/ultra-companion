# Performance Notes

Issue 18 focused on long ultra-distance routes and active collections.

## Route Point Loading

Before: app startup and the map tab called `loadRoutesAndPoints()`, which loaded full point arrays for every visible route.

After: startup loads route metadata only. The map tab lazy-loads full points only for the active standalone route, while active collections are loaded through the collection stitching path. Route and collection detail screens still load full geometry when opened explicitly.

Representative memory shape:

- 4 visible imported routes × 100k points: startup changes from 400k loaded route points to metadata only.
- Active standalone route: map keeps only that route's full point array.
- Active collection: map uses the stitched collection geometry and no longer injects raw per-segment point arrays into `routeStore`.

## Collection Activation

Before: collection activation stored both a stitched full-resolution point array and `pointsByRouteId` raw arrays in long-lived store state, then copied those raw arrays into `routeStore.visibleRoutePoints`.

After: active collection stitching omits `pointsByRouteId`, loads selected segments sequentially, and keeps only the stitched points plus segment offsets in the active collection view model. Collection detail still requests raw per-segment points because the planning screen needs mini-map routes and per-segment ETA rows.

Representative 3 × 100k-point collection:

- Before: 300k raw point objects retained plus 300k stitched point objects retained.
- After active activation: 300k stitched point objects retained; raw selected segment arrays are temporary during stitching.

## Lookup And Rendering

- ETA-to-distance lookup now uses binary search over cumulative route distance instead of scanning forward from the current point.
- Upcoming elevation and climb slice boundaries use binary distance lookups before slicing.
- Snapping first checks a local window around the previous snapped index and falls back to a full-route scan only when the position jumps or the local result is too far from the route.
- Mapbox route layers receive cached, zoom-sensitive Ramer-Douglas-Peucker simplified geometry: coarser at overview zooms, the previous 20 m tolerance around normal riding zoom, and finer detail when zoomed in.
- POI map rendering is route-distance windowed during ordinary riding, while the expanded POI list preserves full-list behavior.
- Offline POI association builds a route-segment grid once per fetch so each candidate POI checks nearby route segments first, with full-route fallback for sparse/out-of-window cases.
