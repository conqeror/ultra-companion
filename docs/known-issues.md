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
