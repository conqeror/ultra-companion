# Ideas

Future feature ideas and improvements.

## Next Up

### Surface Type Visualization
- Query OSM `surface` tags along route via Overpass
- Classify into paved/unpaved/unknown
- Render route line with different styles per surface (solid paved, dashed unpaved)
- Color-code elevation profile by surface type
- Surface legend in elevation panel
- Cache in SQLite alongside route data, fetch with "prepare for offline"

### Open GPX with App
- Register `.gpx` and `.kml` document types in app config
- Handle incoming URLs via `expo-linking`
- Auto-import and run existing pipeline, show confirmation

### Opening Hours on Map
- Dim closed POIs, highlight open ones (needs UX thought)

## UX Polish

### Fatigue Safety
- Move "Delete" buttons away from primary actions — a tired mis-tap at 3am shouldn't nuke a collection. Options: swipe-to-delete, overflow menu, or more spacing from "Set Active"

## Backlog

### POI
- Custom POI icons on map (category-specific symbols instead of colored circles)
- POI clustering at low zoom levels
- "View in Google Maps" action on POI detail — deep link, zero API cost
- Accommodation POIs — hotels/hostels/campsites from OSM, plus Booking.com deep link for online search

### Planning
- Sleep planner — suggest optimal sleep stops based on route profile, accommodation POIs, and target daily distance
