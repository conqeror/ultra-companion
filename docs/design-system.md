# Ultra Companion — Design System

## 1. Design Philosophy

**Utilitarian instrument, not a lifestyle app.** Ultra Companion is a purpose-built tool for riders operating under extreme fatigue, in all lighting conditions, with gloved hands on aerobars. Every design decision serves one question: _does this help the rider make better decisions faster?_

Principles (in priority order):

1. **Glanceability** — key data readable in 1–2 seconds without interaction
2. **Clarity under fatigue** — high contrast, large type for data, obvious hierarchy
3. **Density with purpose** — show relevant data in context, hide everything else. No clutter, but no unnecessary taps either
4. **Calm interface** — the map is the hero. UI elements should feel grounded and quiet, not flashy
5. **Works at night** — dark mode is not an afterthought; it must be as carefully designed as light mode

---

## 2. Color System

### Design Rationale

The palette is warm (not sterile) to feel grounded alongside outdoor/terrain maps. The accent is teal — it complements topographic map greens without blending in, stays distinct from route overlay colors and elevation gradient colors (green → yellow → red), and maintains strong contrast in both light and dark modes.

### Light Mode

| Token           | Value     | Usage                           |
| --------------- | --------- | ------------------------------- |
| `background`    | `#F7F6F2` | App canvas (warm off-white)     |
| `surface`       | `#FFFFFF` | Cards, panels, bottom sheets    |
| `surfaceRaised` | `#FFFFFF` | Floating controls (map buttons) |
| `textPrimary`   | `#1C1A18` | Headings, primary data values   |
| `textSecondary` | `#6B6560` | Labels, secondary info          |
| `textTertiary`  | `#9C958E` | Placeholders, disabled text     |
| `border`        | `#E8E5E0` | Card borders, dividers          |
| `borderSubtle`  | `#F0EDE8` | Light separators                |

### Dark Mode

iPhone 15 Pro has OLED — use near-black base for battery efficiency, with very subtle warmth to match the light theme's character. Not pure `#000000` (too harsh for prolonged night use) but close enough for OLED benefit.

| Token           | Value     | Usage                         |
| --------------- | --------- | ----------------------------- |
| `background`    | `#0E0E0C` | App canvas                    |
| `surface`       | `#1C1B18` | Cards, panels                 |
| `surfaceRaised` | `#2A2924` | Floating controls             |
| `textPrimary`   | `#F0EDE8` | Headings, primary data values |
| `textSecondary` | `#9C958E` | Labels, secondary info        |
| `textTertiary`  | `#8A837C` | Placeholders, disabled        |
| `border`        | `#2A2924` | Card borders, dividers        |
| `borderSubtle`  | `#1C1B18` | Light separators              |

### Accent Colors (shared across modes)

| Token          | Value       | Usage                                            |
| -------------- | ----------- | ------------------------------------------------ |
| `accent`       | `#0D9488`   | Primary actions, selected tab, active states     |
| `accentLight`  | `#14B8A6`   | Dark-mode accent variant (brighter for contrast) |
| `accentSubtle` | `#0D94881A` | Accent backgrounds (10% opacity tint)            |

### Semantic Colors

| Token         | Light     | Dark      | Usage                             |
| ------------- | --------- | --------- | --------------------------------- |
| `positive`    | `#16A34A` | `#22C55E` | Completed, on-track               |
| `warning`     | `#D97706` | `#FBBF24` | Caution, approaching limit        |
| `destructive` | `#DC2626` | `#EF4444` | Delete, off-route                 |
| `info`        | `#0284C7` | `#38BDF8` | Informational, neutral highlights |

### Route Colors

Keep the existing set — they are distinct, high-contrast, and colorblind-accessible:

```
#E63946  red
#457B9D  steel blue
#2A9D8F  teal
#E9C46A  gold
#F4A261  sandy orange
#6A4C93  purple
#1D3557  navy
#264653  dark teal
```

### Elevation Profile Gradient

Green → yellow → orange → red for gradient severity. These are functional, not decorative:

