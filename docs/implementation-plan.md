# Ultra Companion — Implementation Plan

## Overview

The build is divided into 5 phases, progressing from a working map to a race-ready app. Each phase produces a usable increment — you can test on a ride after each phase.

---

## Phase 1: Foundation — Map & GPS

**Goal:** Display a map with live GPS position. Bare bones, but it works.

### Steps:
1. **Initialize Expo project** with TypeScript template
2. **Set up project structure** (folders, navigation skeleton with Expo Router)
3. **Integrate Mapbox SDK** (`@rnmapbox/maps`) — display a Mapbox vector tile map, set up access token
4. **Add GPS location tracking** — show user position on map with heading indicator
5. **Implement map controls** — zoom buttons, center-on-user, north-up/heading-up toggle
6. **Set up Zustand stores** — map state, settings store
7. **Basic settings screen** — units (km/mi), map style

### Deliverable:
A map app that shows where you are. Solid foundation for everything else.

### Technical risks:
- Mapbox requires an Expo dev build (not Expo Go) — set up the dev build pipeline in this phase
- Mapbox access token must be configured in app config (not committed to source control)

---

## Phase 2: Route Management & Elevation

**Goal:** Import GPX routes, display them on the map, and view elevation profiles.

### Steps:
1. **Build GPX parser** — parse GPX XML into RoutePoint arrays (support `<trk>`, `<rte>`, and `<wpt>`)
2. **Add KML parser** — basic KML/KMZ support (extract coordinates and elevation)
3. **Set up SQLite database** — schema for routes and route points
4. **Route import flow** — file picker + share sheet integration (`expo-document-picker`, `expo-sharing`)
5. **Render routes on map** — Mapbox line layers with distinct colors per route
6. **Route list screen** — view all imported routes, toggle visibility, set active route, delete
7. **Route snapping** — snap current GPS position to nearest point on active route, calculate progress
8. **Elevation profile component** — interactive chart showing elevation vs distance
   - Use `react-native-svg` or `victory-native` for the chart
   - Current position marker on profile
   - Gradient color coding
9. **Map ↔ Profile interaction** — tap on profile highlights point on map, tap on map highlights point on profile
10. **Route stats** — total distance, ascent, descent displayed in route detail view

### Deliverable:
Import your race route, see it on the map, track your progress along it, and study the elevation profile.

### Technical notes:
- GPX parsing can be done with a lightweight XML parser (`fast-xml-parser`)
- Route points may need downsampling for very long routes (>10,000 points) to keep the elevation chart smooth
- SQLite R-tree index on route points enables efficient spatial queries in later phases

---

## Phase 2b: Map Screen Bottom Panel — Toggleable Views ✓

**Goal:** Show elevation and progress data directly on the map screen via a toggleable bottom panel, so the rider doesn't need to leave the map during a ride.

### Design

**4 panel modes**, cycled via a single 48dp button (top-right, below center-on-user):
- **None** — clean map (current behavior)
- **Upcoming elevation** — next N km elevation profile from current position on active route
- **Full route profile** — entire active route elevation with current position marker
- **Route stats** — compact bar: distance remaining, ascent remaining, progress %

**Bottom panel** — overlays the map (no resize), ~25% screen height, white background with rounded top corners. Map camera padding adjusts so user position stays centered in the visible area above the panel.

**Look-ahead presets** (upcoming mode only) — pill buttons inside panel header: 2 / 5 / 10 / 20 km. Persisted in MMKV.

### Steps

1. **Add types and constants** — `PanelMode` type, `BOTTOM_PANEL_HEIGHT_RATIO`, `LOOK_AHEAD_OPTIONS_KM`
2. **Create panel store** (`store/panelStore.ts`) — Zustand + MMKV: `panelMode`, `lookAheadKm`, `cyclePanelMode()`
3. **Add `extractRouteSlice()` to `utils/geo.ts`** — slices route points from snapped position forward by N km, re-zeros distances, re-indexes from 0
4. **Extract `StatBox`** from `app/route/[id].tsx` → `components/common/StatBox.tsx` for reuse
5. **Create `BottomPanel.tsx`** — panel container with slide animation (reanimated), delegates to child component based on mode
6. **Add cycle button to `MapControls.tsx`** — below center-on-user button, cycles through panel modes, offsets up when panel visible
7. **Mount panel in `MapView.tsx`** — render `<BottomPanel />`, add Camera `padding.paddingBottom` when panel is visible
8. **Create `FullRouteProfile.tsx`** — wraps `ElevationProfile` with full active route points + current position marker
9. **Add `showLegend` prop to `ElevationProfile.tsx`** — optional, default true; false for compact panel view
10. **Create `RouteStatsBar.tsx`** — distance remaining, ascent remaining, progress % using `computeElevationProgress()`
11. **Create `UpcomingElevation.tsx`** — uses `extractRouteSlice()` + `ElevationProfile` with `currentPointIndex=0`, includes look-ahead pill buttons

