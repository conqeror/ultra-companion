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

## Refactors

### Unify POI/climb coordinate space

- **Problem.** POIs and climbs carry raw (per-route) distances, but downstream code (snapped position, `cumulativeTime`, elevation profile) operates in stitched coords. Every consumer has to remember to apply `segment.distanceOffsetMeters`; missing one silently returns `null` or wrong values (see `docs/architecture.md` → Collections and Stitching for the full list of conversion sites).
- **Proposal.** Extend the POI/climb display types with an `effectiveDistanceMeters` field populated once — at stitch time for collections, equal to the raw distance for standalone routes. Every consumer reads that field; the raw↔stitched conversion exists in exactly one place (`stitchPOIs` / `getClimbsForDisplay`). `etaStore.getETAToPOI` collapses back to a one-liner.
- **Blockers.** Touches many call sites with no regression tests. Gate on the unit-test backlog (`docs/tests.md`) landing first, then refactor with a safety net.