| Grade  | Color               | Meaning    |
| ------ | ------------------- | ---------- |
| 0–2%   | `#22C55E` green     | Flat       |
| 2–4%   | `#EAB308` yellow    | Easy       |
| 4–6%   | `#F59E0B` amber     | Moderate   |
| 6–8%   | `#F97316` orange    | Firm       |
| 8–10%  | `#EF4444` light red | Steep      |
| 10–13% | `#DC2626` red       | Very steep |
| 13–17% | `#991B1B` dark red  | Severe     |
| 17%+   | `#7F1D1D` maroon    | Extreme    |

Downhills are always green regardless of steepness.

---

## 3. Typography

### Font: Barlow

**Why Barlow?** Designed with transportation signage as inspiration — optimized for quick legibility at speed, which maps directly to glancing at a phone on aerobars. Supports tabular figures (`tnum`) so data values like "112.5 km" → "112.6 km" don't cause layout jumping. Ships **Barlow Semi Condensed** for fitting more data into tight spaces (bottom panel stats, elevation labels).

| Style           | Family                | Weight         | Size | Usage                                         |
| --------------- | --------------------- | -------------- | ---- | --------------------------------------------- |
| `displayLarge`  | Barlow                | 600 (SemiBold) | 28   | Screen titles (Routes, Settings)              |
| `displayMedium` | Barlow                | 600 (SemiBold) | 22   | Section headers (Elevation Profile, Progress) |
| `dataLarge`     | Barlow Semi Condensed | 600 (SemiBold) | 24   | Primary data values (124.6 km, 894 m)         |
| `dataMedium`    | Barlow Semi Condensed | 500 (Medium)   | 18   | Secondary data values                         |
| `dataSmall`     | Barlow Semi Condensed | 500 (Medium)   | 14   | Tertiary data, chart labels                   |
| `bodyLarge`     | Barlow                | 400 (Regular)  | 17   | Route names, primary list text                |
| `bodyMedium`    | Barlow                | 400 (Regular)  | 15   | Descriptions, secondary text                  |
| `bodySmall`     | Barlow                | 400 (Regular)  | 13   | Captions, timestamps                          |
| `label`         | Barlow                | 500 (Medium)   | 13   | Button text, tab labels, badges               |
| `labelSmall`    | Barlow Semi Condensed | 500 (Medium)   | 11   | Unit labels (km, m), axis labels              |

All `data*` styles use tabular figures (`fontVariant: ['tabular-nums']` in RN).

### Ride-Mode Readability

Ride surfaces are optimized for a phone mounted on aerobars at night, after severe fatigue.

- Keep critical ride data at 14px or larger.
- Primary ride values should generally be 18-24px, use `font-barlow-sc-semibold`, and use tabular figures where React Native allows.
- Do not use opacity-reduced text for active ride data.
- Reserve `textTertiary` for disabled, placeholder, and decorative labels. Use `textSecondary`/`muted-foreground` or semantic colors for currently relevant metadata.
- Treat semantic color as an enhancement, not the only differentiator. Pair status colors with text, icons, size, or shape.
- Visible controls used while riding should be 48dp minimum where practical, not only expanded through hit slop.

### Font Files to Bundle

- `Barlow-Regular.ttf` (400)
- `Barlow-Medium.ttf` (500)
- `Barlow-SemiBold.ttf` (600)
- `Barlow-Bold.ttf` (700)
- `BarlowSemiCondensed-Medium.ttf` (500)
- `BarlowSemiCondensed-SemiBold.ttf` (600)

---

## 4. Spacing & Layout

### 8px Base Grid

| Token  | Value | Usage                                                          |
| ------ | ----- | -------------------------------------------------------------- |
| `xs`   | 4px   | Tight internal padding (within badges, between icon and label) |
| `sm`   | 8px   | Small gaps, compact list items                                 |
| `md`   | 12px  | Default internal card padding                                  |
| `base` | 16px  | Standard margin/padding, screen horizontal inset               |
| `lg`   | 20px  | Space between card groups                                      |
| `xl`   | 24px  | Section spacing                                                |
| `2xl`  | 32px  | Major section breaks                                           |
| `3xl`  | 48px  | Screen-level vertical padding                                  |

### Screen Layout

- **Horizontal inset**: 16px on both sides
- **Safe area**: Always respect device safe areas (Dynamic Island, home indicator)
- **Map screen**: Map fills entire screen edge-to-edge; UI elements float over it
- **List screens**: 16px horizontal inset, cards have 12px internal padding