### Key algorithm: Route slice

```
extractRouteSlice(points, startIndex, maxDistanceM):
  1. startDist = points[startIndex].distanceFromStartMeters
  2. endDist = startDist + maxDistanceM
  3. Scan forward from startIndex until point.distanceFromStartMeters >= endDist
  4. Slice array, re-zero distances (subtract startDist), re-index from 0
  5. Return new RoutePoint[] — ElevationProfile renders with currentPointIndex=0
```

### Panel ↔ Map interaction

- Panel is `position: absolute, bottom: 0` — map stays full screen underneath (resizing Mapbox causes expensive re-renders)
- When panel visible, Mapbox Camera `padding={{ paddingBottom: panelHeight }}` centers user position in visible area
- Cycle button offsets upward when panel is open

### Edge cases

- No active route → panel shows "Import and activate a route"
- Not snapped to route (>500m away) → upcoming/stats show "Ride closer to your route"
- Remaining route < look-ahead distance → show whatever is left
- App restart → panel mode and look-ahead persisted in MMKV

### New files

| File | Purpose |
|------|---------|
| `store/panelStore.ts` | Panel mode + look-ahead state (MMKV-backed) |
| `components/map/BottomPanel.tsx` | Panel container with slide animation |
| `components/map/UpcomingElevation.tsx` | Upcoming N km elevation + look-ahead pills |
| `components/map/FullRouteProfile.tsx` | Full route elevation wrapper |
| `components/map/RouteStatsBar.tsx` | Distance/ascent remaining, progress % |
| `components/common/StatBox.tsx` | Extracted stat box for reuse |

---

## Phase 3: POI Search

**Goal:** Find resources along your route — water, food, shops, gas stations.

### Steps:
1. **Overpass API client** — build a service that constructs Overpass QL queries for each POI category along a route corridor
2. **POI data fetching** — given a route, fetch all POIs within the corridor (chunk long routes into manageable query segments)
3. **POI SQLite storage** — store fetched POIs with spatial index for fast "along route" queries
4. **POI-to-route association** — for each POI, compute:
   - Perpendicular distance to nearest route segment
   - Distance along route from start (for ordering)
5. **POI map layer** — render category icons on the map for visible POIs
6. **POI filter bar** — toggle categories on/off, adjust corridor width
7. **POI list view** — sortable list of POIs along route from current position
8. **POI detail bottom sheet** — name, category, opening hours, address, distance info
9. **"What's next" quick view** — from map screen, show nearest upcoming POI per category (e.g., "Next water: 12 km", "Next shop: 34 km")

### Deliverable:
See all resources along your route, filter by type, and quickly find what's ahead.

### Technical notes:
- Overpass API has rate limits — batch queries efficiently, implement retry with backoff
- For a 1000 km route, split into ~50 km segments for Overpass queries
- POI count could be large — use virtualized lists for the POI list view
- Opening hours parsing: use `opening_hours` npm package to parse OSM opening hours format

---

## Phase 4: ETA, POIs on Elevation, Opening Hours & Offline

**Goal:** Answer "where should I stop next?" with terrain-aware ETAs, opening hours, and POIs visible on the elevation profile. Then make everything work in airplane mode.

### Steps:

#### GPS Rework
1. **On-demand GPS model** — replace continuous polling with:
   - Auto-refresh on app focus if last position is >10 min old
   - Manual "refresh position" button (prominent, always visible on map)
   - No background polling at all — zero battery cost from GPS
   - Show position age indicator when stale ("Position from 23 min ago")
   - Route snapping + ETA recalculation triggered by each position update

