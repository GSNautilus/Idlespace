# Core Branch — Design Decisions & Implementation Plan

## Pacing Note

Current game speed is tuned fast for dev/testing. The long-term vision is **persistent real-time play**: full fleet combat takes days, star-to-star travel takes hours, card acquisition is ~1–2 per colony per day. All systems should be designed with time-scaling in mind.

---

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

### D2: Weapon Range as Distance (LOCKED — REVISED)

- **Weapon range is distinct from sensor range.** Sensor range = starmap detection. Weapon range = combat engagement distance.
- Range values (short/medium/long) map to **literal distances** in combat. As two entities close on each other, weapons begin firing when their target enters that weapon's range.
- Long-range weapons fire first during approach, then medium, then short. Short-range weapons have **less total firing time** before ships are on top of each other — this is their natural disadvantage (no backline penalty needed).
- This means fleet composition still matters: all-short-range fleets take unanswered damage while closing. Mixed-range fleets get sustained DPS across the full approach.

---

### D3: Stealth vs Sensor Range (LOCKED)

- Stealth defaults to 0 (visible at base sensor range). Levels 1, 2, 3 make detection progressively harder.
- Detection formula: `effectiveDetectionRange = sensorRange - (stealth * penalty)`
- Fleet stealth = **lowest** stealth ship in fleet (one clunky ship blows cover).
- Fleet sensor range = **highest** sensor ship in fleet.
- Solo ship uses its own stats directly.
- Colonies have a base sensor range.
- **Stealth breaks on attack** — entity becomes visible to nearby sensors when it fires. Stealth is for choosing engagements, not permanent invisibility.

---

### D4: Stance System (LOCKED — REPLACES FRONTLINE/BACKLINE)

Every starmap entity (solo ship or fleet) has a **stance**: Aggressive or Evasive.

**Engagement rules when two entities enter detection range:**

| Attacker Stance | Defender Stance | Result |
|----------------|----------------|--------|
| Aggressive | Aggressive | Both alter heading toward each other. Combat begins. |
| Aggressive | Evasive | Speed check — evasive entity has a chance to slip past based on speed difference. If failed, combat begins. |
| Evasive | Aggressive | Same as above (symmetric). |
| Evasive | Evasive | Both continue on their current heading. No engagement. |

**Evasion formula (starting point):** `evasionChance = clamp((mySpeed - theirSpeed) / mySpeed, 0, 1)`

**Disengagement:** An entity in combat can switch to evasive stance to attempt to break away. Same speed-based check applies — if you're slower, you're stuck. This makes **speed both strategic and defensive**: fast fleets pick their fights.

---

### D5: Admiral Stat Multipliers (LOCKED — RENAMED FROM CAPTAIN)

Admirals always have a **Command Bonus** — a single rolled % applied to all fleet stats:

| Rarity | Command Bonus Range |
|--------|-------------------|
| Common | +1–2% |
| Uncommon | +2–4% |
| Rare | +4–7% |
| Epic | +7–10% |
| Legendary | +10–15% |

In addition, admirals can have **individual stat % bonuses** to any ship stat (shields, armor, speed, etc.). These are separate from the command bonus and stack with it.

---

### D6: Admiral Special Abilities (SHELVED)

Special abilities are deferred until core systems (ships, fleets, combat) are functional. The ability pool will be redesigned to fit the stance/range combat model. For now, admirals differentiate through command bonus + stat bonuses only.

---

### D7: Admiral Rarity → Fleet Size (LOCKED — RENAMED)

Fleet size rolled within rarity-based range on card creation. Value is permanent once rolled.

| Rarity | Fleet Size Range |
|--------|-----------------|
| Common | 4–7 ships |
| Uncommon | 6–12 ships |
| Rare | 11–24 ships |
| Epic | 20–36 ships |
| Legendary | 30–50 ships |

Overlap between tiers is intentional (lucky Common can beat unlucky Uncommon, etc.).

**Fleets without an admiral are capped at 3 ships.** An admiral card is required for larger fleets.

---

### D8: Starmap Entities & Combat Resolution (LOCKED — REVISED)

**Two entity types on the starmap:**

