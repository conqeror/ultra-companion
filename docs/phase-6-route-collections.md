# Phase 6: Route Collections + Stitching

**Goal:** Group GPX segments into a race with ordered positions and optional variants. Stitch selected segments into a continuous view — elevation, stats, POIs, GPS snapping — so the rider interacts with one unified race instead of individual files.

---

## 1. Concepts

### Race
An ordered collection of GPX segments representing one event (e.g., "Transcontinental 2026"). A race has **positions** (slots in the sequence). Each position holds 1 or more route **variants**. One variant per position is **selected**. The stitched view uses only selected variants.

### Position
A numbered slot in the race sequence (0, 1, 2, ...). Positions with a single route are straightforward segments. Positions with multiple routes represent alternatives (e.g., mountain pass vs. valley).

### Stitched View
At runtime, concatenate the points of all selected segments in position order. Adjust `distanceFromStartMeters` by adding cumulative offsets so the entire race reads as one continuous route. All existing components (elevation profile, POI list, ETA, GPS snapping) consume this stitched array unchanged.

---

## 2. Data Model

### New Tables

```sql
CREATE TABLE IF NOT EXISTS races (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  isActive INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS race_segments (
  raceId TEXT NOT NULL,
  routeId TEXT NOT NULL,
  position INTEGER NOT NULL,
  isSelected INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (raceId, routeId),
  FOREIGN KEY (raceId) REFERENCES races(id) ON DELETE CASCADE,
  FOREIGN KEY (routeId) REFERENCES routes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_race_segments_race_pos
  ON race_segments(raceId, position);
```

**Constraints:**
- Exactly one `isSelected = 1` per `(raceId, position)` — enforced in application code
- A route can belong to multiple races (same GPX reused across events)
- Deleting a race cascades to `race_segments` but does **not** delete the underlying routes
- Deleting a route cascades its `race_segments` rows (race loses that segment)

### New Types

```typescript
interface Race {
  id: string;
  name: string;
  isActive: boolean;
  createdAt: string;
}

interface RaceSegment {
  raceId: string;
  routeId: string;
  position: number;
  isSelected: boolean;
}

// Runtime — computed by stitching service, not stored
interface StitchedRace {
  raceId: string;
  points: RoutePoint[];
  segments: StitchedSegmentInfo[];
  totalDistanceMeters: number;
  totalAscentMeters: number;
  totalDescentMeters: number;
}

interface StitchedSegmentInfo {
  routeId: string;
  routeName: string;
  position: number;
  startPointIndex: number;  // index in stitched points array
  endPointIndex: number;
  distanceOffsetMeters: number;  // cumulative distance of all previous segments
  segmentDistanceMeters: number;
  segmentAscentMeters: number;
  segmentDescentMeters: number;
}
```

### Active Context Change

Currently: `routes.isActive` flag — one route at a time.

New: either a race or a standalone route can be active, never both.
- Setting a race active: `races.isActive = 1`, all `routes.isActive = 0`
- Setting a standalone route active: all `races.isActive = 0`, `routes.isActive = 1` on that route
- The store exposes the active context uniformly: a `RoutePoint[]` array and metadata, regardless of whether it's a race or a solo route

---

## 3. Stitching Service

### `services/stitchingService.ts`

Core function: given a race ID, load all selected segments in position order, concatenate points with cumulative distance offsets.

```
stitchRace(raceId):
  1. Query race_segments WHERE raceId AND isSelected = 1, ORDER BY position
  2. For each segment, load route + points from DB
  3. cumulativeDistance = 0
  4. For each segment in order:
     a. Copy points, add cumulativeDistance to each point's distanceFromStartMeters
     b. Re-index points sequentially (0, 1, 2, ... across all segments)
     c. Record segment metadata (startIndex, endIndex, offset)
     d. cumulativeDistance += segment.totalDistanceMeters
  5. Sum total distance, ascent, descent across selected segments
  6. Return StitchedRace
```

### Segment boundary handling

GPX files from race organizers may have small gaps or overlaps at segment boundaries (the end of segment N might not exactly match the start of segment N+1). The stitcher should:
- **Not** attempt to close gaps — the route lines may be intentionally different files
- Carry cumulative distance across seamlessly (segment N+1 starts where N ended distance-wise)
- On the map, each segment renders as its own line layer (small gaps are visually fine at race scale)

### POI stitching

