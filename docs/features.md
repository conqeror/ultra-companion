# Ultra Companion — Features

What's implemented. For the "why" behind these, see `usage-context.md`.

## Supported Surfaces

- iOS is the supported mounted riding app and native planning surface
- Web is a supported browser planning companion for importing, reviewing, editing, and exporting planning data
- Android project files support shared Expo/native build plumbing, but Android is not currently a supported runtime

## Map & GPS

- Full-screen Mapbox vector map with dark outdoor style for night riding
- On-demand GPS — position refreshes on app focus (if stale >10 min) or manual tap, no background polling
- Position age indicator when stale
- Heading-up / north-up toggle
- Floating map controls (center-on-user)
- Global riding horizon selector: 10km / 25km / 50km / 100km / 200km / FULL

## Routes

- Import GPX/KML via single or multi-select file picker, share sheet, or URL
- Multiple routes with distinct colors
- Route list with toggle visibility, set active, delete
- Route metadata: total distance, ascent, descent
- Route snapping — snap GPS position to nearest point on active route
- Point-assisted ferry crossings: tap a known boarding point, choose a nearby OSM ferry, or mark boarding and landing manually when offline
- Ferry crossings keep the stored imported route geometry intact while excluding water distance and elevation from riding metrics
- OSM-assisted crossings replace the displayed route span with the saved OSM ferry geometry; manual crossings retain the terminal-to-terminal fallback
- Saved Norwegian crossings can explicitly match their two terminals to Entur without scanning the rest of the route
- Entur-linked ferry names follow the saved route direction (`boarding – landing`) across maps, profiles, route details, and Upcoming

## Collections

- Group route segments into collections with ordered positions
- Variant auto-detection (alternative segments for the same position)
- Patch-style variants for subset routes that replace a confirmed slice of a base segment
- Stitching — selected segments concatenated into continuous view for all downstream features
- Drag-to-reorder segments, radio-button variant selection

## Elevation Profile

- Interactive chart with gradient color coding (green through red by steepness)
- Current position marker
- Pinch-to-zoom, tap to highlight on map
- Elevation profile follows the global riding horizon
- Segment boundary markers for stitched collections
- Ferry breaks are masked with a compact ship marker without adding water distance or elevation

## Upcoming Timeline

- ETA-first bottom-panel tab for important events in the selected riding horizon
- Shows starred and saved POIs, climbs, collection segment transitions, and route/collection finish
- Keeps V1 quiet by excluding unstarred POIs and category focus/search controls
- Uses the same 10km / 25km / 50km / 100km / 200km / FULL horizon as the ride view
- Displays clock ETA and riding time when available, with distance-first fallback when ETA is unavailable
- Includes POIs with planned stop durations even when unstarred, so downstream ETA shifts are visible
- Models climbs as one span row with start and end ETA when available
- Shows saved ferries in route order with quay ETA, readable stacked wait/crossing timing, and landing ETA
- For Entur-linked ferries, fetches the directional scheduled departure board for the ETA's service day once, persists it without expiry, and shows the next boardable scheduled departure/arrival; manual timing remains the quiet fallback
- Tapping an Entur-linked Upcoming ferry derives an inline view from the cached schedule with the previous departure when it was within one hour of the boardable ETA, the next five departures, the last departure that day, and the first departure the following morning

## Climb Detection

- Auto-detected from elevation data on import
- Smoothing, dip absorption, qualification (50m+ gain, 2.5%+ avg gradient)
- Difficulty scoring (Climbbybike method — gradient squared times length)
- Upcoming climbs list with distance, ETA, stats
- Climb tab defaults to climbs inside the selected riding horizon
- Current climb mode — auto-zooms elevation chart, shows progress to top
- Climb shading on elevation profile (colored by difficulty)

## POI Search

- Along-route search with configurable corridor width
- Categories: water, groceries, gas stations, bakery, toilets/showers, shelter/camping, pharmacy, bike shops/repair, other
- Two data sources: Overpass/OSM for water, WC, shelter, camping, and repair infrastructure; Google Places for groceries, gas stations, bakeries, pharmacies, and bike shops
- POI markers on map and elevation profile
- Riding view POI markers and lists are scoped to the selected riding horizon by default
- FULL horizon switches riding POI views to full-route planning
- POI list sorted by distance along route
- POI text search (filter by name)
- Starred POIs persisted in SQLite
- Saved custom POIs from iOS share sheet or manual coordinates, route-scoped and starred by default
- Planned stop duration presets on POI detail for rider-intended stop time
- Opening hours: current status in details, open/closed-at-ETA context in POI rows
- Category filters (multi-select)

## ETA Calculator

- Power-based speed model using cycling physics (power, weight, gradient, drag, rolling resistance)
- Terrain-aware — accounts for climbs, descents, flats
- Configurable: power output, total weight, advanced params (CdA, Crr, max descent speed)
- ETA displayed on POI cards, POI list items, and climb list
- Downstream ETAs include prior planned POI stop durations while preserving arrival ETA to the stop itself
- Ferry ETA skips cycling time on the water and applies boarding buffer, assumed wait, and crossing duration once at landing
- Fully offline — pure math on elevation data

## Weather

- Current weather at position
- Forecast at waypoints along route (~20km spacing)
- Weather timeline — conditions at estimated future positions within the selected riding horizon (uses ETA calculator)
- Route weather projections include prior planned POI stop durations
- Wind indicator: headwind/tailwind/crosswind relative to route direction
- Cached when online, shows "last updated" timestamp

## Offline Support

- Offline map tiles — download corridor along route at zoom 10–14
- Offline POI data — pre-fetched and cached in SQLite
- Download size estimator, progress UI, cancel/retry
- "Prepare for offline" per route/collection
- Storage management — space used per route, cleanup
- Imported/prepared route, POI, climb, ferry, ETA, collection, export, and tile data work offline; weather uses cached data when available and requires connectivity to refresh
- Entur stop matching and departure refresh require connectivity; linked stop IDs persist, while manual ferry wait/crossing timing stays fully offline

## Export

- Export standalone routes and stitched collections as GPX tracks
- Include starred and saved custom POIs as on-route GPX waypoint cues for bike-computer workflows
- Share exported GPX files through the native iOS share sheet
- Export and import the complete planning workspace, including saved ferry spans, as a versioned `.ultra-plan.db` file
- Move planning data between the browser workspace and iOS without requiring a hosted account or backend