1. **Solo Ship** — A single ship card, no admiral. Uses its own stats directly (speed, stealth, sensor range). Ideal for scouts, colony ships, transports, or any utility role.
2. **Fleet** — Multiple ship cards (up to 3 without admiral, admiral's fleet size with one). Optionally one admiral card. Stats aggregated: speed = slowest ship, stealth = lowest, sensor = highest. Admiral command bonus + stat bonuses applied to all ships.

**Combat resolution:**
- When engagement triggers (per D4 stance rules), both entities alter heading toward each other and begin closing distance.
- Weapons fire individually per ship as targets enter each weapon's range threshold (long → medium → short).
- Damage resolves per-tick using the combat triangle (D1). Each ship has its own shields, armor, weapons. Ships die individually (shields → armor → dead).
- Combat runs in **real-time** alongside the rest of the game (idle-style).
- **Multiple fights can happen simultaneously.** Each is its own independent combat instance.
- Player can watch a combat window while managing colonies, moving other entities, etc.
- When combat ends, surviving ships reform the entity (potentially weakened).
- Entities can attempt **disengagement** mid-combat by switching to evasive (D4).

---

## Implementation Plan

### Phase 0: Branch Setup ✅
- Create `core-overhaul` branch off `master`.

### Phase 1: Starmap Overhaul ✅
1. ✅ **Star Clustering** — Replaced uniform positioning with chunk-based procedural generation using seeded fractal noise. Deterministic density map creates natural clustering — dense regions have more stars, sparse regions are void. Infinite and procedural.
2. ✅ **Remove Node System** — Deleted `star.lanes`, `addLane()`, `drawLanes()`, lane-based navigation. Stars are now independent points in space.
3. ✅ **Free Travel** — Implemented movable scout probes as map entities. Select entity → click destination → animated dashed travel line → continuous movement. Right-click deselects. Multiple entities supported simultaneously.
4. ✅ **Fog of War** — Dark overlay rendered via offscreen canvas with `destination-out` composite. Smooth radial gradient cutouts around explored stars and moving entities. Entities reveal fog continuously as they travel.

**Key constants tuned:**
- `CHUNK_SIZE = 400`, `MIN_STAR_SEPARATION = 240`, `NOISE_SCALE = 0.0015`
- `DENSITY_THRESHOLD = 0.45`, `MAX_STARS_PER_CHUNK = 1` (sparse map, ~20% of original density)
- `BASE_SENSOR_RANGE = 500` (colony fog reveal radius)
- Entity fog reveal = `sensorRange * 50` (ship stat-driven, not base range)
- Detected stars keep a small permanent fog hole (30 units) so they stay visible once found

### Phase 2: Ship Card Redesign ✅
1. ✅ **New stat schema** — Flat stats: `shields, armor, speed, sensorRange, stealth, pointDefense, energyDmg, energyRange, kineticDmg, kineticRange, missileDmg, missileRange`. Ranges are strings ("short"/"medium"/"long"). Only non-zero weapon types displayed.
2. ✅ **Card layout** — Ship cards show: defense row (shields/armor/speed), weapon rows (icon + damage + range badge with color coding S/M/L), utility row (sensor/PD/stealth, only if non-zero).
3. ✅ **17 new ship templates** — Common (single weapon), Uncommon (better stats, some mixed), Rare (multi-weapon, stealth options), Epic (powerhouse multi-role), Legendary (overwhelming firepower).
4. ✅ **Card designer updated** — Ship default stats pre-populated, dropdown selects for weapon range fields, ship-specific preview rendering.

### Phase 3: Admiral Card Redesign ✅
1. ✅ Define admiral schema: `{ commandBonus, maxFleetSize, statBonuses }` (no special abilities for now).
2. ✅ Redesign admiral card layout to show command bonus, fleet size, stat bonuses.
3. ✅ Replace 13 existing captain templates with new admiral designs.
4. ✅ Update card designer with admiral-specific fields.
5. ✅ Rename all "captain" references to "admiral" across the codebase.

### Phase 4: Starmap Entities & Fleet System ✅
1. ✅ **Entity model** — Two types: solo ship `{ card, stance, position, destination }` and fleet `{ admiral?, ships[], stance, derivedStats, position, destination }`. Replaced probe system entirely. Three starter admiral-led fleets at home star (each with a Sensor Pinnace for detection range).
2. ✅ **Fleet stat calculation** — `recalcFleetStats()`: speed=min, sensor=max, stealth=min, damage=sum, admiral command bonus applied. Solo ships use own card stats.
3. ✅ **Colony tab system** — Buildings/Fleet tabs in colony screen. Shared queue at bottom. Fleet tab: admiral as first grid slot (gold-styled, optional), ship slots grid, stance toggle, deploy fleet / deploy solo buttons. Drag-drop from queue to fleet slots and back.
4. ✅ **Entity rendering** — Triangles for solo ships (rarity-colored), chevrons for fleets with ship count badge. Stance indicator (A/E). Dashed travel lines, selection highlight, labels.
5. ✅ **Entity selection & info panel** — Click entity to show stats, stance toggle, disband button (at colony only returns cards to queue). Movement orders via click destination.
6. ✅ **Entity movement & game loop** — `tickEntities(dt)` handles movement, fog-of-war reveal via `detectStarsInRange()`. Replaces old probe system entirely.
7. ✅ **ETA display** — `formatETA()` helper converts game-seconds to human-readable time. Shown in entity info panel and as a canvas label below traveling entities on the starmap.

### Phase 4.5: Pacing & Time Controls ✅
1. ✅ **Master clock** — Single `scaledDt = dt * BASE_GAME_SPEED * gameSpeed` computed once in game loop, passed to both `tickEconomy()` and `tickEntities()`. No separate speed scaling inside subsystems.
2. ✅ **BASE_GAME_SPEED = 0.1** — Baseline pacing constant. 1x is 10% of real-time. One knob to tune overall game feel.
3. ✅ **Speed controls** — Pause / 1x / 10x / 50x. Idle-appropriate (not RTS fractions).

### Phase 5: Combat ✅
1. ✅ **Entity ownership & combat state** — All entities have `owner` ("player"/"npc") and `inCombat` flag. Entities in combat can't move or be disbanded.
2. ✅ **NPC Pirates** — 3 pirate ship templates (Raider, Marauder, Corsair). Deterministic spawning in `generateChunk()` using chunk seed RNG — 10% in star-dense chunks, 3% in void chunks. Pirates patrol randomly (wander nearby), always aggressive. Rendered in crimson (#c04040).
3. ✅ **Detection & engagement** — `checkCombatEngagements()` scans non-combat, different-owner entities within sensor range (with stealth penalty). Stance rules per D4: aggressive/aggressive = fight, aggressive/evasive = speed-based evasion roll, evasive/evasive = pass. Combat locks both entities.
4. ✅ **Volley combat engine** — `tickCombats()` runs from game loop with `COMBAT_TIME_SCALE = 1/10`. Combat proceeds as volleys cycling through all alive ships, alternating sides. `SHOT_INTERVAL = 0.5` game-seconds between shots. Per-shot: pick random enemy target, check weapon range against physical world-unit distance (`RANGE_THRESHOLDS = { long: 400, medium: 200, short: 60 }`), roll to hit (base 70%, modified by sensorRange/stealth/speed), missile PD interception roll, then apply combat triangle damage (shields first, then armor, ship dies at armor 0). `COMBAT_HP_SCALE = 5` multiplied onto shields/armor for durability.
5. ✅ **Physical distance closing** — Entities move toward each other at full speed during combat. `combat.distance` is the real world-unit distance between entities, recomputed each tick. Weapons activate based on actual distance vs range thresholds. Entities stop at `ENGAGED_DISTANCE = 60` world units.
6. ✅ **Disengagement** — Switch to evasive stance mid-combat to attempt breakaway. Speed-based chance roll per tick. Both sides survive on success.
7. ✅ **Starmap combat visuals** — Red glowing line between combating entities. Pulsing ⚔ icon at midpoint, clickable to open combat overlay. Weapon-colored particle effects on each volley (energy=blue, kinetic=orange, missile=red; 8 particles on hit, 3 on miss).
8. ✅ **Combat overlay** — Colony-screen-sized panel (81%, semi-transparent at 0.75 opacity). Shows both sides with per-ship shield/armor HP bars, phase indicator, distance bar, round counter, next-volley countdown, and scrolling color-coded combat log. Log persists across open/close — full history from combat start.
9. ✅ **Combat resolution** — Loser entity removed from map. Winner's surviving ships retain damage (`_combatShields`/`_combatArmor` persisted on cards). Winner entity unlocked and resumes movement. Dead ships filtered from fleet, stats recalculated.
10. ✅ **Starter fleet upgrade** — 3 admiral-led fleets with mixed weapon types and Sensor Pinnaces for detection. Deployed offset 40 units from colony star. Deploy buttons also offset new entities.

**Key constants:**
- `SHOT_INTERVAL = 0.5`, `COMBAT_TIME_SCALE = 1/10`, `COMBAT_HP_SCALE = 5`
- `RANGE_THRESHOLDS = { long: 400, medium: 200, short: 60 }`, `ENGAGED_DISTANCE = 60`
- Hit chance: base 70%, +1%/sensorRange (cap +15%), -5%/stealth, -0.5%/speed, clamped 10-95%
- PD: 2% per point, capped 80%
- Pirate spawn: 10% star chunks, 3% void chunks, 1-3 ships each

### Phase 6: Fleet Management ⬅️ NEXT
1. Fleet management panel (list, status, stats, stance).
2. Repair/resupply at friendly colonies.
