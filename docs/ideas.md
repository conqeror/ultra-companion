# Ideas

Parking-lot ideas that are not yet formal GitHub issues. Current prioritized work lives in `docs/roadmap.md`.

Last reviewed: 2026-05-07

## Planning

### Sleep Planner

Suggest rough sleep/accommodation windows from route profile, target daily distance, POI/accommodation data, and device-charging needs.

Potential first version:

- Pick a target riding block length or target stop time
- Show candidate towns/accommodation/camping options near that window
- Include ETA, closing/check-in caveats, terrain before/after, and weather context

## POIs

### Accommodation Search

Add a preparation-time accommodation workflow for hotels/hostels/campsites, likely with external deep links rather than a heavy booking integration.

Potential first version:

- Fetch OSM accommodation/campsite POIs where available
- Add `Open booking/search` external map/web action
- Keep accommodation out of noisy ride-mode defaults unless starred or explicitly focused

## Maybe Later

- Opening-hours state on map markers, but only if it improves decisions without making dense towns visually noisy
- Per-race setup profiles for default POI discovery groups, ETA assumptions, and preferred map visibility
