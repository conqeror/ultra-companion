# Ultra Companion Roadmap

Current issue priority and backlog order.

Last reviewed: 2026-04-27

## How To Use This

GitHub labels keep the issue list searchable. This document preserves exact backlog order and the reasoning behind it.

- `priority:p0` - race-readiness and trust issues; fix first.
- `priority:p1` - high-value next work once P0 is stable.
- `priority:p2` - important planned backlog work.
- `priority:p3` - later or opportunistic work.

When priorities change, update both:

1. The issue's `priority:*` label.
2. The ordered list below.

## Current Order

### P0 - Trust And Race Readiness

1. [#11 Clarify and harden offline data preparation](https://github.com/conqeror/ultra-companion/issues/11)
   Offline prep must be predictable before race day. Stuck download states or surprising data fetches are confidence killers.

2. [#12 Improve POI list correctness, distance context, and quick actions](https://github.com/conqeror/ultra-companion/issues/12)
   POIs are core to stop planning. If ordering, starring, or distance labels feel wrong, the app stops being trustworthy.

3. [#10 Disambiguate route progress on out-and-back and self-crossing routes](https://github.com/conqeror/ultra-companion/issues/10)
   Snapped route progress feeds POIs, climbs, ETA, weather, and profile. Wrong progress silently poisons everything downstream.

### P1 - High-Value Next Work

4. [#22 Add saved custom POIs from Google Maps](https://github.com/conqeror/ultra-companion/issues/22)
   Known, rider-vetted places from Google Maps should become route-aware Ultra POIs with ETA, opening-hours context, and offline availability.

5. [#16 Add simple average-speed ETA mode](https://github.com/conqeror/ultra-companion/issues/16)
   Makes ETA understandable without tuning CdA/CRR/power. Small enough to ship before larger workflow changes.

6. [#15 Support bulk import of multiple GPX/KML route files](https://github.com/conqeror/ultra-companion/issues/15)
   Reduces friction when preparing segmented races or collections.

7. [#14 Redesign collection segment management workflow](https://github.com/conqeror/ultra-companion/issues/14)
   Important for route prep, but larger and more design-heavy than bulk import.

8. [#13 Detect and surface important descents for safety and cold management](https://github.com/conqeror/ultra-companion/issues/13)
   Strong ultra-specific planning value. Can use existing elevation data and should work offline from the first version.

### P2 - Planned Backlog

9. [#17 Polish climb management: edit outside ride view, favorites, and filters](https://github.com/conqeror/ultra-companion/issues/17)
   Useful polish, but less urgent than trust, prep, ETA, and descent awareness.

10. [#18 Optimize long route and collection performance](https://github.com/conqeror/ultra-companion/issues/18)
    Promote earlier if real long routes are already sluggish. Otherwise optimize after workflows stabilize.

11. [#19 Add route surface type data from OSM](https://github.com/conqeror/ultra-companion/issues/19)
    Excellent planning feature, but it is a larger milestone touching offline fetch, storage, map, profile, and collections.

12. [#23 Support saved Google Places query presets along routes](https://github.com/conqeror/ultra-companion/issues/23)
    Useful for personal chain/search preferences like Decathlon, but best after saved custom POIs establish durable POI semantics.

### P3 - Opportunistic

13. [#5 Cleanup: consolidate route point downsampling and segmentation utilities](https://github.com/conqeror/ultra-companion/issues/5)
    Good cleanup when touching Overpass, Google Places, or offline route chunking.