```
stitchPOIsForRace(raceId, stitchedRace):
  1. For each segment in stitchedRace.segments:
     a. Load POIs for segment's routeId
     b. Offset each POI's distanceAlongRouteMeters by segment.distanceOffsetMeters
     c. Set POI's nearestRouteId to the segment's routeId (unchanged)
  2. Concatenate all POIs, sort by adjusted distanceAlongRouteMeters
  3. Return unified POI list
```

### GPS snapping across segments

```
snapToRace(position, stitchedRace):
  1. For each segment, snap position to that segment's route (existing snap logic)
  2. Pick the segment with the smallest perpendicular distance
  3. Return SnappedPosition with:
     - routeId: winning segment's routeId
     - pointIndex: index in the stitched points array (not the segment-local index)
     - distanceAlongRouteMeters: segment-local distance + segment's offset
     - distanceFromRouteMeters: perpendicular distance
```

---

## 4. Store Changes

### `store/raceStore.ts` (new)

```typescript
interface RaceState {
  races: Race[];
  // Stitched data for the active race (null if a standalone route is active)
  activeStitchedRace: StitchedRace | null;

  loadRaces: () => Promise<void>;
  createRace: (name: string) => Promise<string>;  // returns race ID
  deleteRace: (id: string) => Promise<void>;
  renameRace: (id: string, name: string) => Promise<void>;

  // Segment management
  addSegment: (raceId: string, routeId: string, position: number) => Promise<void>;
  addVariant: (raceId: string, routeId: string, position: number) => Promise<void>;
  removeSegment: (raceId: string, routeId: string) => Promise<void>;
  selectVariant: (raceId: string, routeId: string) => Promise<void>;
  reorderSegments: (raceId: string, fromPosition: number, toPosition: number) => Promise<void>;

  // Activation
  setActiveRace: (id: string) => Promise<void>;

  // Stitching
  loadStitchedRace: (id: string) => Promise<StitchedRace>;
  getRaceSegmentsWithRoutes: (id: string) => Promise<RaceSegmentWithRoute[]>;
}

interface RaceSegmentWithRoute {
  segment: RaceSegment;
  route: Route;
}
```

### `store/routeStore.ts` changes

- `setActiveRoute` must also deactivate any active race
- New helper: `getActiveRoutePoints()` — returns stitched points if a race is active, or solo route points if a standalone route is active. This is the single source of truth for the map, elevation panel, GPS snapping, and ETA.

---

## 5. UI

### Routes Tab — Add Races Section

The routes screen gains a "Races" section above the route list.

```
┌─────────────────────────────────┐
│  Races                          │
│  ┌───────────────────────────┐  │
│  │ 🏁 Transcontinental 2026  │  │
│  │ 3,840 km · ↑ 42,500 m    │  │
│  │ 18 segments · [Active]    │  │
│  └───────────────────────────┘  │
│                                 │
│  + Create Race                  │
│                                 │
│  ─── Routes ───────────────── │
│  (existing route cards below)   │
└─────────────────────────────────┘
```

- Race card shows: name, stitched total distance/ascent, segment count, Active badge
- Tap → race detail screen
- "Create Race" button → prompt for name, then navigate to race detail

### Race Detail Screen — `app/race/[id].tsx`

```
┌─────────────────────────────────┐
│  ← Races    Transcontinental    │
├─────────────────────────────────┤
│  [Mini map showing all segments]│
├─────────────────────────────────┤
│  3,840 km    ↑ 42,500 m        │
│  Distance    Ascent             │
├─────────────────────────────────┤
│  Segments                       │
│                                 │
│  1. Geraardsbergen → Alps       │
│     412 km · ↑ 3,200 m         │
│                                 │
│  2. Alps crossing          [2]  │ ← [2] = 2 variants badge
│     ● Col du Galibier           │ ← selected (accent dot)
│       187 km · ↑ 4,100 m       │
│     ○ Mont Cenis tunnel         │ ← unselected (hollow dot)
│       162 km · ↑ 2,800 m       │
│     Galibier: +25 km, +1,300 m ↑│ ← delta vs cheapest
│                                 │
│  3. Alps → Istanbul             │
│     3,241 km · ↑ 35,200 m      │
│                                 │
│  [+ Add Segment]                │
├─────────────────────────────────┤
│  Elevation Profile              │
│  [stitched elevation chart]     │
│  (segment boundaries as thin    │
│   vertical lines)               │
├─────────────────────────────────┤
│  POIs · Offline                 │
│  (same sections as route detail │
│   but operating on stitched     │
│   data)                         │
├─────────────────────────────────┤
│  [Set Active]  [Delete Race]    │
└─────────────────────────────────┘
```

