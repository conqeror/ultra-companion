# Known Issues

Small bugs and warnings to address later.

## Warnings (cosmetic, no user impact)

### NestableDraggableFlatList measureLayout warning

- **Where:** `components/race/SegmentList.tsx:280` (race detail screen)
- **Error:** `ref.measureLayout must be called with a ref to a native component`
- **Cause:** `react-native-draggable-flatlist` tries to measure layout against a non-native ref (NativeWind wrapper or Expo Router layout)
- **Impact:** None — draggable list works fine

### Mapbox "Invalid size {64, 64}" warning

- **Where:** Route detail mini map
- **Cause:** MapView renders before parent View layout completes, Mapbox falls back to 64x64 temporarily
- **Impact:** None — map resizes correctly after layout

### Mapbox "adding non-polygon geometry to fill-layer"

- **Where:** Map rendering
- **Cause:** Mapbox outdoor-v12 style internally processes LineString route data through a fill layer
- **Impact:** None — rendering works correctly

## Code quality

### Downsampling duplication

- **Where:** `services/googlePlacesClient.ts:downsampleForPolyline`, `services/overpassClient.ts`, `services/offlineTiles.ts`
- **Issue:** 3 near-identical distance-based downsampling implementations differing only in interval and field names
- **Fix:** Consolidate into a shared `downsampleRoutePoints(points, intervalM)` in `utils/geo.ts`

### Route segmentation duplication

- **Where:** `services/googlePlacesClient.ts:splitRoute`, `services/overpassClient.ts:segmentRoute`
- **Issue:** Nearly identical distance-based route splitting with 1-point overlap
- **Fix:** Consolidate into a single parameterized function in `utils/geo.ts`

### Two-coordinate-system fragility (POIs & climbs)

- **Where:** Conversion between raw (per-route) and stitched (collection) distances is scattered across ~7 sites — see `docs/architecture.md` → Collections and Stitching for the full list.
- **Issue:** Each consumer has to remember to apply `segment.distanceOffsetMeters`. Every missed conversion is a silent bug: `getETAToDistance` hits its `distanceMeters < 0` guard and returns `null`, or compares against the wrong point index. Multiple bugs traced to this pattern (POI detail ETA, starred compact list before it was inlined, ETA cache staleness on variant swap).
- **Fix:** See `docs/ideas.md` → "Unify POI/climb coordinate space". Gated on unit tests landing first (`docs/tests.md`).

## Bugs

None currently tracked.
