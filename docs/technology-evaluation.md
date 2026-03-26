# Ultra Companion — Technology Evaluation

## The Question

Given that the app is iOS-only, personal use, and battery life during multi-day races is critical — should we go native Swift/SwiftUI or stick with React Native + Expo?

## Options Evaluated

| # | Stack | Map Engine |
|---|-------|-----------|
| A | React Native + Expo | MapLibre GL Native |
| B | React Native + Expo | Mapbox SDK |
| C | Native Swift/SwiftUI | Mapbox SDK |
| D | Native Swift/SwiftUI | Apple MapKit |

---

## Detailed Comparison

### 1. Offline Map Downloads (Critical Requirement)

This is the make-or-break feature. You need to pre-download a corridor along a 1000+ km route before the race.

| Stack | Offline Capability |
|-------|-------------------|
| **MapLibre** | `OfflineManager` API — download tile packs for bounding boxes at specified zoom levels. Works well but documentation is thinner than Mapbox. |
| **Mapbox** | `OfflineManager` + newer `TileStore` API — download regions, monitor progress, set storage limits. Best-in-class offline support. The most battle-tested solution. Also supports **predictive caching** (pre-fetches tiles along a route automatically). |
| **Apple MapKit** | **No programmatic offline download API.** iOS caches tiles you've viewed, but you cannot pre-download a region. You'd have to scroll the entire route manually and hope the cache holds. **This disqualifies MapKit for our use case.** |

**Verdict:** Mapbox > MapLibre >>> MapKit. MapKit is out.

### 2. Battery Consumption

The big question: does native Swift meaningfully beat React Native for this app?

**Where battery actually goes in our app:**
- ~60% GPS radio (Core Location) — **identical** in native and RN (both call the same iOS API)
- ~25% Screen + GPU (map rendering) — **identical** (MapLibre/Mapbox both use Metal for rendering regardless of the wrapper)
- ~10% CPU (route calculations, UI updates) — **small advantage for native** (no JS bridge, no Hermes engine)
- ~5% Network (when online) — **identical**

**The JS bridge overhead:**
- React Native's new architecture (Fabric + JSI) eliminates the old async bridge for many operations
- Map rendering is entirely native — the RN layer just manages state/config
- GPS callbacks cross the bridge, but at 1-10 second intervals this is negligible
- Hermes engine running in background uses ~5-15 MB RAM and minimal CPU when idle

**Realistic battery difference: ~5-10% worse with RN vs native** for our use case. On a 20-hour riding day, that's maybe 30-60 minutes less battery life. Meaningful but not dramatic — and can be offset by GPS polling interval settings.

**Native iOS battery optimizations available in both:**
- `allowsBackgroundLocationUpdates` — works via `expo-location`
- `pausesLocationUpdatesAutomatically` — works via `expo-location`
- Significant location change monitoring — works via `expo-location`
- Deferred location updates — this is **native-only** (batch GPS updates while screen is off, reduces wake-ups). This is a real advantage for native but only matters during screen-off background tracking.

**Verdict:** Native wins on battery, but the margin is small for a map-heavy app where the expensive work (GPS, map rendering) is native code regardless.

### 3. Map Styling & Cycling-Specific Features

| Feature | MapLibre | Mapbox | MapKit |
|---------|----------|--------|--------|
| Custom map styles | Yes (JSON style spec) | Yes (Mapbox Studio — excellent visual editor) | Limited (MKMapConfiguration) |
| Cycling-specific layers | Manual via OSM data | Built-in cycling overlay | Apple cycling directions (not raw data) |
| Terrain/hillshade | Yes (with terrain tiles) | Yes (built-in terrain) | Yes (built-in) |
| Surface type rendering | Manual styling | Manual styling | No |
| Route overlay styling | Full control | Full control | Limited |

**Mapbox Studio** is a significant advantage — you can visually design a cycling-optimized map style (emphasize surface types, reduce visual noise, high contrast) without writing JSON by hand.

**Verdict:** Mapbox > MapLibre > MapKit for styling flexibility.

### 4. Developer Experience & Velocity

