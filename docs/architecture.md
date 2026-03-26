# Ultra Companion — Technical Architecture

## 1. Technology Stack

### 1.1 Framework: React Native with Expo

**Choice:** React Native (via Expo) targeting iOS only.

**Rationale:**
- Existing developer experience with Expo + React Native — fastest path to MVP
- Expo provides managed build pipeline, OTA updates, and native module support via Expo Modules
- Rich ecosystem for maps, file handling, and storage
- TypeScript for type safety across the codebase
- Battery overhead vs native Swift is ~5-10% — acceptable since the expensive operations (GPS via Core Location, map rendering via Metal) are native code regardless of the wrapper

**Alternative considered:** Native Swift/SwiftUI — would give marginally better battery life and access to deferred location updates, but the development velocity tradeoff isn't worth it for a personal project. See `technology-evaluation.md` for detailed comparison.

### 1.2 Map Engine: Mapbox SDK

**Choice:** `@rnmapbox/maps` (Mapbox Maps SDK for React Native)

**Rationale:**
- Best-in-class offline support — `OfflineManager` + `TileStore` API for downloading tile regions, plus **predictive caching** that pre-fetches tiles along a route automatically
- **Mapbox Studio** — visual editor for creating cycling-optimized map styles (high contrast, surface types, reduced noise) without hand-editing JSON
- Superior documentation and ecosystem compared to MapLibre
- Free for personal use (25,000 free MAUs/month — we're 1 user)
- Vector tiles — smaller downloads, smooth zoom, fully styleable
- Built-in terrain and hillshade rendering

**Alternative considered:** MapLibre GL Native — free and open-source fork of Mapbox, but weaker offline APIs, no visual style editor, thinner documentation. Since Mapbox is free at our scale, there's no cost advantage to MapLibre. Apple MapKit was also evaluated but **disqualified** — no API for programmatic offline tile downloads.

### 1.3 Language & Runtime

| Layer | Technology |
|-------|-----------|
| Language | TypeScript (strict mode) |
| Runtime | React Native (Hermes engine) |
| Build system | Expo (dev builds — required for Mapbox native module) |
| State management | Zustand (lightweight, no boilerplate) |
| Local database | SQLite via `expo-sqlite` (for POI data, route metadata) |
| File storage | Expo FileSystem (for GPX files, tile caches) |
| Async storage | MMKV (`react-native-mmkv`) for preferences and small key-value data |

## 2. System Architecture

```
┌─────────────────────────────────────────────────────┐
│                   React Native App                   │
├──────────┬──────────┬───────────┬───────────────────┤
│  Map     │  Route   │  POI      │  ETA              │
│  View    │  Manager │  Search   │  Calculator       │
│          │          │  Engine   │                   │
├──────────┴──────────┴───────────┴───────────────────┤
│                  Core Services Layer                  │
├──────────┬──────────┬───────────┬───────────────────┤
│  GPS     │  Offline │  GPX/KML  │  Elevation        │
│  Service │  Manager │  Parser   │  Service          │
├──────────┴──────────┴───────────┴───────────────────┤
│                  Storage Layer                        │
├──────────┬──────────┬───────────────────────────────┤
│  SQLite  │  File    │  MMKV (preferences)           │
│  (POIs,  │  System  │                               │
│  routes) │  (tiles, │                               │
│          │  GPX)    │                               │
└──────────┴──────────┴───────────────────────────────┘
```

### 2.1 Key Modules

#### Map View Module
- Renders Mapbox GL map with offline tile packs
- Manages map layers: base map, route overlays, POI markers, user position
- Handles map interactions (pan, zoom, tap on POI)
- Provides heading-up / north-up toggle

#### Route Manager
- Parses GPX/KML files into internal route model
- Stores route data in SQLite
- Manages multiple routes (active, alternatives)
- Calculates route metadata (distance, elevation stats)
- Provides route-snapping: maps current GPS position to nearest point on active route

#### POI Search Engine
- Queries local SQLite database of POIs
- Spatial index for efficient "along the route" queries
- Filters by category, distance from route, opening hours
- Pre-fetches POI data from Overpass API (OpenStreetMap) during online preparation

#### ETA Calculator (Power-Based)
- Computes distance-along-route from current position to target POI/point
- **Power-based speed model** using cycling physics equation:
  ```
  P = (Crr × m × g × cos(θ) + 0.5 × ρ × CdA × v² + m × g × sin(θ)) × v
  ```
  - For each route segment: given gradient (θ) from elevation data, solve for velocity (v) at configured power
  - This is a cubic equation in v — solve numerically (Newton's method or bracketed bisection)
  - Sum segment times for total riding time to any point
- User-configurable inputs:
  - Power output (W) — rider's sustainable wattage
  - Total mass (kg) — rider + bike + gear
- Defaults for advanced parameters:
  - CdA = 0.4 m² (typical touring/bikepacking position)
  - Crr = 0.005 (typical road tire on asphalt)
  - Air density ρ = 1.225 kg/m³ (sea level, can optionally adjust for altitude)
  - Max descent speed = 60 km/h (safety cap)
  - Drivetrain efficiency = 0.97
- All computation is pure math on route elevation data — fully offline

#### GPS Service
- Background location tracking via `expo-location`
- Configurable update interval (battery vs accuracy tradeoff)
- Maintains current speed, heading, and position history
- Feeds into ETA calculator and route-snapping

#### Offline Manager
- Coordinates tile region downloads for loaded routes
- Downloads and caches POI data along route corridors
- Manages storage budget and cleanup of old data
- Provides download progress and size estimates

## 3. Data Models

### 3.1 Route

```typescript
interface Route {
  id: string;
  name: string;
  fileName: string;
  color: string;             // display color on map
  isActive: boolean;         // primary route for navigation
  isVisible: boolean;        // shown on map
  totalDistanceMeters: number;
  totalAscentMeters: number;
  totalDescentMeters: number;
  points: RoutePoint[];
  createdAt: string;         // ISO 8601
}

interface RoutePoint {
  latitude: number;
  longitude: number;
  elevationMeters: number | null;
  distanceFromStartMeters: number; // cumulative distance along route
  index: number;
}
```

### 3.2 POI

```typescript
interface POI {
  id: string;
  osmId: string;             // OpenStreetMap ID for deduplication
  name: string | null;
  category: POICategory;
  latitude: number;
  longitude: number;
  tags: Record<string, string>; // raw OSM tags (opening_hours, etc.)
  distanceFromRouteMeters: number;  // perpendicular distance to nearest route
  distanceAlongRouteMeters: number; // distance along route from route start
  nearestRouteId: string;
}

type POICategory =
  | 'water'
  | 'groceries'
  | 'gas_station'
  | 'cafe_restaurant'
  | 'accommodation'
  | 'bike_shop'
  | 'atm'
  | 'pharmacy'
  | 'toilet_shower';
```

### 3.3 User Position State

```typescript
interface UserPosition {
  latitude: number;
  longitude: number;
  altitude: number | null;
  heading: number | null;
  speed: number | null;         // m/s from GPS
  timestamp: number;
  snappedToRoute: {
    routeId: string;
    pointIndex: number;
    distanceAlongRouteMeters: number;
  } | null;
}
```

### 3.4 Power Model Configuration

```typescript
interface PowerModelConfig {
  powerWatts: number;            // rider's sustainable power output (e.g., 180)
  totalMassKg: number;           // rider + bike + gear (e.g., 95)
  // Advanced — sensible defaults provided
  cda: number;                   // aerodynamic drag area, default 0.4 m²
  crr: number;                   // rolling resistance coefficient, default 0.005
  airDensity: number;            // kg/m³, default 1.225 (sea level)
  maxDescentSpeedKmh: number;    // safety cap on downhill speed, default 60
  drivetrainEfficiency: number;  // default 0.97
}

interface ETAResult {
  distanceMeters: number;        // distance along route
  ridingTimeSeconds: number;     // predicted riding time (power model)
  eta: Date;                     // current time + riding time
  averagePredictedSpeedKmh: number; // for the segment
}
```

## 4. Offline Strategy

### 4.1 Map Tiles

Mapbox provides two complementary offline mechanisms:
- **`OfflineManager`** — download tile packs for defined regions at specified zoom levels
- **`TileStore` + predictive caching** — automatically pre-fetches tiles along a route geometry

**Strategy:**
1. When a route is imported, compute a bounding corridor (route + buffer, e.g., 10km each side)
2. Download vector tiles for zoom levels 6–15 (overview to street-level detail) via `OfflineManager`
3. Enable predictive caching along the route geometry for smart pre-fetching
4. Store in Mapbox's internal tile cache (SQLite-based)
5. Estimated size: ~50–150 MB per 1000 km route (vector tiles are compact)

### 4.2 POI Data

**Strategy:**
1. When online, query the **Overpass API** for POI data in the route corridor
2. Query structure: buffer the route polyline by corridor width, fetch all relevant OSM node/way types
3. Store results in local SQLite with spatial indexing (R-tree via SpatiaLite or manual geohash bucketing)
4. POI data is relatively small: ~1–5 MB for a 1000 km route corridor

**Overpass API query categories mapping:**

| App Category | OSM Tags |
|-------------|----------|
| Water | `amenity=drinking_water`, `natural=spring`, `man_made=water_tap` |
| Groceries | `shop=supermarket\|convenience\|grocery`, `shop=bakery` |
| Gas stations | `amenity=fuel` |
| Cafés & Restaurants | `amenity=cafe\|restaurant\|fast_food` |
| Accommodation | `tourism=hotel\|hostel\|motel\|guest_house\|camp_site` |
| Bike shops | `shop=bicycle`, `amenity=bicycle_repair_station` |
| ATMs | `amenity=atm\|bank` |
| Pharmacies | `amenity=pharmacy` |
| Toilets/Showers | `amenity=toilets\|shower` |

### 4.3 Elevation Data

- Primary: extract from GPX file (most GPX files from route planners include elevation)
- Fallback: if GPX lacks elevation, use **Open-Elevation API** (open-source) to enrich points during online preparation
- Elevation data stored as part of the route model — always available offline

### 4.4 Download Flow

```
User imports route
       │
       ▼
   ┌───────────────┐
   │ Parse GPX/KML │
   └───────┬───────┘
           │
           ▼
   ┌───────────────────────┐
   │ Calculate tile region  │
   │ + estimate size        │
   └───────┬───────────────┘
           │
           ▼
   ┌───────────────────────┐
   │ Prompt user:           │
   │ "Download ~120 MB for  │
   │  offline use?"         │
   └───────┬───────────────┘
           │ yes
           ▼
   ┌───────────────────────┐
   │ Download in parallel:  │
   │ • Map tiles            │
   │ • POI data (Overpass)  │
   │ • Elevation (if needed)│
   └───────┬───────────────┘
           │
           ▼
   ┌───────────────────────┐
   │ Ready for offline use  │
   └───────────────────────┘
```

## 5. Third-Party Services

| Service | Purpose | Cost | Offline? |
|---------|---------|------|----------|
| Mapbox Maps SDK | Map tiles, styling, offline | Free (25k MAU/mo) | Downloaded |
| Overpass API (OSM) | POI data | Free | Pre-fetched |
| Open-Elevation API | Elevation enrichment | Free | Pre-fetched |
| Open-Meteo API | Weather (Phase 2) | Free, no API key | Cached |

**Key principle:** Mapbox requires an access token but is free at our scale (1 user). All other services are free and open-source with no API keys required.

## 6. Project Structure

```
ultra/
├── app/                     # Expo Router screens
│   ├── (tabs)/
│   │   ├── map.tsx          # Main map screen
│   │   ├── routes.tsx       # Route list & management
│   │   └── settings.tsx     # App settings
│   ├── route/
│   │   └── [id].tsx         # Route detail / elevation profile
│   └── _layout.tsx
├── components/
│   ├── map/
│   │   ├── MapView.tsx
│   │   ├── RouteLayer.tsx
│   │   ├── POIMarkers.tsx
│   │   └── UserLocation.tsx
│   ├── elevation/
│   │   └── ElevationProfile.tsx
│   ├── poi/
│   │   ├── POIList.tsx
│   │   ├── POIDetail.tsx
│   │   └── POIFilters.tsx
│   └── common/
│       ├── BottomSheet.tsx
│       └── InfoBar.tsx
├── services/
│   ├── gps.ts               # Location tracking
│   ├── gpxParser.ts         # GPX/KML parsing
│   ├── routeManager.ts      # Route CRUD & calculations
│   ├── poiSearch.ts         # POI querying & Overpass API
│   ├── powerModel.ts        # Cycling physics: power → speed solver
│   ├── etaCalculator.ts     # ETA computation using power model
│   ├── offlineManager.ts    # Download orchestration
│   └── elevationService.ts  # Elevation data handling
├── store/
│   ├── routeStore.ts        # Zustand store for routes
│   ├── mapStore.ts          # Map state (center, zoom, etc.)
│   └── settingsStore.ts     # User preferences
├── db/
│   ├── schema.ts            # SQLite schema definitions
│   ├── migrations.ts        # Database migrations
│   └── queries.ts           # Typed query helpers
├── types/
│   └── index.ts             # Shared TypeScript types
├── utils/
│   ├── geo.ts               # Geo math (haversine, bearing, etc.)
│   ├── formatters.ts        # Distance, time, elevation formatting
│   └── colors.ts            # Route colors, gradient scale
├── constants/
│   └── index.ts             # POI categories, defaults, etc.
└── assets/
    └── poi-icons/           # Category icons
```

## 7. Key Technical Decisions

### 7.1 Why SQLite over AsyncStorage for POIs?
- Spatial queries ("find POIs within X meters of route") require indexed queries
- Thousands of POIs per route — AsyncStorage is key-value, not suitable for range queries
- SQLite supports R-tree indexes for efficient spatial lookups

### 7.2 Why Zustand over Redux/Context?
- Minimal boilerplate — important for a focused project
- Built-in support for persistence (via middleware)
- Excellent TypeScript support
- Small bundle size

### 7.3 Why Mapbox over MapLibre?
- Superior offline APIs: `OfflineManager` + `TileStore` + predictive caching along routes
- Mapbox Studio for visual map style editing (cycling-optimized styles without hand-editing JSON)
- Better documentation and more actively maintained React Native bindings
- Free at our scale (personal use, 1 user) — no cost disadvantage
- See `technology-evaluation.md` for full comparison

### 7.4 Why Expo over bare React Native?
- Simplified build and deployment pipeline
- `expo-location`, `expo-file-system`, `expo-sqlite` cover our native needs
- EAS Build handles native compilation without local Xcode complexity
- Dev builds required for Mapbox native module (Expo Go not sufficient)

### 7.5 Why React Native over native Swift? (iOS-only app)
- Existing developer expertise — fastest path to usable MVP
- Battery penalty is ~5-10%: GPS (Core Location) and map rendering (Metal) are native code regardless
- The main native-only advantage (deferred location updates) is a minor optimization
- Can always migrate to native later if the RN layer becomes a bottleneck
- See `technology-evaluation.md` for full analysis
