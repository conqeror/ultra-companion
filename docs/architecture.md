# Ultra Companion — Architecture

Stack and conventions are in `CLAUDE.md`. This doc covers data models, offline strategy, and key technical decisions that aren't obvious from code.

## Data Models

### Route

```typescript
interface Route {
  id: string;
  name: string;
  fileName: string;
  color: string;
  isActive: boolean;
  isVisible: boolean;
  totalDistanceMeters: number;
  totalAscentMeters: number;
  totalDescentMeters: number;
  points: RoutePoint[];
  createdAt: string;
}

interface RoutePoint {
  latitude: number;
  longitude: number;
  elevationMeters: number | null;
  distanceFromStartMeters: number;
  index: number;
}
```

### POI

```typescript
interface POI {
  id: string;
  osmId: string;
  name: string | null;
  category: POICategory;
  latitude: number;
  longitude: number;
  tags: Record<string, string>;
  distanceFromRouteMeters: number;
  distanceAlongRouteMeters: number;
  nearestRouteId: string;
}

type POICategory =
  | "water"
  | "groceries"
  | "gas_station"
  | "cafe_restaurant"
  | "accommodation"
  | "bike_shop"
  | "atm"
  | "pharmacy"
  | "toilet_shower";
```

### Power Model

```typescript
interface PowerModelConfig {
  powerWatts: number;
  totalMassKg: number;
  cda: number; // default 0.4 m²
  crr: number; // default 0.005
  airDensity: number; // default 1.225 kg/m³
  maxDescentSpeedKmh: number; // default 60
  drivetrainEfficiency: number; // default 0.97
}
```

ETA computation: for each route segment, solve `P = (Crr × m × g × cos(θ) + 0.5 × ρ × CdA × v² + m × g × sin(θ)) × v` for velocity given gradient from elevation data. Cubic equation — Newton's method, 3-5 iterations.

## Offline Strategy

### Map Tiles

- On route import, compute bounding corridor (route + 10km buffer)
- Download vector tiles for zoom 6–15 via Mapbox `OfflineManager`
- Enable predictive caching along route geometry
- ~50–150 MB per 1000 km route

### POI Data

- Overpass API for OSM categories, Google Places for gas stations and groceries
- Route split into ~50km segments for Overpass queries, ~8km sampling for Google
- Stored in SQLite with spatial indexing
- ~1–5 MB per 1000 km route corridor

### Elevation Data

- Extracted from GPX (most files include elevation)
- Stored as part of route model — always offline

## Third-Party Services

| Service            | Purpose                                 | Cost                  |
| ------------------ | --------------------------------------- | --------------------- |
| Mapbox Maps SDK    | Tiles, styling, offline                 | Free (25k MAU/mo)     |
| Overpass API (OSM) | POI data (most categories)              | Free                  |
| Google Places API  | Gas stations + groceries (better hours) | Free ($200/mo credit) |
| Open-Meteo API     | Weather forecasts                       | Free, no API key      |

## Key Technical Decisions

### SQLite over AsyncStorage for POIs

Spatial queries ("find POIs within X meters of route") need indexed range queries across thousands of POIs. AsyncStorage is key-value only.

### Two POI sources (Overpass + Google Places)

OSM opening hours are often missing or wrong for gas stations and groceries — the two categories where open/closed matters most. Google Places has user-reported, verified hours. Other categories stay on Overpass (free, no API key, good coverage for water/bike shops/etc).

### Collections and Stitching

Routes are stored individually. Collections reference routes via `race_segments` table with position-based slots. At display time, selected segments are stitched (points concatenated with distance offsets). `RoutePoint[]` consumers (snapping, ETA cumulative time, weather, elevation rendering) receive the stitched array unchanged — their input is already in "stitched coords".

**Two coordinate systems for POIs and climbs.** POIs and climbs are stored per-route with `distanceAlongRouteMeters` / `startDistanceMeters` relative to **their own route** ("raw coords"). When a collection is active, the snapped position and `cumulativeTime` array live in **stitched coords** (raw + `segment.distanceOffsetMeters`). Every consumer that compares a POI/climb distance against the snapped position or looks it up in `cumulativeTime` must first convert raw → stitched.

Conversion currently happens in several places:

- `services/stitchingService.ts:stitchPOIs` — rewrites `distanceAlongRouteMeters` for the expanded POI list
- `store/climbStore.ts:getClimbsForDisplay` — rewrites `startDistanceMeters` / `endDistanceMeters` for climb display
- `components/map/POITabContent.tsx:starredUpcoming` — inline offset math for the starred compact list
- `components/map/POITabContent.tsx:InlinePOIDetail` — inline offset math for `distAhead`
- `components/map/ClimbHighlightLayer.tsx` — uses `distanceOffset` to locate climb on stitched geometry
- `components/elevation/ElevationProfile.tsx` — converts stitched climb back to local coords for rendering
- `store/etaStore.ts:getETAToPOI` — applies `segment.distanceOffsetMeters` before resolving ETA

Every new feature touching POIs/climbs has to make the same decision. Historically this has produced silent bugs when one site forgot the offset while its neighbors got it right — see `docs/known-issues.md` ("Two-coordinate-system fragility") and the refactor entry in `docs/ideas.md`.

### Climb Detection

Runs on import, stored per-route. Algorithm: smooth elevation (200m window), find rising segments with dip absorption (descent < 20% of accumulated gain), qualify (50m+ gain, 2.5%+ avg gradient). Difficulty: Climbbybike method (gradient² × length, summed). For stitched collections, cross-segment climbs are merged at display time.
