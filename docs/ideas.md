# Ideas

Dump for future feature ideas, UX improvements, and things to consider later.

## Next Up

### Phase 9 — Usability & Surface Data

**Quick wins:**
- Rename "races" → "collections" throughout the app (UI labels, code, types, stores, DB)
- POI text search — filter POI list by name (e.g., searching for a specific shop)

**Medium effort:**
- ETAs in POI list — show estimated riding time and ETA next to each POI in the list view (ETA calculator already exists from Phase 4a)
- Open GPX with app — register as a handler for `.gpx` files so the app appears in iOS share sheet / "Open with" menu, auto-import on open

**Larger scope:**
- Surface type (paved/unpaved) on map + elevation profile — query OSM `surface` tags along the route via Overpass, render as different line styles (e.g., dashed for gravel/unpaved) on both map and elevation chart

### POI Enhancements (remaining)
- Opening hours on map — dim closed POIs, highlight open ones (deferred — needs more thought on UX)

## UX Polish

### Fatigue Safety
- Move "Delete" buttons away from primary actions on route cards and race detail — a tired mis-tap at 3am shouldn't nuke your race. Options: require swipe-to-delete, move to an overflow menu, or add more spacing/visual separation from "Set Active"

### POI List
- ~~De-emphasize "off route" distance~~ — done: opening hours leads, off-route is smaller/lighter, hidden when <50m

### Map Controls
- ~~GPS age indicator ("25m ago") needs a background pill or container~~ — done

## Backlog

### POI
- Custom POI icons on the map (category-specific symbols instead of colored circles)
- POI clustering at low zoom levels to reduce visual clutter
- ~~Google Places for gas stations & groceries~~ — done, see `docs/google-places-plan.md`
- "View in Google Maps" action on POI detail — deep link to Google Maps for a POI's coordinates, zero API cost

### Map
- Accommodation POIs — add hotels/hostels/campsites from OSM via existing Overpass pipeline, plus a deep link to Booking.com search by coordinates when online. Booking.com API itself is not viable (requires affiliate programme, prohibits offline caching >24h)

### Planning
- Sleep planner — suggest optimal sleep stops based on route profile, accommodation POIs, and target daily distance (needs research on what inputs/heuristics make sense)
