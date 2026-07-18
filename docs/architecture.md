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
  pointCount: number;
  createdAt: string;
}

interface RouteWithPoints extends Route {
  points: RoutePoint[];
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
  | "camp_site"
  | "pharmacy"
  | "bike_shop"
  | "repair_station"
  | "pump_air"
  | "other";
```

### Starred Items

```typescript
type StarredEntityType = "poi";

interface StarredItem {
  entityType: StarredEntityType;
  entityId: string;
  createdAt: string;
}
```

Starred POIs are stored in SQLite in `starred_items`, not only in MMKV. The app still keeps an in-memory `starredPOIIds` set in `poiStore` for fast rendering and map/list reactivity. Existing MMKV `starredPOIIds` values are migrated into SQLite on app startup.

### Ferry Crossing

```typescript
interface FerryCrossing {
  id: string;
  routeId: string;
  name: string;
  startDistanceMeters: number;
  endDistanceMeters: number;
  durationMinutes: number;
  assumedWaitMinutes: number;
  boardingBufferMinutes: number;
  source: "manual" | "osm";
  timetableUrl: string | null;
  providerRefs: Record<string, string>;
}
```

Ferries are stored as raw, route-local spans in `ferry_crossings`. Terminal coordinates and source metadata are persisted with the fields above. `DisplayFerryCrossing` adds effective start/end distances for stitched collections without changing the imported `RoutePoint` geometry. For an OSM-assisted ferry, `providerRefs.osmGeometryV1` contains a JSON-encoded GeoJSON-order `[longitude, latitude][]` polyline capped at 2,048 points; invalid or missing metadata falls back to the snapped boarding-to-landing chord.

### Power Model

```typescript
interface PowerModelConfig {
  powerWatts: number;
  totalMassKg: number;
  cda: number; // default 0.4 m²
  crr: number; // default 0.005
  airDensity: number; // default 1.225 kg/m³
  maxDescentSpeedKmh: number; // default 50
  drivetrainEfficiency: number; // default 0.97
}
```

ETA computation: for each route segment, solve `P = (Crr × m × g × cos(θ) + 0.5 × ρ × CdA × v² + m × g × sin(θ)) × v` for velocity given gradient from elevation data. Cubic equation — Newton's method, 3-5 iterations.

## Offline Strategy

### Map Tiles

- Tile downloads are explicit: route/collection detail exposes map-tile-only actions and broader "Prepare for Offline" actions
- Native offline tile regions are downloaded along a downsampled LineString corridor
- Zoom range is 10–14 (`OFFLINE_MIN_ZOOM` / `OFFLINE_MAX_ZOOM`)
- Size estimate is intentionally rough at ~0.5 MB/km; actual Mapbox vector-tile size varies by terrain/city density

### POI Data

- Overpass API for OSM categories, Google Places for food/supplies, pharmacy, and bike shops
- Route split into ~50km segments for Overpass and Google queries; query polylines are downsampled to ~1km points
- POIs are associated to route distance during fetch, then stored in SQLite with route/source/category/distance indexes
- ~1–5 MB per 1000 km route corridor
- Saved custom POIs use `source: "custom"` and store notes, Google place IDs, and Google Maps links in `tags`. They can be created from the iOS share sheet or manual coordinates, and are not removed by clearing or refetching fetched OSM/Google data.
- Starred fetched/custom POIs are stored separately in SQLite so they persist across app restarts and can be exported.

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
| Entur APIs         | Norwegian ferry stops + departures      | Free, client header   |

## Supported Runtime Surfaces

- The iOS app is the supported mounted riding surface and owns native integrations such as share-sheet import/export, location, and Mapbox offline regions.
- The web build is a supported browser planning companion. It keeps a browser-local SQLite workspace and exchanges the full planning dataset through versioned `.ultra-plan.db` files.
- Android source and configuration are retained for shared Expo/native compatibility, but Android behavior is not part of the supported or tested product surface.

## Key Technical Decisions

### SQLite over AsyncStorage for POIs

POI data needs structured route/source/category/distance queries across thousands of records. AsyncStorage is key-value only and would make refresh/delete/source-state workflows awkward.

### Two POI sources (Overpass + Google Places)

OSM opening hours are often missing or wrong for the categories where open/closed matters most. Google Places has user-reported, verified hours for groceries, gas stations, bakeries, pharmacies, and bike shops. Infrastructure categories stay on Overpass (free, no API key, good coverage for water, toilets/showers, shelters, campsites, repair stands, and pumps).

### Point-assisted ferry crossings

Ferry discovery is deliberately local and user-triggered. After the rider taps a known boarding point, the app queries a small Overpass bounding box for `route=ferry` geometry, matches candidate endpoints to the imported route, and asks for confirmation. A two-tap manual path remains available offline and stores the same model.

Imported route points, snapping, and geometric distance remain unchanged. For OSM-assisted crossings, a validated and oriented copy of the OSM polyline is stored as versioned provider metadata and replaces only the corresponding map-display span; manual crossings fall back to their terminal endpoints. Map preparation keeps road and ferry pieces separate so long-route simplification cannot erase a short ferry curve. Ferry-aware helpers derive riding distance, elevation, profile coordinates, climbs, horizons, and ETA by excluding each water span. ETA then applies the boarding buffer, assumed wait, and crossing duration once at the landing boundary. Collection mapping only includes a crossing when its complete raw span belongs to one active source span, preventing a patch boundary from splitting and double-charging one ferry.

Recurring timetable rules are intentionally not modeled. A user can explicitly match the saved boarding and landing coordinates to nearby Entur water `StopPlace` records; their directional IDs and display names are stored as opaque `providerRefs` and provide the canonical `boarding – landing` display name. For each direction and `Europe/Oslo` service date, Upcoming requests one scheduled water departure board covering that day plus the following morning. Each boarding call is retained only when its downstream stop sequence contains the saved landing terminal. The resulting aimed departure/arrival times are persisted in MMKV without expiry and shared by concurrent consumers; no realtime fields are requested. The collapsed row selects the first departure after quay ETA plus boarding buffer, while the expanded row derives the previous departure within one hour, the next five, the last departure that day, and the first departure the following morning entirely from that cached schedule. Downstream route ETA remains deterministic from the saved boarding buffer, assumed wait, and crossing duration, which also remain the offline/error fallback.

### Collections and Stitching

Routes are stored individually. Collections reference routes via `collection_segments` table with position-based slots. At display time, selected segments are stitched (points concatenated with distance offsets). `RoutePoint[]` consumers (snapping, ETA cumulative time, weather, elevation rendering) receive the stitched array unchanged — their input is already in "stitched coords".

Collection variants can be either full-route variants or patch variants. A patch variant uses a shorter route to replace a confirmed distance range on a base route in the same collection position. Stitching resolves that selected variant into base prefix + patch route + base suffix, then exposes the result as the same stitched `RoutePoint[]` used everywhere else.

Patch-aware display data uses `StitchedSourceSpan` metadata. Each span records the source route, raw distance range, effective stitched range, and raw-to-stitched offset. POIs and climbs remain stored in raw per-route coordinates; collection display helpers include only items whose raw distances fall inside an active source span and apply that span's offset exactly once.

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

### GPX Export

Routes and stitched collections export as GPX 1.1 tracks. Starred POIs and saved custom POIs can be included as GPX `<wpt>` entries, but they are emitted as on-route cue points interpolated from `DisplayPOI.effectiveDistanceMeters`, not as an imported route-waypoint data model. The waypoint name keeps the POI name/category and off-route distance; the description keeps the actual POI coordinates and available notes/address context.

### Planning Database Transfer

The browser and iOS app exchange complete planning state through `.ultra-plan.db` files. Transport version 2 includes routes, points, collections, POIs, climbs, ferries, starred state, and planning metadata; version 1 files remain importable. Import replaces the destination planning workspace. It is a file-based offline workflow rather than account synchronization, so the transfer file should be treated as a snapshot rather than mergeable or continuously synced state.