### Touch Targets

- **Minimum**: 48 x 48dp (enforced — non-negotiable for gloved use)
- **Recommended**: 52 x 52dp for frequently-used controls
- **Map floating buttons**: 52 x 52dp with 12px gap between them
- **Tab bar items**: Full tab width, 52dp tap height
- **Spacing between tappable elements**: minimum 8px to prevent mis-taps

---

## 5. UI Stack

### React Native Reusables (RNR) + NativeWind

**Why this stack?**

- RNR: shadcn/ui ported to React Native — copy-paste accessible components, full ownership of code
- NativeWind: Tailwind CSS for RN — `dark:` prefix theming, design tokens in `tailwind.config.ts`
- Familiar Tailwind workflow, large ecosystem (theme generators, patterns)

**Theming architecture (three layers):**

1. **`global.css`** — CSS variables define light/dark HSL color values
2. **`tailwind.config.ts`** — maps variables to Tailwind classes (`bg-surface`, `text-primary`)
3. **`theme.ts`** — exports the same values as a TypeScript object for programmatic use

**Two styling contexts:**

- **UI components** (cards, buttons, badges, lists): use `className` with Tailwind classes
- **Map components** (Mapbox layers, SVG, Reanimated): import from `theme.ts` + `useColorScheme()`

```tsx
// UI component (route card, settings row, etc.)
<Card className="bg-surface dark:bg-surface-dark border-border">
  <Text className="text-primary font-semibold">Route name</Text>
</Card>;

// Map component (Mapbox layer, elevation SVG, etc.)
import { useColorScheme } from "nativewind";
import { THEME } from "@/theme";

const { colorScheme } = useColorScheme();
const t = THEME[colorScheme ?? "light"];
<Mapbox.LineLayer style={{ lineColor: t.accent }} />;
```

**RNR components used in this project:**

- Button, Card, Badge, Dialog, Select, Switch, Toggle, Progress, Separator, Tabs, Text

**Key dependencies added:**

- `nativewind`, `tailwindcss` v3
- `class-variance-authority`, `clsx`, `tailwind-merge`
- `lucide-react-native` (icons)
- `@rn-primitives/*` (per component, lightweight)

---

## 6. Component Patterns

### Cards

Used for route list items, stat groups, settings sections. Based on RNR `Card` component.

```
Light:                              Dark:
  bg-surface (#FFFFFF)                bg-surface-dark (#1C1B18)
  border border-border                border border-border-dark
  rounded-xl (12px)                   rounded-xl (12px)
  p-3 (12px)                         p-3 (12px)
```

### Floating Map Controls

Positioned top-right (away from left-hand Dynamic Island). Grouped vertically with 12px gap.

```
size: 52 x 52dp
rounded-xl (12px)
bg-surface/95 (95% opacity)
border border-border-subtle
icon: text-primary, 24px
active state: bg-accent, text-white
```

### Bottom Panel (Elevation / Data)

Slides up from bottom of map screen. Rounded top corners.

```
rounded-t-2xl (16px top corners)
bg-surface
border-t border-border
px-3 pt-3
```

The riding horizon selector floats above the bottom sheet and scopes all riding bottom-sheet content. Default state shows only the selected value (`50 km` or `FULL`); tapping it animates open to the full `10 / 25 / 50 / 100 / 200 / FULL` range row.

```
collapsed height: 48dp
expanded row height: 48dp
position: just above sheet top edge; right aligned when collapsed, full width when expanded
min touch target: 48dp
active: bg-accent, text-accentForeground
inactive: text-secondary
rounded-full (pill)
font: label
```

### Stat Boxes

Horizontal row of key metrics (distance, ascent, descent).

```
layout: flex-row, equal width, gap-2
alignment: items-center
value: dataLarge style, text-primary
unit/label: labelSmall style, text-secondary
no border/background — grouped visually by proximity
```

### Buttons

Based on RNR `Button` component with custom variants:

**Primary** (Import Route, main CTAs):

```
bg-accent text-white rounded-xl h-[52px] font-label
```

**Secondary** (Set Active, alternative actions):

