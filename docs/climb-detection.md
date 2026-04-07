# Climb Detection

Automatically detect and surface climbs from route elevation data. Answers "what's the next climb, how long, how hard" — critical for pacing and mental preparation in ultra-distance racing.

## Features

1. **Climb detector** — runs on route import, stores detected climbs in SQLite
2. **Upcoming climbs list** — shows climbs ahead with distance, ETA, stats (like POI list)
3. **Current climb mode** — elevation chart zooms to the active climb, shows progress
4. **Climb naming** — user can name climbs (unnamed by default)

## Detection Algorithm

### Step 1: Smoothing

GPS elevation data is noisy. Before detection, apply a moving average over ~200m distance windows. This removes jitter without flattening real terrain features.

### Step 2: Rising Segment Detection

Walk the smoothed elevation profile and identify continuous rising segments. Short dips are absorbed into the climb rather than splitting it (see absorption rule below).

### Step 3: Qualification

A rising segment qualifies as a climb if it meets **both**:

| Criterion | Threshold | Rationale |
|---|---|---|
| Minimum elevation gain | ≥ 50m | Filters rolling terrain noise while catching meaningful hills in flat regions |
| Minimum average gradient | ≥ 2.5% | Distinguishes climbs from false-flats. At ~200W this is where you noticeably slow down |

No minimum length requirement — short steep ramps (50m gain at 8% = 625m) are worth knowing about, and long gentle climbs are caught by the gain threshold.

### Absorption Rule (Dip Tolerance)

When a dip (descent or flat) interrupts a rising segment, absorb it into the climb if:

- **Descent < 20% of the climb's accumulated gain so far**
- **Floor: 10m** — even small climbs absorb GPS noise

No cap — a big climb with a proportionally small dip is still one climb (e.g., 1500m climb absorbs a 300m valley).

Examples:
- 100m gain so far → absorbs dips up to 20m
- 500m gain so far → absorbs dips up to 100m
- 1500m gain so far → absorbs dips up to 300m

### Computed Properties Per Climb

| Property | Description |
|---|---|
| Start/end distance | Position along route (km) |
| Start/end elevation | Meters |
| Total ascent | Sum of all positive elevation changes within segment (captures internal rollers, not just net gain) |
| Length | Horizontal distance (m) |
| Average gradient | Total ascent / length |
| Max gradient | Steepest 200m window within the climb |
| Difficulty score | Sum of (gradient² × segment length) across all sub-segments — Climbbybike method |

### Edge Cases

- **Climb at route start/end** — allowed, no special handling
- **Back-to-back climbs** — if the valley between them exceeds the absorption threshold, they're separate climbs
- **Descending routes** — no climbs detected, correct behavior

## Storage

### SQLite Schema

```sql
climbs (
  id TEXT PRIMARY KEY,
  routeId TEXT REFERENCES routes(id) ON DELETE CASCADE,
  name TEXT,                    -- nullable, user-editable
  startDistanceMeters REAL,
  endDistanceMeters REAL,
  lengthMeters REAL,
  totalAscentMeters REAL,
  startElevationMeters REAL,
  endElevationMeters REAL,
  averageGradientPercent REAL,
  maxGradientPercent REAL,
  difficultyScore REAL
)

CREATE INDEX idx_climbs_route_distance ON climbs(routeId, startDistanceMeters);
```

Climbs are computed during route import and stored per-route.

### Collections (Stitched Routes)

Climbs are detected and stored **per-route only**. At stitch time, if the last climb of segment N and first climb of segment N+1 form a continuous climb (applying the absorption rule to the gap), they are merged into a single virtual climb for display. This keeps a single source of truth per route.

## Difficulty Score

Uses the **Climbbybike method**: sum of (gradient² × segment length) across all sub-segments of the climb. This penalizes steep sections quadratically — a 2km ramp at 12% scores much higher than 4km at 6%, even though the elevation gain is the same. This matches how hard climbs feel on tired legs.

The score is used for:
- **Color coding** — 3-tier color scale (yellow / orange / red) based on score thresholds
- **List display** — shown as a small numeric value (e.g., "difficulty: 47")

Thresholds (tuned against real route data):

| Score range | Color | Roughly |
|---|---|---|
| Low (< 150) | Yellow | Short or gentle |
| Medium (150–400) | Orange | Sustained effort |
| Hard (> 400) | Red | Major climb |

No formal cycling categories (HC, Cat 1-4) — the raw stats (gain, length, gradient) plus difficulty color tell the story.

## UI

### Upcoming Climbs List

Panel/sheet with scrollable list, same pattern as POI list. Shows climbs ahead + 1km behind current position.

Each list item:

```
┌──────────────────────────────────────────────────┐
│ [color] │ 847m ↑  ·  12.3 km  ·  6.9% avg       │  4.2 km ahead
│   bar   │ max 11.2%  ·  difficulty: 47            │  ETA 14:32
│         │ "Col du Galibier"  (if named)            │
└──────────────────────────────────────────────────┘
```

- Left: difficulty color bar
- Center: gain, length, avg gradient (primary line); max gradient, difficulty score (secondary); name if set
- Right: distance to start + ETA
- Tap: centers map on the climb, highlights on elevation chart

### Current Climb Mode

Auto-activates when snapped position enters a climb:
- Elevation chart zooms to show just the current climb (with padding)
- Progress header: **"423m ↑ remaining · 6.8 km to top · 5.2% avg"**
- Tapping the chart or a close button returns to full-route view
- Auto-deactivates when the climb ends

### Elevation Chart — Climb Shading

On the full-route view, detected climbs are shown as semi-transparent color fills (using difficulty color) between the elevation line and X-axis. Provides at-a-glance view of where the hard parts are.

In current-climb zoomed view, the existing gradient coloring handles it — no additional shading needed.
