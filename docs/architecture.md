# Ultra Companion — Architecture

Stack and conventions are in `AGENTS.md`. This doc covers data models, offline strategy, and key technical decisions that aren't obvious from code.

## Data Models

For long-route performance notes and expected loading behavior, see
`docs/performance-notes.md`.

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
  idx: number;
}
```

### POI

```typescript
interface POI {
  id: string;
  sourceId: string;
  source: "osm" | "google" | "custom";
  name: string | null;
  category: POICategory;
  latitude: number;
  longitude: number;
  tags: Record<string, string>;
  distanceFromRouteMeters: number;
  distanceAlongRouteMeters: number;
  routeId: string;
}

type POICategory =
  | "water"
  | "groceries"
  | "gas_station"
  | "bakery"
  | "toilet_shower"
  | "shelter"
  | "other";
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
- Saved custom POIs use `source: "custom"` and store notes, Google place IDs, and Google Maps links in `tags`. They can be created from the iOS share sheet or manual coordinates, and are not removed by clearing or refetching fetched OSM/Google data.

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

OSM opening hours are often missing or wrong for gas stations and groceries — the two categories where open/closed matters most. Google Places has user-reported, verified hours. Other categories stay on Overpass (free, no API key, good coverage for water/bakery/toilet/shower/shelter).

### Collections and Stitching

Routes are stored individually. Collections reference routes via `collection_segments` table with position-based slots. At display time, selected segments are stitched (points concatenated with distance offsets). `RoutePoint[]` consumers (snapping, ETA cumulative time, weather, elevation rendering) receive the stitched array unchanged — their input is already in "stitched coords".

### Route Progress

`SnappedPosition.distanceAlongRouteMeters` is the authoritative rider progress value. Route snapping computes it from segment projection, so it may fall between imported route points. `SnappedPosition.pointIndex` is still returned as the nearest route point for geometry anchoring and array-based helpers, but consumers should derive indexes from `distanceAlongRouteMeters` when they need an index for slicing, ETA, weather, or elevation rendering.

Raw `SnappedPosition` is an internal store value. UI and service call sites should first resolve it through `utils/routeProgress.ts`, which returns branded `ActiveRouteProgress` only when the snap belongs to the active route or collection, is within the snap-distance threshold, and falls inside the active route's distance bounds. Active route/collection switches clear route progress (`snappedPosition` and snap history together) so stale progress cannot be reused while waiting for a fresh GPS fix.

**Two coordinate systems for POIs and climbs.** POIs and climbs are stored per-route with `distanceAlongRouteMeters` / `startDistanceMeters` relative to **their own route** ("raw coords"). When a collection is active, snapped position, `RoutePoint.distanceFromStartMeters`, and ETA `cumulativeTime` live in **stitched coords** (raw + `segment.distanceOffsetMeters`).

Displayed POIs and climbs use explicit display types:

- `DisplayPOI.effectiveDistanceMeters`
- `DisplayClimb.effectiveDistanceMeters`
- `DisplayClimb.effectiveStartDistanceMeters`
- `DisplayClimb.effectiveEndDistanceMeters`

Those fields use the branded `DisplayDistanceMeters` TypeScript type. This is compile-time only; it does not affect persisted data or runtime values. The intent is to make display/stitched distances explicit at call sites like ETA lookup, while raw route-local fields stay plain numbers because they come directly from persisted route data.

For standalone routes, effective distance equals raw distance. For collections, conversion is centralized at display-data boundaries: POIs through `services/stitchingService.ts:stitchPOIs` / `services/displayDistance.ts`, climbs through `store/climbStore.ts:getClimbsForDisplay` / `services/displayDistance.ts`. Components compare against snapped position and ETA using effective fields only; raw fields remain raw for persistence and route-local operations.

### Climb Detection

Runs on import, stored per-route. Algorithm: smooth elevation (200m window), find rising segments with dip absorption (descent < 20% of accumulated gain), qualify (50m+ gain, 2.5%+ avg gradient). Difficulty: Climbbybike method (gradient² × length, summed). For stitched collections, cross-segment climbs are merged at display time.
