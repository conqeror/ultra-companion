# Ultra Companion

Personal logistics companion for ultra-distance cycling races. The mounted riding app targets iOS; the repository also ships a browser-based planning companion. Android project files exist for build compatibility, but Android is not a supported runtime.

Not a navigation device or GPS tracker — those are handled by dedicated bike computer and race tracker. This app answers: **where to stop, what's available, when does it close, what's the terrain, what's the weather.**

## Features

- Import GPX/KML routes with elevation profiles
- POI search along route (shops, water, accommodation)
- Opening hours + ETA calculator
- Weather forecasts
- Offline maps and data (tile download, SQLite storage)
- Route collections and stitching
- Climb detection and highlights
- Browser planning workspace with transferable `.ultra-plan.db` files
- Dark outdoor map style
- Fatigue-friendly UI with large touch targets and high contrast

## Design Principles

- **Offline-first** — all core features work in airplane mode
- **Near-zero battery cost** — on-demand GPS only, no background polling
- **Fatigue-friendly UI** — minimum 48dp touch targets, high contrast, key info within 1 tap

## Stack

- React Native + Expo
- TypeScript (strict)
- Mapbox GL (`@rnmapbox/maps`)
- NativeWind v4 + Tailwind CSS v3
- Expo Router
- Zustand
- SQLite (`expo-sqlite`)
