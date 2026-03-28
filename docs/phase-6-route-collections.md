# Phase 6: Route Collections + Stitching (Implemented)

Groups GPX segments into races with ordered positions and automatic variant detection. Selected segments are stitched into a continuous view for elevation, stats, POIs, GPS snapping, ETA, and weather.

---

## Architecture

### Data Model

**Tables:** `races` (id, name, isActive, createdAt) and `race_segments` (raceId, routeId, position, isSelected). Position-based slots — multiple routes at the same position are variants. One `isSelected = 1` per position.

**Active context:** Either a race or a standalone route can be active, never both. `setActiveRace` deactivates all routes; `setActiveRoute` deactivates all races. The `useActiveRouteData()` hook provides a unified `ActiveRouteData` interface regardless of which is active.

### Stitching

`services/stitchingService.ts` — `stitchRace()` loads all selected segments in parallel via `Promise.all`, concatenates points with cumulative distance offsets, re-indexes sequentially. Returns `StitchedRace` with `pointsByRouteId` for per-segment point access.

All downstream services work unchanged on stitched `RoutePoint[]`:
- `snapToRoute(lat, lon, id, points)` — stitched array works directly
- `computeRouteETA(points, config)` — same
- `fetchWeather(id, points, fromIndex, cumulativeTime)` — same
- `ElevationProfile({ points })` — same

### Variant Auto-Detection

When adding a segment, `addSegment` compares the new route's first/last points against each existing position's selected segment endpoints (haversine). If both start and end are within 5km → added as unselected variant at that position. Otherwise → new position at the end.

### POI Handling

POIs remain stored per-segment in DB. For map display (lat/lon), no offset needed. For distance-based display (lists, elevation profile), `stitchPOIs()` applies `distanceOffsetMeters` from segment info.

---

## Key Files

| File | Purpose |
|------|---------|
| `types/index.ts` | Race, RaceSegment, StitchedRace, StitchedSegmentInfo, ActiveRouteData |
| `db/database.ts` | races/race_segments tables, CRUD, batch operations |
| `services/stitchingService.ts` | stitchRace(), stitchPOIs() |
| `store/raceStore.ts` | Race CRUD, segment management, variant detection, stitching |
| `hooks/useActiveRouteData.ts` | Unified hook + imperative accessor |
| `components/map/MapView.tsx` | Uses activeData hook, multi-routeId POIs |
| `components/map/BottomPanel.tsx` | Uses activeData, stitched POIs for "what's next" |
| `components/map/POILayer.tsx` | Accepts routeIds[] |
| `components/poi/POIListView.tsx` | Accepts routeIds[] + segments for stitched distances |
| `app/(tabs)/routes.tsx` | SectionList: races + unassigned routes only |
| `app/race/[id].tsx` | Race detail: mini map, stats, segment list, elevation, offline |
| `components/race/SegmentList.tsx` | Drag-to-reorder, variant radio selection, riding times |
| `components/race/AddSegmentSheet.tsx` | Route picker for adding segments |
| `components/race/RaceOfflineSection.tsx` | Batch download all segments |
| `components/elevation/ElevationProfile.tsx` | segmentBoundaries prop for dashed lines |

## UI

### Routes Tab
- SectionList with "Races" and "Routes" sections
- Routes section shows only unassigned routes (not in any race)
- Bottom bar: "New Race" + "Import Route" buttons with solid background

### Race Detail Screen
- Mini map showing all selected segments
- Stitched stats (distance, ascent, descent)
- Segment list with drag-to-reorder (react-native-draggable-flatlist + NestableScrollContainer)
- Variants grouped in bordered card with radio-button selection and "Choose variant" header
- All segments show estimated riding time from power model
- Stitched elevation profile with segment boundary markers
- Race offline section: batch download/delete all segments
- Loading overlay during all mutations
- Set Active / Delete Race actions

### Elevation Panel
- Modes: none → 10km → 25km → 50km → 100km → 200km (cycles via button)
- No "remaining" or "full route" modes — all modes show upcoming elevation at selected distance

### Navigation
- ThemeProvider from @react-navigation/native for flash-free dark mode headers
- All header styling centralized in root layout screenOptions
- Detail screens only override title
