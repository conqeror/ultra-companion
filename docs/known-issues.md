# Known Issues

Small bugs and warnings to address later. Open feature work lives in `docs/roadmap.md`.

Last reviewed: 2026-07-13

## Warnings

### npm audit: upstream Expo/Metro dependency advisories

- **Snapshot:** `npm audit --omit=dev --audit-level=moderate` reports 158 advisories (98 low, 13 moderate, 45 high, 2 critical) as of 2026-07-13
- **Where:** The reported chains are predominantly transitive Expo/Metro/React Native build-tool dependencies, including Babel, `ws`, and PostCSS chains
- **Compatibility:** `npx expo-doctor` passes all checks; Expo-managed package versions are aligned
- **Status:** Do not run a blanket `npm audit fix` because it can move the Expo dependency graph outside supported versions. Review Expo SDK updates and targeted upstream fixes instead.
- **Impact:** This is primarily build/development tooling exposure for the current local, personal-use app. Reassess before accepting untrusted build inputs, exposing development servers, or deploying the web planner publicly.

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

- [#42 Harden route import atomicity and retry behavior](https://github.com/conqeror/ultra-companion/issues/42)
- [#43 Restore long-route memory guarantees after planner import and for collection variants](https://github.com/conqeror/ultra-companion/issues/43)
