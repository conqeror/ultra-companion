# Google Places for Gas Stations & Groceries

## Problem

OSM opening hours are often inaccurate or missing, especially for small businesses. Gas stations and groceries are the two categories where knowing open/closed status matters most during a race.

## Chosen Approach

Fetch gas stations and groceries directly from Google Places API instead of OSM. Other POI categories (water, bike shop, ATM, pharmacy, WC, shelter) stay on Overpass/OSM.

### Why Google-only for these two categories (not OSM + Google enrichment)

- No matching problem — get `place_id` + hours in a single response
- More reliable opening hours (user-reported + Google-verified)
- Richer data available (ratings, photos, busy times) if we want it later
- The alternative (OSM fetch → match to Google by coordinates) is fragile and costs more API calls

## Architecture

### Fetch flow

1. Route import triggers Overpass fetch for all non-Google categories (as today)
2. Separate Google Places fetch for gas_station + groceries (when online):
   - Sample points every ~8km along route
   - Nearby Search (Advanced SKU) with ~5km radius, `includedTypes: ["gas_station", "supermarket", "convenience_store", "grocery_store"]`
   - Include `opening_hours` in field mask — returned directly, no separate Place Details call needed
   - Deduplicate results by `place_id` (overlapping circles will return same POIs)
3. Store in SQLite alongside OSM POIs — same `POI` schema, `osmId` field repurposed or add `googlePlaceId`

### Cost estimate (1000km route)

| Step | Calls | SKU | Cost |
|------|-------|-----|------|
| Nearby Search (Advanced, includes hours) | ~125 | $35/1000 | ~$4.40 |

- Google gives $200/month free credit → ~45 route imports/month at zero cost
- Re-fetch before a race if data older than 30 days (ToS caching limit)

### Why single-pass is cheaper than discovery + details

| Approach | Calls | Cost |
|----------|-------|------|
| Nearby Search Advanced (hours included) | 125 | ~$4.40 |
| Nearby Search Basic + Place Details for ~150 unique POIs | 125 + 150 | ~$7.00 |

The $3/1000 bump from Basic → Advanced SKU is cheaper than the extra Place Details calls. Split approach only wins with extreme deduplication ratios (~10:1), which won't happen with 8km spacing.

## Implementation notes

- Need a Google Maps API key (restrict to Places API, iOS app bundle ID)
- Two fetch pipelines: Overpass for most categories, Google for gas/groceries
- POI classifier needs to handle Google Places types → app's `POICategory`
- Opening hours format differs from OSM (`opening_hours` tag) — Google returns structured `periods` array, need a parser/adapter
- Attribution: must display "Powered by Google" somewhere when showing Google-sourced POIs
- 30-day cache limit per Google ToS — track `fetchedAt` timestamp, flag stale data
