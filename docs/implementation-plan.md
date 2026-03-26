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

## Phase 4: ETA & Offline

**Goal:** Know when you'll reach the next resource, and make everything work without internet.

### Steps:

#### ETA Calculator (Power-Based)
1. **Power model physics engine** — implement the cycling power equation:
   - `P = (Crr × m × g × cos(θ) + 0.5 × ρ × CdA × v² + m × g × sin(θ)) × v`
   - Given power + gradient → solve cubic for velocity (Newton's method / bisection)
   - Cap descent speed at configurable max (default 60 km/h)
   - Apply drivetrain efficiency loss
2. **Segment-based ETA computation** — for each route segment between consecutive points:
   - Calculate gradient from elevation delta / distance
   - Solve for predicted speed at configured power
   - Accumulate time = segment distance / predicted speed
3. **Power model configuration UI** — settings screen for:
   - Power output (W) — primary input
   - Total weight (kg) — rider + bike + gear
   - Advanced toggle: CdA, Crr, max descent speed (with sensible defaults)
4. **Distance-along-route calculation** — from current snapped position to any POI/route point
5. **ETA display on POI cards** — show distance, predicted riding time, and ETA for each POI
6. **ETA in "What's next" bar** — "Next water: 23 km (~1h 12min, ETA 14:35)"
   - ETA is now terrain-aware: 23 km with a big climb shows longer time than 23 km flat

#### Offline Support
7. **Offline tile downloader** — given a route, calculate required tile regions, download tile packs via Mapbox offline API
8. **Download size estimator** — estimate MB before downloading, show to user
9. **Download progress UI** — progress bar, cancel, retry
10. **POI data caching** — mark routes as "offline ready" when POI data is fetched
11. **Offline state indicator** — show connectivity status, "last synced" for POI data
12. **Storage management screen** — show space used per route (tiles + POI data), allow cleanup

### Deliverable:
Full race-ready app. Know your ETAs, and everything works in airplane mode.

### Technical notes:
- Mapbox's `OfflineManager` API handles tile pack downloads natively
- Tile download for zoom 6–15 in a 10km corridor around a 1000km route ≈ 50–150 MB
- **Power model math:** solving `P = f(v, θ)` for v is a depressed cubic — Newton's method converges in 3-5 iterations, fast enough to recompute on every GPS update
- Pre-compute and cache segment speeds for the entire route when power config changes (avoid recalculating on every position update)
- ETA should update reactively as position changes — just look up remaining segments from the pre-computed table
- Consider allowing "offline preparation" mode: a single button that downloads tiles + POIs for a route
- The power model is pure math on elevation data — no network dependency, works fully offline

---

## Phase 5: Weather & Polish (Advanced)

**Goal:** Weather integration and UX refinements for race conditions.

### Steps:

#### Weather
1. **Open-Meteo API client** — fetch current weather + forecast for coordinates
2. **Weather at current position** — display temp, wind, precipitation on map screen
3. **Weather along route** — fetch forecasts at waypoints spaced every ~50km along route
4. **Weather timeline** — show expected conditions at your estimated positions over next 12/24h
5. **Wind indicator** — headwind/tailwind/crosswind relative to route bearing
6. **Weather cache** — store last fetched weather, show "as of X hours ago" when offline

#### Polish
7. **Dark mode** — full dark theme for night riding
8. **Performance optimization** — profile and optimize battery usage, reduce GPS polling when stationary
9. **Route comparison view** — overlay two route alternatives, compare elevation and distance
10. **Improved elevation profile** — show POIs on the elevation chart
11. **Export/share** — export current position, share route with others
12. **Onboarding flow** — first-launch tutorial showing key features
13. **Crash reporting & error handling** — graceful error recovery, especially for corrupt GPX files

### Deliverable:
A polished, weather-aware ultra-cycling companion ready for race day.

---

## Phase Summary

| Phase | Focus | Key Outcome |
|-------|-------|------------|
| 1 | Foundation | Map + GPS working |
| 2 | Routes | Import routes, elevation profile |
| 3 | POIs | Find resources along route |
| 4 | ETA + Offline | Race-ready, works without internet |
| 5 | Weather + Polish | Advanced features, production quality |

## Estimated Complexity

| Phase | Relative Effort |
|-------|----------------|
| 1 | Small — mostly setup and integration |
| 2 | Medium — GPX parsing, chart component, route snapping math |
| 3 | Medium — Overpass API integration, spatial queries, POI UI |
| 4 | Large — offline tile management is the biggest technical challenge |
| 5 | Medium — weather is straightforward, polish is iterative |

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
