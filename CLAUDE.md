# Ultra Companion

Logistics companion app for ultra-distance cycling races. iOS only, personal use. Not a navigation device or GPS tracker — those are handled by dedicated bike computer and race tracker. This app answers: where to stop, what's available, when does it close, what's the terrain, what's the weather.

## Docs

- `docs/usage-context.md` — **read first** — how the app is used during races, decision-making patterns, device setup
- `docs/features.md` — what's implemented
- `docs/architecture.md` — data models, offline strategy, key technical decisions
- `docs/ideas.md` — future feature ideas
- `docs/design-system.md` — colors, typography, component patterns
- `docs/known-issues.md` — bugs and warnings

## Stack

- React Native + Expo (dev builds, not Expo Go)
- TypeScript (strict)
- Mapbox GL (`@rnmapbox/maps`) — map rendering + offline tiles
- NativeWind v4 + Tailwind CSS v3 — styling + dark mode
- React Native Reusables — accessible UI components (`components/ui/`)
- Expo Router — file-based navigation
- Zustand — state management
- SQLite (`expo-sqlite`) — POI and route storage
- MMKV (`react-native-mmkv`) — preferences

## Key Design Principles

1. **Offline-first** — all core features must work in airplane mode
2. **Near-zero battery cost** — on-demand GPS only (no background polling), phone shares powerbank with front light
3. **Fatigue-friendly UI** — minimum 48dp touch targets, high contrast, key info within 1 tap
4. **Simple over clever** — this is a personal tool, not a product. Ship working features, iterate later.

## Code Conventions

- `@/` imports for non-siblings, relative `./` for siblings only
- Components: `export default function PascalName()`, PascalCase filenames
- Stores, services, utils: named exports, camelCase filenames
- Types centralized in `types/index.ts`; use `import type` where possible
- Zustand stores: explicit state interface, `create<Interface>((set, get) => ({...}))`
- Lint with `oxlint`, format with `oxfmt` (both from the oxc toolchain); TypeScript strict mode is the primary guardrail

### Styling (two contexts)

- **UI components** (cards, buttons, lists, settings): NativeWind `className` with Tailwind classes. Use `cn()` from `@/lib/cn` for conditional merging. Dark mode via `dark:` prefix — automatic.
- **Map/SVG/Reanimated components** (Mapbox layers, elevation SVG, animated styles): `useThemeColors()` from `@/theme` for programmatic color access. These components can't use `className`.
- Design tokens defined in three places kept in sync: `global.css` (CSS vars), `tailwind.config.ts` (class mapping), `theme/colors.ts` (hex values for programmatic use)
- RNR components live in `components/ui/` — use them for standard UI elements (Button, Card, Badge, Text, Separator)
- Font: Barlow (`font-barlow`, `font-barlow-medium`, `font-barlow-semibold`, `font-barlow-bold`) and Barlow Semi Condensed (`font-barlow-sc-medium`, `font-barlow-sc-semibold`) for data values
- Read `docs/design-system.md` before making visual changes

## Commands

- `npm start` — start Expo dev server
- `npx expo run:ios` — build and run on iOS simulator
- `npx tsc --noEmit` — type-check without emitting
- `npm run lint` — run oxlint
- `npm run format` — format with oxfmt (or `npm run format:check` to check only)

## UI Testing (AXe)

AXe CLI (`axe`) automates the iOS simulator via Accessibility APIs. Use it to self-check UI after making changes.

- `./scripts/smoke-test.sh` — navigate all tabs, take screenshots to `.axe-screenshots/`
- Screenshots: read with `Read` tool to visually verify UI after changes
- Works on the main dev simulator (iOS 26.1) — no separate device needed
- `axe tap --label "Label" --udid $UDID` — tap by accessibility label
- `axe screenshot --udid $UDID --output file.png` — capture screen
- `axe describe-ui --udid $UDID` — dump accessibility tree (find labels/IDs)
- Tab labels: `"Map, tab, 1 of 3"`, `"Routes, tab, 2 of 3"`, `"Settings, tab, 3 of 3"`

## What's Next

See `docs/ideas.md` for future feature ideas.
