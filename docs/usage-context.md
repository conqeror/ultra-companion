# Ultra Companion — Usage Context

How the app is actually used, based on real race experience. This document should inform every feature and design decision.

---

## 1. Race Format

- **Distance**: 1,000–4,000 km, solo and unsupported
- **Duration**: anywhere from ~3 days to 2+ weeks
- **Route types**: fixed route, checkpoints with free routing between them, mandatory segments with free routing, or combinations of all three
- **Season**: May through September — warm but mountain stages can be cold and wet
- **Events**: Transcontinental-style races across varied terrain and countries

---

## 2. Daily Rhythm

| Window      | Activity                                                         |
| ----------- | ---------------------------------------------------------------- |
| 06:00–07:00 | Wake, pack, start riding                                         |
| Daytime     | Ride with brief stops every 4–6 hours (food, water, toilet)      |
| Evening     | Grocery run before shops close — carry enough food for the night |
| Night       | Continue riding until 01:00–02:00                                |
| 01:00–06:00 | Sleep (minimal for short races)                                  |

- **Short races** (< ~1 week): minimize sleep, push through
- **Long races** (1–2+ weeks): every 2nd night in accommodation to recharge devices and wash clothes
- **Riding hours**: ~18–19 hours/day on the bike
- **Stop cadence**: ~every 4–6 hours, carrying enough water and food to sustain that gap

---

## 3. Stop Strategy

Stops are optimized — the rider thinks ahead about what the next stop needs to accomplish:

- **Gas stations** preferred: quick, can see the bike, food + toilet + water in one place
- **Quick food** (pizza, kebab) in the evening when available
- **Sit-down restaurants**: rarely — too slow, bike out of sight
- **Accommodation**: only on long races, every 2nd night, doubles as device charging + laundry
- **Grocery stores**: timed run before closing hours to stock up for the night

**Key insight**: every stop is a multi-variable optimization — location, services available, time cost, how it fits the upcoming terrain and distance to the next option.

---

## 4. Device Setup

### Phone: iPhone 15 Pro

- **Mounting**: aerobar mount (primary) or shorts side pocket
- **Interaction while riding**: yes — tap, scroll, glance. The phone is within easy reach on aerobars
- **Airplane mode**: frequently enabled to save battery
- **Music**: sometimes, but not a priority
- **Battery strategy**: powerbanks carried but reserved primarily for the front light (critical for night riding). Phone battery is rationed.

### Other devices

- **Bike computer**: primary navigation and ride stats (speed, power, HR, distance)
- **Power meter + HR monitor**: paired to bike computer
- **GPS tracker**: provided by race organizers, mandatory carry — tracking website shows all participants
- **Powerbanks**: carried for front light first, phone second

### What the phone is NOT used for

- Navigation (bike computer handles this)
- GPS tracking (dedicated tracker from organizers)
- Ride stats (bike computer)

### What the phone IS used for

- **Logistics planning**: where to stop, what's available ahead
- **ETA calculations**: when will I reach a town, a shop, a checkpoint
- **Weather**: what's coming in the next hours along the route
- **POI discovery**: finding resources (food, water, shelter) along or near the route
- **Terrain preview**: understanding upcoming elevation to plan effort and stops
- **Communication**: occasional messages when signal is available

---

## 5. Cognitive & Physical State

The rider is operating under:

- **Severe fatigue**: 18–19 hours of physical effort per day, cumulative over days/weeks
- **Sleep deprivation**: 4–5 hours of sleep on good nights, sometimes less
- **Decision fatigue**: hundreds of micro-decisions daily (pace, food, route, sleep timing)
- **Reduced fine motor control**: fatigued hands, sometimes gloved (cold descents, rain)
- **Narrow attention**: can process one thing at a time, information must be immediate and obvious
- **Time pressure**: every minute stopped is a minute not riding

**Design implication**: if a feature requires more than 2–3 taps or any complex reasoning to get an answer, it will not be used during a race.

---

## 6. Environment

- **Vibration**: constant when phone is bar-mounted on rough roads
- **Lighting**: full sun glare, overcast, dusk, night (with only bike light)
- **Weather**: rain, wind, heat, cold mountain descents — all in the same race
- **Connectivity**: hours or days without signal in mountains and rural areas; brief windows of connectivity in towns
- **Noise**: wind, traffic — audio feedback is unreliable

---

## 7. Current Pain Points

| Pain point                                | Current workaround                        | Why it fails                                               |
| ----------------------------------------- | ----------------------------------------- | ---------------------------------------------------------- |
| Where should I stop next?                 | Google Maps + mental math                 | Requires connectivity, multiple searches, no route context |
| What's at a POI on the elevation profile? | Komoot + mental cross-referencing         | Can't see POIs overlaid on elevation, no ETA               |
| When will I reach a place?                | Mental math from bike computer stats      | Error-prone when fatigued, doesn't account for terrain     |
| What's the weather ahead?                 | Weather app + guessing based on direction | No route-aware forecast, needs connectivity                |
| Offline access to any of this             | None                                      | Google Maps/Komoot need connectivity for POI search        |

**The core problem**: no single app combines route-aware POI search, terrain-aware ETAs, and weather — and none of it works offline.

---

## 8. Feature Evaluation Checklist

When considering any new feature, ask:

1. **Does it work offline?** If not, it's useless for the core use case.
2. **Does it work at 2 AM after 19 hours of riding?** If it requires focus or multi-step interaction, simplify it.
3. **Does it answer a question the rider actually has?** (See Section 7)
4. **Does it save time or reduce cognitive load?** If it adds complexity without clear payoff, skip it.
5. **Does it cost battery?** If it needs continuous GPS, background processing, or network polling, justify the cost.
6. **Can the rider glance at it while riding?** The best features surface information without requiring interaction.
