# Ultra Companion — Product Specification

## 1. Vision

A mobile logistics companion for ultra-distance cycling races. It solves the resource planning and decision-making problems riders face during multi-day, self-supported events — where connectivity is unreliable, decisions are made under fatigue, and access to basic resources (water, food, shelter) can be critical.

**What this app is:** A logistics planning tool — where to stop, what's available, when does it close, what's the terrain ahead, what's the weather doing.

**What this app is NOT:** A navigation device or GPS tracker. Those are handled by a dedicated bike computer and race-provided tracker. See `docs/usage-context.md` for the full picture.

## 2. Target Users

### Target User: Ultra-Distance Cyclist
- Races 1,000–4,000 km solo unsupported (Transcontinental-style events)
- Rides ~18–19 hours/day, sleeps 4–5 hours, severe fatigue and sleep deprivation
- Bike computer handles navigation and ride stats; phone is for logistics planning
- Phone frequently in airplane mode to conserve battery (powerbanks shared with front light)
- Interacts with phone on aerobar mount while riding — needs glanceable info and large touch targets
- Often in areas with no cell signal for hours
- Plans stops around resource availability and opening hours

See `docs/usage-context.md` for detailed race conditions and decision-making patterns.

## 3. Core Problems to Solve

| # | Problem | Impact |
|---|---------|--------|
| P1 | Finding resources (water, food, shops) along the route | Critical — running out of water in remote areas is dangerous |
| P2 | Knowing ETA to the next resource point | Critical — determines pacing and rationing decisions |
| P3 | Understanding upcoming terrain (elevation profile) | High — affects pacing, stop planning, and morale |
| P4 | Knowing what's open and when it closes | High — grocery runs must happen before closing time; gas stations may be the only 24h option |
| P5 | Working without internet connectivity | Critical — most race routes cross remote areas; phone often in airplane mode |
| P6 | Seeing POIs in terrain context (on the elevation profile) | High — the core question is "what's between here and there, and how hard is the terrain" |
| P7 | Understanding weather ahead on the route | Medium — affects clothing, timing, and safety decisions |

## 4. Feature Specification

### 4.1 Map Display (MVP)
- Full-screen map with current position
- Smooth pan, zoom, and rotation
- Map style optimized for cycling (show surface types, trails, elevation shading)
- Minimal UI chrome — maximize map area
- **On-demand GPS**: position refreshes on app focus (if stale >10 min) or manual tap — no continuous background polling
- Position indicator shows last-known location with staleness hint when old

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
- **Show POIs on the elevation profile** — see resources in terrain context (what's between here and there)
- POI detail view: name, type, distance from route, distance along route from current position
- **Opening hours prominently displayed**: "Open now", "Closes at 20:00", "Closed" — critical for stop planning
- **Filter by "open now"** in addition to category filters
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

### 5.1 Performance & Battery
- App must launch to usable map in < 3 seconds
- Map interactions must be 60fps
- **Near-zero GPS battery cost**: no background polling — position acquired on-demand only (app focus or manual refresh)
- Battery budget assumes the phone shares powerbank capacity with the front light (critical for night riding) — every mAh counts

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

**In scope:**
- Map display with on-demand GPS position
- GPX/KML route import and display
- Multiple route support
- Elevation profile with POIs overlaid
- POI search along route with opening hours (offline-capable)
- Power-based ETA calculations
- Offline map tiles and POI data
- Basic settings (units, power model config)

**Out of scope:**
- Weather integration (Phase 5 — requires connectivity)
- Route creation/editing within the app
- Turn-by-turn navigation (bike computer handles this)
- GPS tracking / ride recording (dedicated tracker handles this)
- Integration with bike computers (ANT+/BLE sensors)
- Cloud sync between devices
- User accounts

## 7. Success Metrics

- App is usable for a full multi-day race without requiring connectivity
- All core information (next resource, ETA, route) accessible within 2 taps
- Negligible battery drain — no background GPS, no background processing
- Route + offline data download completes in < 10 minutes for a 1000km route on WiFi
- Can answer "where should I stop next?" in under 5 seconds
