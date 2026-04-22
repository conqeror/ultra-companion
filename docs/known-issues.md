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

## Bugs

### POIs don't load for newly selected race variant

- **Where:** `components/map/MapView.tsx:102`
- **Issue:** POI loading effect depends on `activeData?.id` (race ID), which doesn't change when switching variants. If variant B's POIs haven't been loaded, they won't load until leaving and returning.
- **Fix:** Depend on `activeData?.routeIds` (serialized) instead of `activeData?.id`
