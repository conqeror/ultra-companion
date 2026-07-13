# Ultra Companion Roadmap

Current GitHub issue priority order and prioritization notes.

Last reviewed: 2026-07-13

## How To Use This

GitHub labels keep the issue list searchable. This document preserves backlog order and the reasoning behind it.

- `priority:p0` - race-readiness and trust issues; fix first.
- `priority:p1` - high-value next work once P0 is stable.
- `priority:p2` - important planned backlog work.
- `priority:p3` - later or opportunistic work.

When priorities change, update both:

1. The issue's `priority:*` label.
2. The ordered list below.

## Current Order

### P0 - Trust And Race Readiness

1. [#42 Harden route import atomicity and retry behavior](https://github.com/conqeror/ultra-companion/issues/42)
   A reported failed import must not leave hidden partial state, and transient share/deep-link failures must remain retryable. This is a direct trust issue during race preparation.

2. [#30 Improve night readability and ride-mode accessibility](https://github.com/conqeror/ultra-companion/issues/30)
   The app is feature-complete enough that readability is now the main race-readiness risk. The rider should not pay a squint tax at 2 AM.

### P1 - High-Value Next Work

3. [#43 Restore long-route memory guarantees after planner import and for collection variants](https://github.com/conqeror/ultra-companion/issues/43)
   Planner imports and collection variant overlays currently bypass parts of the metadata-first loading model from #18. Restore the memory guarantees before adding more long-route features.

4. [#13 Detect and surface important descents for safety and cold management](https://github.com/conqeror/ultra-companion/issues/13)
   Descents matter for cold, rain, braking risk, and stop timing. This adds ultra-specific terrain awareness without new online dependencies.

5. [#14 Redesign collection segment management workflow](https://github.com/conqeror/ultra-companion/issues/14)
   Collection prep is powerful but still action-heavy. Cleaner management lowers the chance of tired or rushed route-prep mistakes.

### P2 - Planned Backlog

6. [#44 Consolidate stitching implementation and prune dead code](https://github.com/conqeror/ultra-companion/issues/44)
   Remove the test-only stitching fork and confirmed dead surfaces before collection behavior evolves further.

7. [#17 Polish climb management: edit outside ride view, favorites, and filters](https://github.com/conqeror/ultra-companion/issues/17)
   Useful polish now that ride view has enough climb context. Keep editing/planning away from the riding surface where possible.

8. [#19 Add route surface type data from OSM](https://github.com/conqeror/ultra-companion/issues/19)
   High planning value for gravel/rough routes, but it is a larger data/storage/rendering milestone.

9. [#23 Support saved Google Places query presets along routes](https://github.com/conqeror/ultra-companion/issues/23)
   Useful for personal chain/search preferences after saved custom POIs established the durable POI model.

### P3 - Opportunistic

10. [#16 Add simple average-speed ETA mode](https://github.com/conqeror/ultra-companion/issues/16)
    Still valuable for understandability, but less urgent while the current power model is working and the feature set is otherwise stable.

11. [#29 Explore optional Live Activity for next logistics summary](https://github.com/conqeror/ultra-companion/issues/29)
    Worth researching after the Upcoming timeline, with battery and native complexity kept on a short leash.

## Recently Completed

- [#28 Upcoming ETA timeline](https://github.com/conqeror/ultra-companion/issues/28)
- [#22 Saved custom POIs from Google Maps](https://github.com/conqeror/ultra-companion/issues/22)
- [#18 Long route and collection performance](https://github.com/conqeror/ultra-companion/issues/18)
- [#15 Bulk GPX/KML import](https://github.com/conqeror/ultra-companion/issues/15)
- [#12 POI list correctness, distance context, and quick actions](https://github.com/conqeror/ultra-companion/issues/12)
- [#11 Offline data preparation hardening](https://github.com/conqeror/ultra-companion/issues/11)
- [#10 Route progress disambiguation](https://github.com/conqeror/ultra-companion/issues/10)
- [#5 Route sampling/segmentation utility cleanup](https://github.com/conqeror/ultra-companion/issues/5)
