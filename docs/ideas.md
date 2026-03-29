# Ideas

Dump for future feature ideas, UX improvements, and things to consider later.

## Next Up

### Stage 2: POI Enhancements
- Star/highlight POIs — mark specific POIs where you actually plan to stop, so they stand out on the map and in the list
- Opening hours awareness — highlight POIs that are currently open, dim closed ones on the map

### Stage 3: Dark Outdoor Map Style
- Use Mapbox runtime style API to programmatically darken the outdoor-v12 base map (dim base layers, adjust label colors) so dark mode keeps contour/terrain detail instead of falling back to generic dark-v11

## UX Polish

### Fatigue Safety
- Move "Delete" buttons away from primary actions on route cards and race detail — a tired mis-tap at 3am shouldn't nuke your race. Options: require swipe-to-delete, move to an overflow menu, or add more spacing/visual separation from "Set Active"

### POI List
- De-emphasize "off route" distance — it's secondary info competing with POI name and ahead/behind distance. Make it smaller or lighter color so the actionable info (name, distance ahead, open/closed) dominates

### Map Controls
- GPS age indicator ("25m ago") needs a background pill or container — currently floats next to the weather button and looks unfinished. Should read as an intentional status element

## Backlog

### POI
- Custom POI icons on the map (category-specific symbols instead of colored circles)
- POI clustering at low zoom levels to reduce visual clutter

### Map
- Booking.com integration — pull accommodation availability/prices for POIs along the route (low priority)

### Planning
- Sleep planner — suggest optimal sleep stops based on route profile, accommodation POIs, and target daily distance (needs research on what inputs/heuristics make sense)