#### ETA Calculator (Power-Based)
2. **Power model physics engine** — implement the cycling power equation:
   - `P = (Crr × m × g × cos(θ) + 0.5 × ρ × CdA × v² + m × g × sin(θ)) × v`
   - Given power + gradient → solve cubic for velocity (Newton's method / bisection)
   - Cap descent speed at configurable max (default 60 km/h)
   - Apply drivetrain efficiency loss
3. **Segment-based ETA computation** — for each route segment between consecutive points:
   - Calculate gradient from elevation delta / distance
   - Solve for predicted speed at configured power
   - Accumulate time = segment distance / predicted speed
4. **Power model configuration UI** — settings screen for:
   - Power output (W) — primary input
   - Total weight (kg) — rider + bike + gear
   - Advanced toggle: CdA, Crr, max descent speed (with sensible defaults)
5. **ETA display on POI cards** — show distance, predicted riding time, and ETA for each POI
6. **ETA in "What's next" bar** — "Next water: 23 km (~1h 12min, ETA 14:35)"

#### POIs on Elevation Profile
7. **POI markers on elevation chart** — show category icons at their distance-along-route position on the elevation profile
   - Both the bottom panel (upcoming elevation) and full route profile views
   - Tap a POI marker on the profile to open its detail sheet
   - Respects current category filters
   - This is the key "what's between here and there" view

#### Opening Hours
8. **Opening hours parser** — parse OSM `opening_hours` format into structured data
9. **Open/closed status on POI cards** — prominently show "Open now", "Closes at 20:00", "Closed", "Opens at 07:00"
   - Color-coded: green for open, red for closed, amber for closing soon
10. **"Open now" filter** — toggle to hide closed POIs from list and map
11. **Opening hours on elevation profile POIs** — show open/closed status on profile markers too

#### Offline Support
12. **Offline tile downloader** — given a route, calculate required tile regions, download tile packs via Mapbox offline API
13. **Download size estimator** — estimate MB before downloading, show to user
14. **Download progress UI** — progress bar, cancel, retry
15. **"Prepare for offline" button** — single action that downloads tiles + ensures POI data is cached for a route
16. **Offline state indicator** — show connectivity status, "last synced" for POI data
17. **Storage management screen** — show space used per route (tiles + POI data), allow cleanup

### Deliverable:
Full race-ready app. Open the app, get your position, see POIs on the elevation profile with ETAs and opening hours, all in airplane mode.

### Technical notes:
- Mapbox's `OfflineManager` API handles tile pack downloads natively
- Tile download for zoom 6–15 in a 10km corridor around a 1000km route ≈ 50–150 MB
- **Power model math:** solving `P = f(v, θ)` for v is a depressed cubic — Newton's method converges in 3-5 iterations
- Pre-compute and cache segment speeds for the entire route when power config changes
- ETA recalculates on each manual position refresh — not continuous, so no performance concern
- Opening hours parsing: use `opening_hours` npm package to evaluate OSM format against current time
- The power model is pure math on elevation data — no network dependency, works fully offline

---

## Phase 5: Weather

**Goal:** Route-aware weather forecasts — know what's coming at your pace.

### Steps:

1. **Open-Meteo API client** — fetch current weather + forecast for coordinates
2. **Weather at current position** — display temp, wind, precipitation on map screen
3. **Weather along route** — fetch forecasts at waypoints spaced every ~50km along route
4. **Weather timeline** — show expected conditions at your estimated positions over next 12/24h (uses ETA calculator from Phase 4 to project where you'll be)
5. **Wind indicator** — headwind/tailwind/crosswind relative to route bearing
6. **Weather cache** — store last fetched weather, show "as of X hours ago" when offline

### Deliverable:
Weather-aware logistics — know if you need rain gear for tonight's mountain pass before you leave the valley.

### Notes:
- Weather requires connectivity — inherently limited when in airplane mode
- Cache aggressively: fetch when signal is available, display cached data with "as of" timestamp
- Dark mode is already implemented via NativeWind — no separate work needed

---

## Phase 9: Usability & Surface Data

**Goal:** Quality-of-life improvements from real ride feedback — better naming, searchable POIs, ETAs in lists, GPX file handling, and surface type visualization.

### Steps:

#### 9a: Rename Races → Collections (quick)
1. **Rename types** — `Race` → `Collection`, `RaceSegment` → `CollectionSegment`, etc. in `types/index.ts`
2. **Rename DB tables** — `races` → `collections`, `race_segments` → `collection_segments` (reset DB, no migration needed)
3. **Rename stores** — `raceStore.ts` → `collectionStore.ts`, update all store references
4. **Rename UI** — tab labels, screen titles, button text, empty states
5. **Rename files** — route files under `app/race/` → `app/collection/`, component files

#### 9b: POI Text Search (quick) ✓
6. ~~**Add search input** to POI list view — text field at the top with clear button~~
7. ~~**Filter POIs by name** — case-insensitive substring match against POI name~~
8. ~~**Preserve existing filters** — search works alongside category and open/closed filters~~

#### 9c: ETAs in POI List (medium) ✓
9. ~~**Compute ETAs for POI list items** — use existing power model + route snapping to calculate riding time and ETA for each POI~~
10. ~~**Display in POI list** — show estimated riding time and arrival time below distance info~~
11. ~~**Handle edge cases** — no GPS position, not snapped to route, POIs behind current position~~

#### 9d: Open GPX with App (medium)
12. **Register document types** — configure `app.json` / `app.config.ts` with iOS document types for `.gpx` and `.kml` files
13. **Handle incoming URLs** — listen for `expo-linking` URL events when app opens via file share
14. **Auto-import flow** — parse the incoming file and run the existing import pipeline, show confirmation

#### 9e: Surface Type Visualization (larger)
15. **Overpass surface query** — extend Overpass client to fetch `surface` tags for way segments along the route corridor
16. **Surface classification** — classify surfaces into paved/unpaved/unknown from OSM `surface` tag values
17. **Map rendering** — render route line with different styles per surface type (e.g., solid for paved, dashed for unpaved)
18. **Elevation profile rendering** — color-code or style the elevation profile line/fill by surface type
19. **Surface legend** — add a small legend to the elevation panel explaining the surface styles
20. **Offline caching** — store surface data in SQLite alongside route data

### Deliverable:
Better naming, searchable POIs with ETAs, seamless GPX file opening, and surface type awareness on map and elevation profile.

### Technical notes:
- DB reset is fine (app not in production) — no migration needed for the rename
- ETA calculator from Phase 4a can be reused directly — just needs to be wired into list items
- iOS document type registration requires a rebuild (not OTA-updatable)
- OSM `surface` tag coverage varies by region — expect gaps, show "unknown" gracefully
- Surface data should be fetched alongside POI data in the "prepare for offline" flow

---

## Phase Summary

| Phase | Focus | Key Outcome |
|-------|-------|------------|
| 1 | Foundation | Map + GPS working |
| 2 | Routes | Import routes, elevation profile |
| 3 | POIs | Find resources along route |
| 4 | ETA + POIs on elevation + opening hours + offline | Race-ready, works in airplane mode |
| 5 | Weather | Route-aware forecasts when connectivity is available |
| 6 | Route collections + stitching | Group route segments into collections |
| 7 | POI enhancements | Starred POIs, open/closed indicators |
| 8 | Dark outdoor map style | Night-riding-optimized map |
| 9 | Usability & surface data | Rename, search, ETAs in list, GPX open, surface types |

## Estimated Complexity

| Phase | Relative Effort |
|-------|----------------|
| 1 | Small — mostly setup and integration |
| 2 | Medium — GPX parsing, chart component, route snapping math |
| 3 | Medium — Overpass API integration, spatial queries, POI UI |
| 4 | Large — power model, POIs on elevation, opening hours, offline tiles |
| 5 | Small — weather API is straightforward, display is the main work |

---

## Getting Started

To kick off Phase 1:
```bash
npx create-expo-app@latest ultra --template tabs
cd ultra
npx expo install @rnmapbox/maps
npx expo install expo-location
npx expo install zustand
```

Mapbox requires a dev build (not Expo Go). You'll also need a Mapbox access token — create one at https://account.mapbox.com/access-tokens/ and configure it via environment variable.
