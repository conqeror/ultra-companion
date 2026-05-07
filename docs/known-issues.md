# Known Issues

Small bugs and warnings to address later. Open feature work lives in `docs/roadmap.md`.

Last reviewed: 2026-05-07

## Warnings

### npm audit: PostCSS moderate advisory

- **Where:** Transitive dependency tree through Expo/NativeWind/Tailwind
- **Advisory:** PostCSS XSS via unescaped `</style>` in CSS stringify output
- **Status:** `npm audit --omit=dev --audit-level=moderate` reports no fix available as of 2026-05-07
- **Impact:** Low for current app usage because Ultra does not stringify untrusted user CSS at runtime; monitor upstream Expo/NativeWind/Tailwind updates

### NestableDraggableFlatList measureLayout warning

- **Where:** `components/collection/SegmentList.tsx` on the collection detail screen
- **Error:** `ref.measureLayout must be called with a ref to a native component`
- **Cause:** `react-native-draggable-flatlist` tries to measure layout against a non-native ref, likely due to a NativeWind wrapper or Expo Router layout boundary
- **Impact:** Cosmetic warning; drag-to-reorder still works

### Mapbox "Invalid size {64, 64}" warning

- **Where:** Route/collection mini maps during first layout
- **Cause:** MapView can render before its parent View reports final dimensions, so Mapbox briefly falls back to 64x64
- **Impact:** Cosmetic warning; map resizes correctly after layout

### Mapbox "adding non-polygon geometry to fill-layer"

- **Where:** Map rendering
- **Cause:** Mapbox outdoor-v12 style internally processes LineString route data through a fill layer
- **Impact:** Cosmetic warning; route rendering works correctly

## Bugs

None currently tracked.
