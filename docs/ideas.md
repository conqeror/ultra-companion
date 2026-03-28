# Ideas

Dump for future feature ideas, UX improvements, and things to consider later.

## Next Up

### Stage 1: Route Collections + Stitching
See `docs/phase-6-route-collections.md` for detailed spec.
- Race as a route collection — group and order GPX segments as one race
- Route stitching — continuous elevation, stats, POI window across segments
- Drag-to-reorder segments

### Stage 2: POI Enhancements
- Star/highlight POIs — mark specific POIs where you actually plan to stop, so they stand out on the map and in the list
- Opening hours awareness — highlight POIs that are currently open, dim closed ones on the map

### Stage 3: Dark Outdoor Map Style
- Use Mapbox runtime style API to programmatically darken the outdoor-v12 base map (dim base layers, adjust label colors) so dark mode keeps contour/terrain detail instead of falling back to generic dark-v11

## Backlog

### POI
- Custom POI icons on the map (category-specific symbols instead of colored circles)
- POI clustering at low zoom levels to reduce visual clutter
- Cross-route POIs — show POIs from other routes when nearing the end of the current one (routes are often stitched from child segments, so the next route's POIs become relevant before you switch)

### Route Management
- Alternative segments — some parts of a race have route alternatives (e.g., mountain pass vs. valley). Support marking segments as alternatives to each other.

### Map
- Booking.com integration — pull accommodation availability/prices for POIs along the route (low priority)

### Planning
- Sleep planner — suggest optimal sleep stops based on route profile, accommodation POIs, and target daily distance (needs research on what inputs/heuristics make sense)
