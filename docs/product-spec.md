# Ultra Companion — Product Specification

## 1. Vision

A mobile companion app purpose-built for ultra-distance cycling races. It solves the unique navigation, logistics, and planning problems that riders face during multi-day, self-supported events — where connectivity is unreliable, decisions are made under fatigue, and access to basic resources (water, food, shelter) can be critical.

## 2. Target Users

### Primary Persona: Ultra-Distance Cyclist
- Participates in events like Transcontinental Race, Atlas Mountain Race, Silk Road Mountain Race, Indian Pacific Wheel Race, etc.
- Self-supported — no team car, must find resources independently
- Rides 200–400+ km/day for multiple consecutive days
- Operates under severe fatigue and sleep deprivation
- Needs large, glove-friendly touch targets and high-contrast UI
- Often in areas with no cell signal for hours or days
- Battery conservation is a top priority

### Secondary Persona: Bikepacking Enthusiast
- Multi-day touring on remote routes
- Similar needs but at a more relaxed pace
- May have more flexibility in route planning

## 3. Core Problems to Solve

| # | Problem | Impact |
|---|---------|--------|
| P1 | Finding resources (water, food, shops) along the route | Critical — running out of water in remote areas is dangerous |
| P2 | Knowing ETA to the next resource point | Critical — determines pacing and rationing decisions |
| P3 | Understanding upcoming terrain (elevation profile) | High — affects gear selection, pacing, and morale |
| P4 | Navigating the correct route | High — wrong turns cost time and energy |
| P5 | Working without internet connectivity | Critical — most race routes cross remote areas |
| P6 | Comparing route alternatives | Medium — choosing between options at decision points |
| P7 | Understanding weather ahead on the route | Medium — affects clothing, timing, and safety decisions |

## 4. Feature Specification

### 4.1 Map Display (MVP)
- Full-screen map with current GPS position
- Smooth pan, zoom, and rotation
- Map style optimized for cycling (show surface types, trails, elevation shading)
- High-contrast mode for sunlight readability
- Minimal UI chrome — maximize map area
- North-up and heading-up orientation modes

### 4.2 Route Management (MVP)
- **Import routes** from GPX and KML files
- Import via file picker, share sheet, or URL
- Display route as a colored overlay on the map
- Support **multiple loaded routes** simultaneously with distinct colors
- Route list panel to toggle visibility, reorder, and delete routes
- Show route metadata: total distance, total elevation gain/loss
- Highlight the active/primary route vs alternatives
- Snap current position to nearest route point for progress tracking

### 4.3 Elevation Profile (MVP)
- Interactive elevation profile chart for each loaded route
- Show current position on the profile
- Display: elevation, distance, gradient percentage
- Pinch-to-zoom on the profile to inspect segments
- Tap on profile to highlight corresponding point on map (and vice versa)
- Color-code gradient severity (green → yellow → red → purple)

### 4.4 POI Search Along Route (MVP)
- Search for POIs **along the route** (not radial search from a point)
- Configurable corridor width (e.g., within 500m / 1km / 2km of route)
- POI categories:
  - **Water** — drinking fountains, springs, taps
  - **Food/Groceries** — supermarkets, convenience stores, bakeries
  - **Gas stations** — often the only 24h option for water and food
  - **Cafés & Restaurants**
  - **Accommodation** — hotels, hostels, bivouac spots
  - **Bike shops & Repair**
  - **ATMs / Banks**
  - **Pharmacies**
  - **Toilets / Showers**
- Show POIs as icons on the map along the route
- POI detail view: name, type, opening hours (if available), distance from route, distance along route from current position
- Filter POIs by category (multi-select)
- Sort POIs by distance along route from current position

### 4.5 ETA to POIs & Route Points (MVP)
- **Power-based speed model** — predict speed for each route segment using cycling physics:
  - `Power = (rolling resistance + aerodynamic drag + gravity) × velocity`
  - Given rider's sustainable power output, solve for velocity on each gradient
  - Accounts for climbs (slow), descents (fast, capped at safe max), and flats accurately
- User-configurable parameters:
  - **Power output (W)** — sustained/target wattage (e.g., 180W)
  - **Total weight (kg)** — rider + bike + gear
  - **Advanced (with sensible defaults):** CdA (aerodynamic drag area), Crr (rolling resistance), max descent speed
- Display for each POI:
  - Distance remaining (along route)
  - Estimated riding time remaining (power-model predicted)
  - Estimated time of arrival
- Quick overview: "Next water in 23 km (~1h 12min, ETA 14:35)"
- Power model makes ETAs **terrain-aware**: a 23 km stretch with a 1500m climb gives a very different ETA than 23 km of flat road
- All computation is local (works offline) — just math on the elevation profile

### 4.6 Offline Support (MVP)
- **Offline map tiles**: Download map regions along the route with configurable buffer
- **Offline POI data**: Pre-fetch and cache POI data for the route corridor
- **Offline route data**: All loaded routes stored locally
- Download manager:
  - Estimate download size before starting
  - Show progress
  - Allow downloading by route (auto-calculate required tile regions)
- All core features (map, route display, elevation, POI search, ETA) must work fully offline
- Sync/update when connectivity returns

### 4.7 Weather Along Route (Advanced — Phase 2)
- Current weather at current position
- Weather forecast at key waypoints along the route
- Timeline view: weather conditions at estimated positions over next 12/24/48 hours
- Key data: temperature, precipitation probability, wind speed & direction, wind gusts
- Headwind/tailwind/crosswind indicator relative to route direction
- Severe weather alerts
- Requires connectivity — show "last updated" timestamp, cache last known data

## 5. Non-Functional Requirements

### 5.1 Performance
- App must launch to usable map in < 3 seconds
- Map interactions must be 60fps
- Battery usage: target < 5% per hour with GPS tracking active and screen off
- GPS position updates: configurable 1–10 second intervals

### 5.2 Offline-First Architecture
- All features except weather must work without any network connectivity
- App must gracefully handle transitions between online and offline states
- No loading spinners or errors when offline — data is either available locally or clearly marked as "not downloaded"

### 5.3 Usability Under Fatigue
- Minimum touch target size: 48x48dp
- High contrast text and icons
- Key information (next POI, ETA) accessible within 1 tap from map view
- No complex gestures required for core features
- Dark mode support (night riding)
- Configurable font size

### 5.4 Data Privacy
- No user account required for core features
- GPS data stays on device unless user explicitly exports
- No analytics tracking of routes or positions

## 6. MVP Scope

**In scope (Phase 1):**
- Map display with GPS tracking
- GPX/KML route import and display
- Multiple route support
- Elevation profile
- POI search along route (offline-capable)
- ETA calculations
- Offline map tiles and POI data
- Basic settings (units, speed calculation method)

**Out of scope (Phase 1):**
- Weather integration
- Route creation/editing within the app
- Social features / live tracking
- Turn-by-turn navigation with voice
- Integration with bike computers (ANT+/BLE sensors)
- Cloud sync between devices
- User accounts

## 7. Success Metrics

- App is usable for a full multi-day race without requiring connectivity
- All core information (next resource, ETA, route) accessible within 2 taps
- Battery drain does not exceed 5%/hour during active GPS use
- Route + offline data download completes in < 10 minutes for a 1000km route on WiFi
