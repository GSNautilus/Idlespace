# Core Branch — Design Decisions & Implementation Plan

## Design Decisions

### D1: Combat Triangle (LOCKED)

**Damage resolution order:** Shields → Armor → Dead (no hull HP stat)

| Weapon Type | vs Shields | vs Armor | Range | Notes |
|-------------|-----------|----------|-------|-------|
| Energy | 2x | 0.5x | Short | Good against shield-heavy ships |
| Kinetic | 0.5x | 2x | Medium | Good against armor-heavy ships |
| Missiles | 1x | 1x | Long | Versatile, countered by Point Defense |

- No shield regeneration or repair mechanics for now.
- Point Defense reduces incoming missile damage (exact formula TBD).

---

### D2: Weapon Range (LOCKED)

- **Weapon range is distinct from sensor range.** Sensor range = starmap detection. Weapon range = combat effectiveness.
- Short-range weapons in the **backline deal reduced damage** (not zero). This encourages good fleet composition without completely punishing misplacement.
- No combat phase system for now. The long-range opening volley concept is shelved but could return later as ship card special abilities.

---

### D3: Stealth vs Sensor Range (LOCKED)

- Stealth defaults to 0 (visible at base sensor range). Levels 1, 2, 3 make detection progressively harder.
- Detection formula: `effectiveDetectionRange = sensorRange - (stealth * penalty)`
- Fleet stealth = **lowest** stealth ship in fleet (one clunky ship blows cover).
- Fleet sensor range = **highest** sensor ship in fleet.
- Colonies have a base sensor range.
- **Stealth breaks on attack** — fleet becomes visible to nearby sensors when it fires. Stealth is for choosing engagements, not permanent invisibility.

---

### D4: Mixed Range in Fleets / Frontline & Backline (LOCKED)

Fleet has two positions: Frontline and Backline.

- Frontline absorbs all incoming damage first.
- Backline only takes damage after frontline is destroyed.
- Short-range weapons in backline fire at reduced damage.
- **No limits on frontline/backline ratio.** Player distributes ships however they want. Natural consequences punish bad composition (all-backline = no tank = instant damage to everyone).

---

### D5: Captain Stat Multipliers (LOCKED)

Captains always have a **Command Bonus** — a single rolled % applied to all fleet stats:

| Rarity | Command Bonus Range |
|--------|-------------------|
| Common | +5–10% |
| Uncommon | +10–20% |
| Rare | +20–35% |
| Epic | +35–50% |
| Legendary | +50–75% |

In addition, captains can have **individual stat % bonuses** to any ship stat (shields, armor, speed, etc.). These are separate from the command bonus and stack with it. Combined with special abilities (D6), this gives captains three layers of differentiation: universal command bonus + specific stat bonuses + special ability.

---

### D6: Captain Special Abilities (LOCKED)

- **One special ability per captain** (max), from a pool of unique mechanics.
- Captains can have **multiple stat bonuses** (space permitting on the card).
- Start simple — not every captain needs a special ability. Many can just have command bonus + stat bonuses.
- Special abilities are reserved for things that can't be expressed as % bonuses:

| Ability | Effect |
|---------|--------|
| Ghost Admiral | +1 Stealth to entire fleet |
| Rally | Backline short-range weapons fire at full effectiveness |
| Shield Overcharge | Shields absorb first hit at 2x value |
| Missile Screen | Point Defense applies fleet-wide instead of per-ship |
| First Strike | Fleet gets a free opening volley before combat begins |
| Sensor Net | Detects stealthed fleets (ignores 1 stealth level) |

This pool can grow over time. Initial captain cards will be simple (command bonus + maybe a stat bonus or two).

---

### D7: Captain Rarity → Fleet Size (LOCKED)

Fleet size rolled within rarity-based range on card creation. Value is permanent once rolled.

| Rarity | Fleet Size Range |
|--------|-----------------|
| Common | 4–7 ships |
| Uncommon | 6–12 ships |
| Rare | 11–24 ships |
| Epic | 20–36 ships |
| Legendary | 30–50 ships |

Overlap between tiers is intentional (lucky Common can beat unlucky Uncommon, etc.).

---

### D8: Fleet Entity Model & Combat Resolution (LOCKED)

- **Starmap:** Fleet moves as a **single entity** — one icon, one speed, one position. Stats are aggregated from component ships for movement/detection purposes (speed = slowest ship, stealth = lowest, sensor = highest).
- **Combat:** Zooms into **individual ship resolution**. Each ship has its own shields, armor, and weapons. Ships take damage and die individually over time.
- Combat runs in **real-time** alongside the rest of the game (idle-style). A small combat window shows the fight progressing — damage ticks, casualties, ship losses.
- **Multiple fights can happen simultaneously.** Each is its own independent combat instance running in parallel.
- Player can watch a combat window while managing colonies, moving other fleets, etc.
- When combat ends, surviving ships reform the fleet (potentially weakened).

---

## Implementation Plan

### Phase 0: Branch Setup
- Create `core-overhaul` branch off `master`.

### Phase 1: Starmap Overhaul
1. **Star Clustering** — Replace uniform random positioning with multi-cluster galaxy layout (3-8 cluster centers, Gaussian falloff, sparse field stars between).
2. **Remove Node System** — Delete `star.lanes`, lane rendering, lane-based navigation.
3. **Free Travel** — Entities move freely between stars with distance-based travel time (`distance / speed`). Interpolated position rendering on canvas.
4. **Fog of War** — Render dark overlay with circular cutouts around explored areas. Reveal radius tied to sensor range.

### Phase 2: Ship Card Redesign
1. Define new stat schema: `{ shields, armor, speed, sensorRange, weapons: [{type, damage, range}], stealth, pointDefense }`
2. Redesign 220x320 card layout for combat stats.
3. Replace 17 existing ship templates with combat-oriented designs.
4. Update card-builder.html with ship-specific fields.

### Phase 3: Captain Card Redesign
1. Define captain schema: `{ commandBonus, maxFleetSize, specialAbility }`
2. Redesign captain card layout.
3. Replace 13 existing captain templates.
4. Update card designer.

### Phase 4: Fleet System
1. Fleet data model: `{ captain, frontline[], backline[], derivedStats, position, destination }`
2. Fleet stat calculation (speed=min, damage=sum, stealth=min, captain bonus applied).
3. Fleet creation UI (overlay with drag-drop, reuses colony screen patterns).
4. Fleet icon on starmap (captain portrait).
5. Fleet selection, movement orders, ETA display.
6. Fleet movement tick in game loop.

### Phase 5: Combat
1. Combat instance model: each fight is an independent object tracking two fleets' individual ships, running in real-time.
2. Combat engine: per-tick individual ship damage — weapons fire at targets based on frontline/backline rules, combat triangle multipliers, PD vs missiles. Ships die individually (shields → armor → dead).
3. Combat window UI: small overlay showing live fight — ship counts, damage ticks, casualties. Non-blocking (player can do other things). Multiple combat windows can exist simultaneously.
4. Combat resolution: surviving ships reform fleet, destroyed ships are removed from fleet. Notification on combat end with summary.

### Phase 6: Fleet Management
1. Fleet management panel (list, status, stats).
2. Repair/resupply at friendly colonies.