**Segment list interactions:**
- Long-press + drag to reorder positions
- Tap a variant to select it (updates stitched stats/elevation live)
- Swipe a segment to remove it from the race
- "+ Add Segment" → picker showing imported routes not yet in this race, with option: "New position" or "Variant of position X"

**Variant display:**
- Positions with 1 route: simple row
- Positions with 2+ routes: expanded group showing all variants. Selected variant has filled accent dot, others have hollow dot. Show delta stats (distance/ascent difference vs. selected or vs. shortest).

### Elevation profile segment markers

On the stitched elevation profile, show thin vertical dashed lines at segment boundaries. Optional: subtle label with segment name at the top of each boundary line. This helps the rider orient within the race ("I'm in segment 2 of 18").

### Add Segment Flow

1. Tap "+ Add Segment" on race detail
2. Bottom sheet lists all imported routes (with search/filter)
3. Each route shows: name, distance, ascent. Routes already in this race are dimmed.
4. Tap a route → "Add as new position" (appended at end) or "Add as variant of position X" (shows list of existing positions)
5. Sheet closes, segment list updates

### Map screen with active race

- All selected segments render as line layers in position order (same color — they're one race)
- GPS snaps across all segments
- Bottom panel elevation/stats use the stitched data
- POIs from all segments shown on map and in lists with stitched distances

---

## 6. Implementation Steps

### Step 1: Data layer
- Add `races` and `race_segments` tables to `db/database.ts`
- Add DB functions: CRUD for races, segment add/remove/reorder/select
- Add new types to `types/index.ts`
- Migration: existing DB gets new tables on app launch (CREATE IF NOT EXISTS)

### Step 2: Stitching service
- Create `services/stitchingService.ts`
- `stitchRace()` — concatenate selected segment points with distance offsets
- `stitchPOIsForRace()` — offset POI distances
- Unit test stitching logic with synthetic data

### Step 3: Race store
- Create `store/raceStore.ts`
- Implement all race CRUD + segment management + stitching
- Wire up active context: race vs. standalone route

### Step 4: Active context integration
- Update `routeStore.setActiveRoute` to deactivate races
- Create a shared hook or store selector: `useActiveRouteData()` that returns stitched points regardless of whether a race or route is active
- Update consumers: map screen, bottom panel, GPS snapping, ETA calculator, weather

### Step 5: Race list UI
- Add races section to `app/(tabs)/routes.tsx`
- Race card component with stitched stats
- "Create Race" flow (name prompt → navigate to detail)

### Step 6: Race detail screen
- Create `app/race/[id].tsx`
- Mini map with all selected segments
- Stitched stats
- Segment list with variant display
- Elevation profile with segment boundary markers

### Step 7: Segment management UI
- Add segment picker (bottom sheet with route list)
- "New position" vs. "variant of position X" flow
- Variant selection (tap to switch)
- Remove segment (swipe)

### Step 8: Drag-to-reorder
- Add drag-to-reorder on segment positions
- Update position values in DB on reorder
- Recompute stitched data after reorder

### Step 9: Map + panel integration
- Active race renders all selected segments on map
- GPS snapping works across segments
- Bottom panel uses stitched data
- POIs from all segments in unified list

---

## 7. Edge Cases

- **Empty race** (no segments yet): show empty state with "Add Segment" prompt
- **Single segment race**: works identically to a standalone route
- **Deleting a route that's in a race**: cascade removes the segment; if it was the only variant at that position, the position is removed and remaining positions renumber
- **All variants at a position removed**: position disappears, positions renumber
- **Switching variant**: recompute stitched data, update stats/elevation/POIs live
- **Segment gaps on map**: fine — at race scale (thousands of km), small gaps between GPX files are invisible
- **Segment order with large position gaps**: normalize positions to 0, 1, 2, ... on every mutation (no sparse numbering)
- **POIs fetched per-segment**: each segment's POIs are fetched independently (existing per-route fetch). Stitching combines them at display time.
- **Offline tiles**: each segment can be downloaded independently (existing per-route download). Race detail shows aggregate offline status.

---

## 8. What Doesn't Change

- **GPX/KML parser** — unchanged, routes are imported the same way
- **ElevationProfile component** — receives `RoutePoint[]`, works with stitched points without modification
- **POI fetcher** — still fetches per-route, stitching is a display-time concern
- **Power model / ETA calculator** — operates on `RoutePoint[]`, stitched array works as-is
- **Offline tile downloader** — operates per-route, race just shows aggregate status
- **Weather service** — uses active route points, which now may be stitched
