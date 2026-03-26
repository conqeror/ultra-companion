# Ultra Companion

Logistics companion app for ultra-distance cycling races. iOS only, personal use. Not a navigation device or GPS tracker — those are handled by dedicated bike computer and race tracker. This app answers: where to stop, what's available, when does it close, what's the terrain, what's the weather.

## Docs

Detailed specs live in `docs/` — read these before starting any implementation work:

- `docs/usage-context.md` — **read first** — how the app is used during races, decision-making patterns, device setup
- `docs/product-spec.md` — features, user stories, MVP scope
- `docs/architecture.md` — stack, data models, offline strategy, project structure
- `docs/implementation-plan.md` — phased build plan with steps per phase
- `docs/technology-evaluation.md` — rationale for stack choices (RN vs native, Mapbox vs MapLibre)

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
- No ESLint/Prettier — TypeScript strict mode is the guardrail

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

## Implementation Phases

- [x] Phase 1: Map + GPS foundation
- [x] Phase 2: Route import (GPX/KML) + elevation profile
- [x] Phase 3: POI search along route
- [ ] Phase 4: ETA + POIs on elevation + opening hours + offline
- [ ] Phase 5: Weather

## Current Phase

Phase 4 — not started.

When starting a phase, read `docs/implementation-plan.md` for the detailed steps.