| Factor | RN + Expo | Native Swift |
|--------|-----------|-------------|
| Your existing experience | Strong (Expo + RN) | Would need to learn SwiftUI |
| Hot reload | Yes (fast refresh) | Xcode previews (decent but slower) |
| Build pipeline | EAS Build (managed) | Xcode only |
| Package ecosystem | npm (huge) | SPM (good but smaller) |
| GPX parsing libraries | `fast-xml-parser` + custom | Several Swift GPX libraries |
| Chart libraries | `victory-native`, `react-native-svg` | Swift Charts (native, excellent) |
| SQLite | `expo-sqlite` | GRDB.swift or native SQLite3 |
| Testing | Jest + React Native Testing Library | XCTest + SwiftUI previews |
| Time to MVP | Faster (known stack) | Slower (learning curve) |

**Verdict:** RN + Expo wins on velocity, especially given your existing experience. Native Swift has better native framework integration (Swift Charts, SwiftData) but the learning curve costs time.

### 5. Cost Analysis

**Mapbox pricing (as of 2025):**
- 25,000 free Monthly Active Users (MAUs) for Maps
- After free tier: ~$4/1,000 MAUs
- For personal use (1 user): **free forever**
- Offline tile downloads: included in the free tier
- Navigation SDK: separate pricing, but we don't need it

**MapLibre:** Free, open-source, no usage limits ever.

**Other paid services worth considering:**
- **Mapbox** for tiles + styling: Free at our scale, significantly better DX than MapLibre
- **Open-Meteo** for weather: Free, no API key, generous limits — no need to pay here
- **Overpass API** for POI data: Free — but if we want better reliability, a self-hosted Overpass instance on a small VPS (~$5/mo) avoids rate limits

**Verdict:** Mapbox is free for personal use and strictly better than MapLibre for our needs. No reason to avoid it.

---

## Recommendation Matrix

| Criteria | Weight | RN + MapLibre | RN + Mapbox | Native + Mapbox | Native + MapKit |
|----------|--------|:---:|:---:|:---:|:---:|
| Offline tile downloads | Critical | Good | **Excellent** | **Excellent** | **Fail** |
| Battery efficiency | High | Good | Good | **Very Good** | N/A |
| Dev velocity (for you) | High | **Excellent** | **Excellent** | Medium | Medium |
| Map styling / DX | Medium | Good | **Excellent** | **Excellent** | Poor |
| Long-term maintainability | Medium | Good | Good | Good | Good |
| Native iOS integration | Low | OK | OK | **Excellent** | **Excellent** |

## Final Recommendation: **React Native + Expo + Mapbox**

**Why:**

1. **Mapbox over MapLibre** — free at your scale, better offline APIs (predictive caching along routes), Mapbox Studio for style customization, better documentation. No downside.

2. **React Native over native Swift** — you already know the stack, and the battery penalty is ~5-10% (the expensive operations — GPS and map rendering — are native code regardless). The velocity gain is worth more than the marginal battery savings, especially for a personal project where iteration speed matters.

3. **If battery becomes a real problem later**, the most impactful optimizations are independent of the framework choice:
   - Reduce GPS polling interval when speed is stable
   - Lower map frame rate when not interacting
   - Use significant location change monitoring during breaks
   - These all work in React Native via expo-location and Mapbox APIs

### When to reconsider native Swift:
- If you find yourself fighting the RN ↔ Mapbox bridge for advanced features
- If real-world battery testing shows the JS overhead is worse than expected
- If you want this to become a long-term maintained product (native ages better)

---

## Updated Stack Decision

| Component | Previous | Updated | Reason |
|-----------|----------|---------|--------|
| Map engine | MapLibre | **Mapbox** | Free at our scale, better offline, better DX |
| Framework | React Native + Expo | **React Native + Expo** (unchanged) | Your experience + good enough battery |
| Tile source | OpenFreeMap | **Mapbox** (included) | Comes with Mapbox, no separate tile hosting |
| POI data | Overpass API | **Overpass API** (unchanged) | Best free option for OSM data |
| Weather | Open-Meteo | **Open-Meteo** (unchanged) | Free, no API key, good enough |
