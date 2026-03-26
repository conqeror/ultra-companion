# Ultra Companion

Mobile app for ultra-distance cycling races. iOS only, personal use.

## Docs

Detailed specs live in `docs/` — read these before starting any implementation work:

- `docs/product-spec.md` — features, user stories, MVP scope
- `docs/architecture.md` — stack, data models, offline strategy, project structure
- `docs/implementation-plan.md` — phased build plan with steps per phase
- `docs/technology-evaluation.md` — rationale for stack choices (RN vs native, Mapbox vs MapLibre)

## Stack

- React Native + Expo (dev builds, not Expo Go)
- TypeScript (strict)
- Mapbox GL (`@rnmapbox/maps`) — map rendering + offline tiles
- Expo Router — file-based navigation
- Zustand — state management
- SQLite (`expo-sqlite`) — POI and route storage
- MMKV (`react-native-mmkv`) — preferences

## Key Design Principles

1. **Offline-first** — all core features must work without connectivity
2. **Battery-efficient** — minimize GPS polling, avoid unnecessary re-renders
3. **Fatigue-friendly UI** — minimum 48dp touch targets, high contrast, key info within 1 tap
4. **Simple over clever** — this is a personal tool, not a product. Ship working features, iterate later.

## Implementation Phases

- [ ] Phase 1: Map + GPS foundation
- [ ] Phase 2: Route import (GPX/KML) + elevation profile
- [ ] Phase 3: POI search along route
- [ ] Phase 4: Power-based ETA + offline tile/POI downloads
- [ ] Phase 5: Weather + polish

## Current Phase

Phase 1 — not started.

When starting a phase, read `docs/implementation-plan.md` for the detailed steps.
