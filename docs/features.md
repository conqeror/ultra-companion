# Ultra Companion — Features

What's implemented. For the "why" behind these, see `usage-context.md`.

## Map & GPS

- Full-screen Mapbox vector map with dark outdoor style for night riding
- On-demand GPS — position refreshes on app focus (if stale >10 min) or manual tap, no background polling
- Position age indicator when stale
- Heading-up / north-up toggle
- Floating map controls (center-on-user, panel mode)

## Routes

- Import GPX/KML via single or multi-select file picker, share sheet, or URL
- Multiple routes with distinct colors
- Route list with toggle visibility, set active, delete
- Route metadata: total distance, ascent, descent
- Route snapping — snap GPS position to nearest point on active route

## Collections

- Group route segments into collections with ordered positions
- Variant auto-detection (alternative segments for the same position)
- Stitching — selected segments concatenated into continuous view for all downstream features
- Drag-to-reorder segments, radio-button variant selection

## Elevation Profile

- Interactive chart with gradient color coding (green through red by steepness)
- Current position marker
- Pinch-to-zoom, tap to highlight on map
- Bottom panel modes: 10km / 25km / 50km / 100km / 200km upcoming
- Segment boundary markers for stitched collections

## Climb Detection

- Auto-detected from elevation data on import
- Smoothing, dip absorption, qualification (50m+ gain, 2.5%+ avg gradient)
- Difficulty scoring (Climbbybike method — gradient squared times length)
- Upcoming climbs list with distance, ETA, stats
- Current climb mode — auto-zooms elevation chart, shows progress to top
- Climb shading on elevation profile (colored by difficulty)

## POI Search

- Along-route search with configurable corridor width
- Categories: water, groceries, gas stations, bakery, toilets/showers, shelter
- Two data sources: Overpass/OSM for most categories, Google Places for gas stations and groceries (better opening hours)
- POI markers on map and elevation profile
- POI list sortable by distance along route
- POI text search (filter by name)
- Starred POIs
- Opening hours: open/closed status, color-coded, "open now" filter
- Category filters (multi-select)

## ETA Calculator

- Power-based speed model using cycling physics (power, weight, gradient, drag, rolling resistance)
- Terrain-aware — accounts for climbs, descents, flats
- Configurable: power output, total weight, advanced params (CdA, Crr, max descent speed)
- ETA displayed on POI cards, POI list items, and climb list
- Fully offline — pure math on elevation data

## Weather

- Current weather at position
- Forecast at waypoints along route (~50km spacing)
- Weather timeline — conditions at estimated future positions (uses ETA calculator)
- Wind indicator: headwind/tailwind/crosswind relative to route direction
- Cached when online, shows "last updated" timestamp

## Offline Support

- Offline map tiles — download corridor along route at zoom 6–15
- Offline POI data — pre-fetched and cached in SQLite
- Download size estimator, progress UI, cancel/retry
- "Prepare for offline" per route/collection
- Storage management — space used per route, cleanup
- All features except weather work fully offline