```
bg-transparent text-accent border border-accent rounded-xl h-[44px]
```

**Destructive** (Delete):

```
bg-transparent text-destructive — text-only to de-emphasize
```

### Tab Bar

```
bg-surface/98 (slight translucency)
border-t border-border-subtle
icon: 24px, text-tertiary (inactive) / text-accent (active)
label: labelSmall, text-tertiary (inactive) / text-accent (active)
```

### Badges

Route color indicator (dot in route list):

```
w-3 h-3 rounded-full, filled with route color
```

Active route badge (RNR `Badge` component):

```
bg-accent/10 text-accent rounded-full px-2 py-0.5 font-labelSmall
```

---

## 7. Screen Patterns

### Map Screen (Primary)

The map takes 100% of the screen. Everything else floats.

- **Floating controls**: top-right corner, vertically stacked (center-on-user)
- **Bottom panel**: always visible, with tabs for Profile, Weather, Climbs, and POIs; the shared riding horizon selector floats just above it
- **No persistent HUD on map** — keep map clean. Data lives in the panel
- **Panel closed state**: map + floating buttons + bottom sheet tabs + collapsed horizon chip
- **Panel open state**: map compresses upward, panel takes bottom ~25% with route stats + elevation profile

### Route List Screen

- Scrollable list of route cards
- Each card: color dot + route name + stats row (distance, ascent, descent)
- Active route has accent-colored "Active" badge
- Swipe-left on card reveals Hide/Delete actions (not always-visible buttons)
- Import button: fixed at bottom of screen, primary style, full width with 16px inset
- Empty state: centered illustration/message + import button

### Route Detail Screen

- Back navigation (top-left)
- Mini map showing full route (16:9 aspect, rounded-xl)
- Stats row below map (distance, ascent, descent)
- Elevation profile section (same component as bottom panel, but full-width)
- Progress section (if active): completed / remaining

### Settings Screen

- Grouped sections with section headers (displayMedium)
- Toggle/selection rows: full-width, 52dp height
- Selected option: accent-tinted pill (not filled rectangle)
- Minimal — only settings that matter during a ride

---

## 8. Future Feature Design Alignment

### Phase 3: POI Search Along Route

- **POI markers on map**: Small, category-colored icons limited to the active riding horizon. Tap to expand detail.
- **POI list**: Bottom-sheet tab. Follows the active riding horizon; `FULL` is the planning mode for route-wide browsing. List items show: category icon + name + distance along route + ETA.
- **Category filter**: Horizontal scrollable chip row at top of POI panel. Chips use `label` style, accent when selected.
- **Quick summary on map**: Nearest POI of each critical category (water, food) shown as small floating tags near the route line.

### Phase 4: Power-Based ETA

- **ETA display**: Integrated into POI list items and route progress. Pattern: `23 km  ~1h 12m  ETA 14:35` using `dataMedium` for the value, `labelSmall` for units.
- **Parameters (power, weight)**: Settings screen section with numeric inputs. Not frequently changed — doesn't need to be prominent.
- **Offline download manager**: Settings or dedicated screen. RNR `Progress` component for download bar. Download size estimate in `bodyMedium`.

### Phase 5: Weather

- **Weather timeline**: Bottom-sheet tab scoped to the active riding horizon. Shows hourly rows with icon, temp, precipitation, and wind at estimated route positions.
- **Wind indicator**: Directional arrow icon near current position on map, colored by intensity (green = light, yellow = moderate, red = strong). Arrow shows direction relative to route heading (headwind/tailwind/crosswind).
- **Severe weather alert**: Full-width banner at top of screen in `warning` or `destructive` color. Persistent until dismissed. RNR `Alert` component.
- **"Last updated" badge**: Small timestamp near weather data since it requires connectivity. Uses `text-tertiary` / `labelSmall`.

---

## 9. Accessibility Notes

- All text meets WCAG AA contrast ratio (4.5:1 for body, 3:1 for large text) in both modes
- Route colors are distinguishable under common colorblind conditions (protanopia, deuteranopia)
- RNR components provide accessible primitives (focus management, ARIA roles) via `@rn-primitives`
- Interactive elements have visible focus indicators
- Data values use semantic color only as enhancement, never as sole differentiator
