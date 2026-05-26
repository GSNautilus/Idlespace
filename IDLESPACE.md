# IdleSpace — Game Design & Implementation Reference

**Version pinned:** `v0.1.2` (v0.2.0 Phase 1 in progress — foundation only)
**Last verified against code:** 2026-05-26
**Primary source:** [`starmap.html`](starmap.html) (~10,800 lines)
**Card data:** [`data/game-cards.json`](data/game-cards.json) (120 cards, schema v1)

This is the single living reference for "how does IdleSpace work today, and where does each system live in the code." It is the only design / implementation doc in the repo.

**How to keep this doc current:** When you tag a release, bump the version pin at top, append a one-line entry to §19 Version History, and re-verify the §21 constants appendix against `starmap.html`. When a system materially changes, update its section and update the §21 appendix line for any constant that moved.

---

## 1. What IdleSpace Is

IdleSpace is an **idle space 4X collectible card game**. Every meaningful in-game entity — a star, a planet, a building, a leader, a ship, an admiral — is a card with rolled stats, a rarity, and a place in a deck/slot/fleet. The player explores a procedural starmap, discovers and colonizes planets, places building cards in colony slots, researches new cards (a "card pack opening" reveal), assembles fleets under admirals, and fights NPC pirates whose tier scales with distance from home.

### Design pillars

1. **Cards are everything.** Stars, planets, buildings, leaders, ships, admirals all render through the same metallic "Rustfang" template. The card abstraction unifies the visual + mechanical language.
2. **Idle-first.** Stat scaling, costs, and timers are designed so the game plays itself while you're away. Higher-rarity cards are exponentially better, and costs / draw intervals escalate to make scale matter.
3. **Discovery as reward.** Exploration, planet generation, research, pirate loot — each is a roll with rarity-coloured outcomes.
4. **Persistent real-time pacing (long-term goal).** Combat is internally slowed by `COMBAT_TIME_SCALE = 1/100`; current `BASE_GAME_SPEED = 2` is dev tuning. Vision: combat takes days, travel takes hours, cards drop ~1–2/colony/day. All systems must be time-scalable.
5. **Data-driven.** Resources, rarity weights, cost formulas, and card templates are constants/JSON, not hard-coded into call sites. Consumers iterate `RESOURCE_DEFS` / `RARITY_WEIGHTS` so resources and rarities can grow without rewriting renderers.

---

## 2. Tech Stack & File Layout

| File | Lines | Role |
|---|---|---|
| [`starmap.html`](starmap.html) | 8,956 | The game. Canvas + DOM + inline JS, no framework, no build step. |
| [`card-builder.html`](card-builder.html) | 2,374 | Standalone card design tool. Live-syncs to the game via IndexedDB override. |
| [`index.html`](index.html) | 17 | Redirect to `starmap.html`. |
| [`data/game-cards.json`](data/game-cards.json) | — | **Canonical card source.** 108 cards, schema `{ version:1, cards:[] }`. |
| `data/cards.json` | — | Legacy 100-card flat-array export. Not loaded by the game. Keep for historical reference. |
| `data/game-cards.json.bak` | — | Backup. |
| [`sim.html`](sim.html) | — | Headless economy simulator for tuning. Single-colony, picker drives draws via lookahead projection (each candidate × slot is played forward N game-min and scored on pop reached + bank deltas + research unlocks − bankruptcy penalty). Reads `data/game-cards.json` directly. Cache-busted via `?v=BUILD` query string; visible build stamp in header. |
| `sim/economy.js` | — | Pure-function port of the resource math (`getColonyOutput`, `getPopGrowthCost`, `getDrawScaling`, `getColonizationCost`, `cardScore`, `colonyScore`, etc.) used by `sim.html`. Self-contained (`SimEconomy` global / Node `require`). Duplicates math currently in `starmap.html` — change both, or move the game over to load this file. |
| `sim/smoke*.js`, `sim/syntax-check.js` | — | Node smoke tests for the simulator: `smoke.js` covers economy primitives, `smoke-full.js` mirrors `sim.html`'s `runSim` end-to-end, `smoke-diag.js` dumps per-candidate lookahead scores, `syntax-check.js` parses the inline `sim.html` script. |

### `ui/` — split CSS

| File | Bytes | Owns |
|---|---|---|
| [`ui/card-chrome.css`](ui/card-chrome.css) | 13.4 KB | Shared `.card-preview.tpl-metal` chrome — rarity halo, gunmetal body, corner brackets, `.hdr / .img / .subtype / .cost / .row / .stat / .sv / .special / .flv / .wm`. |
| [`ui/colors_and_type.css`](ui/colors_and_type.css) | 8.97 KB | Rarity / resource / weapon / range palettes + type tokens. Single source for `--rarity-*`, `--res-*`, `--wpn-*`, `--range-*`. |
| [`ui/chrome.css`](ui/chrome.css) | 8.69 KB | Global `.metal` surface helpers, `.ico` sprite helper. |
| [`ui/icons.html`](ui/icons.html) | 15.4 KB | SVG symbol sprite, XHR-injected near `<body>` top so `<use href="#i-…"/>` resolves before first paint. |
| [`ui/topbar.css`](ui/topbar.css) | 4.31 KB | Resource rack + logo + version badge layout. |
| [`ui/ship-card.css`](ui/ship-card.css) | 2.91 KB | Ship middle-content only — armaments block, range badges. |
| [`ui/admiral-card.css`](ui/admiral-card.css) | 1.79 KB | Admiral middle-content. |
| [`ui/star-card.css`](ui/star-card.css) | 1.70 KB | Star middle-content. |
| [`ui/building-card.css`](ui/building-card.css) | 1.25 KB | Building middle-content. |
| [`ui/planet-card.css`](ui/planet-card.css) | 843 B | Planet middle-content. |
| [`ui/leader-card.css`](ui/leader-card.css) | 734 B | Leader middle-content. |

### `assets/`

~36 MB across subdirs `assets/cards/{building,planet,ship,…}/<id>.png` (and a few legacy bundles). Card art is preloaded at boot (WebP, async-decode).

---

## 3. Core Game Loop

1. **Explore.** Click a detected star → select panel; double-click to enter its system view. Pressing **Scout** starts a timed survey (see §5b); on completion the star card flips to explored, with a ~15% chance of an anomaly outcome. Exploring a star reveals the star card itself but **no longer auto-reveals neighbours** (v0.0.9.23). Sensor range from colonies and traveling entities is what surfaces new stars.
2. **Discover.** System view rolls planets via `generatePlanets(star)` ([starmap.html:2556](starmap.html)). Higher-rarity stars produce more and rarer planets.
3. **Colonize.** Move a fleet carrying a card with `special: "colonize"` into the star's sensor range, click the planet's **Colonize** button, pay the cost. The Colony Ship card is consumed.
4. **Build.** Set the colony's action (Trade / Buildings / Admirals / Leaders / Ships / Terraform). For card-generating actions, face-down cards appear in the deck pile on an escalating timer. Click pile → pick 1 of 3 rarity-weighted choices → land in queue → drag into a slot.
5. **Research.** Choose a gated category (building / ship / admiral / leader), pay the escalating cost (capped 5 research/s), wait, get a card-pack reveal.
6. **Expand.** Population grows by purchase (food + credits); each pop level unlocks one more building slot up to 10. More colonies → more income → more researches → more / bigger fleets → push back the pirate frontier.
7. **Combat sub-loop.** Fleets engage when two opposing entities enter detection range with compatible stances (see §13). Combat is volley-based, internally slowed 100× to preserve pre-real-time-rebase tempo. Loser destroyed; winner retains damage on surviving ships and can return for repair (not yet built).

---

## 4. Card System

### Categories (canonical: 8 + 2 NPC factions)

| Category | Templates in `game-cards.json` | Notes |
|---|---|---|
| star | 12 (3/2/3/3/1 by rarity) | Discovered on map; fixed stats; carry `categoryData.planetGen`. |
| planet | 14 (4/4/2/2/2) | Rolled at system view; carry `categoryData.bonuses` (resource %). |
| building | 32 (10/10/5/4/3) | Largest pool. Placed in colony slots; `stats` produce, `upkeep` consumes. |
| leader | 13 (4/3/3/2/1) | One per colony. `stats` add to output; `bonuses` multiply output %. |
| ship | 18 (6/5/3/2/2) | Fleet components. Combat stats: `shields, armor, speed, sensorRange, stealth, pointDefense, energyDmg, energyRange, kineticDmg, kineticRange, missileDmg, missileRange`. |
| admiral | 13 (4/3/3/2/1) | One per fleet. `stats.commandBonus` (% to all ship stats), `stats.maxFleetSize` (ship cap, default 3 without admiral). |
| **artifact** | 6 (sample set) | Permanent passive effects. **No stat rolls** — flat effect per template. `categoryData.source ∈ {"pirate","research","exploration",...}` gates which gameplay path can drop it. `categoryData.effect` resolved through `ARTIFACT_EFFECTS` (see §10b). Owned set: `ownedArtifacts: Set<id>`. Duplicates filtered pre-roll — never offered twice. |
| **tech** | 60 | Consumable activatable cards. Effects via `categoryData.effect` resolved through `TECH_EFFECTS` (see §10c). Tech cards may also carry a `cost` paid out of `resources` on play (in addition to the inventory charge); the Play button shows a cost tooltip when unaffordable. Inventory: `techInventory: { id → count }`. Played from the Collection's Tech tab. Some effects target a world point ("Targeted") and enter a reticle-based targeting mode. |
| **pirate** | 6 | NPC faction (sub-tag of NPCs). Reuses ship renderer with `category === "pirate"`. Dropped as loot trophies, not yet deployable. |
| **dragon** | 8 (all legendary) | NPC faction. Solo apex-predator fleets at ~10% pirate spawn density. Stats are 2× Dreadlord Prime for the six colored Star Dragons (Red/Orange/Yellow/Green/Blue/Purple), 10× for White Star Dragon, 100× for Singularity Dragon. Sensor range 2 → 100-unit detection — only aggro at point-blank distance. White and Singularity tier-gated to deep frontier. |

`captain` no longer exists as a category — Admiral replaces it (rename completed in CORE_PLAN Phase 3). `ACTION_TO_CATEGORY = { buildings:"building", admirals:"admiral", leaders:"leader", ships:"ship" }` ([starmap.html:2221](starmap.html)). Trade and Terraform actions are resource-only — they don't generate cards.

### Schema

```js
{
  // structural (required)
  id:        "bld_009",
  name:      "Quantum Computer",
  category:  "building",                       // see table above
  rarity:    "common" | "uncommon" | "rare" | "epic" | "legendary",

  // shared optional
  weight:    1,                                // within-rarity draw multiplier (0 = excluded, default 1)
  image:     "assets/cards/building/bld_009.png" | "data:image/…",
  stats:     { research: 75 },                 // production (buildings/leaders) or combat (ships)
  cost:      { energy: 120, minerals: 80 },    // one-time placement cost
  upkeep:    { energy: 15 },                   // per-tick consumption
  special:   "Boosts all research output by 10%.",
  flavor:    "Processing power beyond mortal comprehension.",
  tags:      ["non-starter", "needs-art"],     // metadata
  attributes:{},                               // typed metadata bucket (faction/race/…)
  categoryData: { /* per-category extension, see below */ },

  // instance-only (added by rollStats / rollPlanetCardOfRarity at draw time)
  statRanges:  { research: [56, 94] },         // ±25% min/max for color tinting
  bonuses:     { credits: 12 },                // leaders/planets — percentage multipliers
  bonusRanges: { credits: [9, 15] },           // tint range for bonuses
  planetSlots: [/* rarity strings */],         // pre-rolled planet allotment on stars
}
```

`categoryData` is the typed extension point:

- `star → planetGen: { count: [min, max], guaranteed: [rarities…], bonus: N }`
- `planet → bonuses: { energy: 55, credits: 25 }` (percent multipliers applied in `getColonyOutput`)
- Other categories currently empty; field is reserved.

Schema rules: missing optional fields default to empty; missing `id` / `category` / `rarity` is a hard error; unknown fields are preserved round-trip by both loader and card-builder.

### Rarity & stat rolling

- `RARITY_WEIGHTS = { common:60, uncommon:25, rare:10, epic:4, legendary:1 }` ([starmap.html:2234](starmap.html)).
- `STAT_ROLL_VARIANCE = 0.25` → every numeric stat rolls ±25% around template value ([starmap.html:2238](starmap.html)).
- Per-stat quality is bucketed gray → green → blue → purple → gold by where the roll lands in its range. The bucket weights mirror `RARITY_WEIGHTS` but are blended toward gold for higher-rarity cards via `STAT_RARITY_BLEND = { common:0, uncommon:0.125, rare:0.25, epic:0.375, legendary:0.5 }` ([starmap.html:2245–2246](starmap.html)). So a legendary's stats are far more likely to land in the top tier than a common's. Implemented in `rollStats()` at ~[starmap.html:2265](starmap.html).
- Tinting is applied by `statColorStyle(card, rangesField, key, val, defaultColor)` at ~[starmap.html:5093](starmap.html); upkeep stays uniformly red regardless of roll.

### Per-card `weight` field

Optional number on each template (default `1`). Used by `pickWeighted(arr, rng)` at [starmap.html:2196](starmap.html) as a within-rarity multiplier. `0` excludes a card from random draws without deleting it. Wired into **all five** random draw paths in starmap:

| Path | Where | What |
|---|---|---|
| `rollPirateShip` | pirate spawning | from pirate-tier pool |
| `rollCardFromCategory` | colony deck draws | rarity-weighted with research gating |
| `rollStarCard` | starmap generation | star templates by rarity |
| `rollPlanetCardOfRarity` | system view | planet template by chosen rarity |
| `rollResearchResult` | research reveal | uses dedicated `{ common:200, uncommon:60, rare:15, epic:3, legendary:0.3 }` weight table at [starmap.html:6533](starmap.html), then multiplies per-card `weight` |

`rollRarityWithBonus(bonus)` at [starmap.html:2478](starmap.html) shifts mass from common into higher tiers when generating planets near high-rarity stars.

### Card data pipeline

`starmap.html` loads cards in this precedence ([starmap.html:1862–2102](starmap.html)):

1. **IndexedDB override** `gameCardsOverride` (key `CARDS_IDB_OVERRIDE_KEY` in DB `idlespace_cards`, store `kv`). Set by the card-builder's "Apply to live game" button.
2. `fetch("data/game-cards.json", { cache: "no-cache" })`.
3. Hard error — there are no embedded `*_TEMPLATES` fallbacks anymore (Phase 5 of pipeline plan complete).

A corner badge `#card-source-badge` lights up when the override is active, with a "revert to shipped" action. Card-builder lives in IndexedDB and pushes overrides explicitly (no auto-apply on keystroke).

Visual rendering: `buildCardHtml(card)` ([starmap.html](starmap.html)) dispatches per `card.category` to `buildShipCardHtml / buildBuildingCardHtml / buildPlanetCardHtml / buildStarCardHtml / buildLeaderCardHtml / buildAdmiralCardHtml`. Each emits `class="card-preview tpl-metal is-<type> <rarity>"`; the metallic chrome activates automatically from `ui/card-chrome.css`. Per-type middle-content CSS lives in `ui/<type>-card.css`; the shared chrome is `ui/card-chrome.css`; rarity / resource / weapon / range palettes live in `ui/colors_and_type.css`.

---

## 5. Starmap

### Chunk-based generation ([starmap.html:2637–2767](starmap.html))

- `CHUNK_SIZE = 400` world units per chunk.
- `NOISE_SCALE = 0.0015` — lower = bigger clusters.
- `MIN_STAR_SEPARATION = 240`.
- `DENSITY_THRESHOLD = 0.25` — chunks with fractal-noise density below this are void.
- `MAX_STARS_PER_CHUNK = 1` (at peak density).
- `GALAXY_SEED` is randomized on load; deterministic per session. Stars are independent points — **no hyperlanes** (CORE_PLAN Phase 1).
- Home chunk is force-generated; home star always spawns at (0, 0) with a Yellow Main Sequence template and a starter colony with 5 pre-rolled planet slots.

### Visibility

- States: **unknown** (no render) → **detected** (sensor-revealed; mystery-card preview, may be **scouting**) → **explored** (full card data + planet generation).
- `BASE_SENSOR_RANGE = 500` world units for colonies and the home star ([starmap.html:2792](starmap.html)).
- Entity sensor radius = `card.stats.sensorRange × 50` world units. Fleet's effective sensor = max across its ships.
- **v0.0.9.23 change:** Exploring a star no longer reveals its neighbours. You must move a sensor-equipped entity to surface the next stars.
- Fog-of-war is a memory bitmap per chunk (`TILES_PER_CHUNK = 4` → 16-bit visited map), rendered via offscreen canvas + `destination-out` composite. Detected stars keep a small permanent fog hole so they don't vanish.

### 5b. Scouting & Anomalies (v0.1.2)

Scouting replaces the previous instant-explore step. `startScoutingStar(star)` ([starmap.html](starmap.html)) records a `star.scout = { progress, total, fleetIdx }` object; `tickScouts(scaledDt)` advances every in-progress scout each frame. When `progress ≥ total`, `completeScoutingStar(star)` flips visibility to `explored`, rolls `SCOUT_ANOMALY_CHANCE = 0.15` for an anomaly, and (if one fires) opens an anomaly modal.

**Distance scaling** — `getScoutDuration(star)`:
```
d = hypot(star.x, star.y)
t = min(1, d / SCOUT_DISTANCE_RANGE)
seconds = SCOUT_MIN_SEC + (SCOUT_MAX_SEC - SCOUT_MIN_SEC) × t^SCOUT_DISTANCE_EXPONENT
```

| Constant | Value | Notes |
|---|---|---|
| `SCOUT_MIN_SEC` | `60` | game-seconds at d=0 (home-adjacent stars feel quick) |
| `SCOUT_MAX_SEC` | `86400` | 24 game-hours (cap at the long-range frontier) |
| `SCOUT_DISTANCE_RANGE` | `40000` | world-units; distance at which scout time saturates |
| `SCOUT_DISTANCE_EXPONENT` | `1.3` | gentle curve — most of the ramp sits in the back half |
| `SCOUT_ANOMALY_CHANCE` | `0.15` | per-completion roll |

`star.scout.fleetEnt` is a direct reference to the bound scout fleet — the closest **stationary, non-combat** player entity with the star in sensor range when scouting starts. If only a colony's sensor disc covers the star, `fleetEnt` is `null` (colony-style scout, can't be cancelled by movement).

**Cancellation rules** (checked every tick in `tickScouts`): the bound fleet must remain on the map, out of combat, and stationary. Any of these triggers `cancelScoutingStar(star, reason)`, which clears `star.scout` and re-renders the open panel back to the **Scout** button:

| Trigger | reason | Hint shown |
|---|---|---|
| Fleet picks a new destination | `moved` | "Scout aborted — scouting fleet received movement orders." |
| Fleet enters combat | `combat` | "Scout aborted — scouting fleet entered combat." |
| Fleet destroyed / removed | `lost`  | "Scout aborted — scouting fleet was destroyed." |

`fleetEnt` is dropped on save (object refs don't serialize); reloaded scouts proceed as colony-style — they can't cancel-on-move, and the damage-anomaly degrades to a benign "probe lost" result.

**Scout state on stars** survives save/load (added in `serializeGame` / `deserializeGame`). Older v1/v2 saves with no `scout` field load cleanly (defaults to none).

**Anomaly registry** — `SCOUT_ANOMALIES` table; one is rolled by weight when the chance fires:

| id | weight | kind | Effect |
|---|---|---|---|
| `scoutDamage` | 22 | `damageScout` | 25–50% combat damage spread across the scout fleet's ships; deaths remove the entity if wiped. |
| `techRandom` | 22 | `randomTech` | Picks a random `tech` template and fires its `TECH_EFFECTS` resolve at the star's world coords (instant or area). |
| `pirateAmbush` | 18 | `spawnPirates` | Spawns a small pirate fleet (1–8 ships, tier-scaled) at a small jitter from the star. Aggressive stance. |
| `resourceCache` | 14 | `resourceCache` | Random single resource (credits/minerals/energy/food, weighted), 2,000–18,000 scaled by distance. |
| `salvageCache` | 12 | `salvageCache` | Distance-scaled Salvage burst (~800 × distScale × 0.7–1.3). Added in v0.2.0 Phase 1. |
| `techGift` | 10 | `techGift` | Adds a random tech card to `techInventory`, also marked `researchedCards` + seen. |
| `artifactRelic` | 10 | `artifactRelic` | Prefers `categoryData.source === "exploration"` artifacts; falls back to any un-owned artifact; final fallback grants +8000 credits. Uses `grantArtifact(id)`. |
| `researchBreakthrough` | 4 | `researchBreakthrough` | Sets `activeResearch.progress = activeResearch.cost` and opens the 3-choice modal. If no active research, grants +500 research instead. |

Modal: `showAnomalyModal(star, anomaly)` builds an inline backdrop with title, flavor, result line, and (for `techGift` / `artifactRelic`) a card preview. Escape/Enter dismiss.

UI: while scouting, both the select panel and the system-overlay detected card render `renderScoutProgressHtml(star)` (progress bar + ETA). `tickScouts` calls `refreshScoutPanelsFor(star)` each frame for the live update. `drawStar` paints a sweeping arc around detected+scouting stars indicating progress.

### Camera

- Mouse drag pan; scroll-wheel zoom 0.3–3.0×, cursor-targeted; `worldToScreen` / `screenToWorld` transforms.
- Touch pan & pinch-zoom via Pointer Events (commit `b3388c6`).
- Right-click drag no longer deselects (v0.0.9.25 fix).

### Territory contour

Light-blue smoothed (Catmull-Rom) curve around the convex hull of colonized-system screen positions ([starmap.html:4712–4751](starmap.html)). Single colonized system gets a simple ring.

---

## 6. System View & Colonization

- Centered overlay, 88% area, max 1400×900 ([starmap.html:462+](starmap.html)).
- Opened by double-clicking an explored star.
- Canvas draws star (3.5× scaled) with orbital rings and orbiting planets; star card pinned top-left at 0.75 scale; planet card pops out on right when a planet is clicked, with a Colonize / Manage Colony action button.

### Planet generation

Planets are pre-rolled once at star creation:

- `rollStarPlanetSlots(template, rand)` at [starmap.html:2499](starmap.html) reads the star's `categoryData.planetGen = { count:[min,max], guaranteed:[rarities], bonus:N }`. Count rolls within `[min,max]`; the listed rarities are guaranteed; remainder rolls via `rollRarityWithBonus(bonus)`.
- `rollPlanetCardOfRarity(rarity)` at [starmap.html:2781](starmap.html) picks a template, rolls its bonuses ±25%, **and rolls a `size` value in [3,10] decoupled from rarity** (v0.2.0 Phase 1). Size sits on the card and the planet wrapper; pop growth past `colony.planetSize` will trigger an overcrowding cost ramp once Phase 4 (Idle Tuning) wires it. Today the field is shown on the planet card and colony header but doesn't yet penalise growth.
- `generatePlanets(star)` at [starmap.html:2812](starmap.html) names planets after the parent star with roman numerals and mirrors `card.size` onto `planet.size`.

### Colonization

- **Colony Ship gate** (commit `e2c418e`, v0.1.0 Phase 4 #10): A fleet/ship carrying a card with `special: "colonize"` must be within sensor range of the star. Without it, the Colonize button is disabled with tooltip "Move a fleet with a Colony Ship into sensor range of this star." `findColonyShipFleet(star)` at [starmap.html:2815](starmap.html); `colonizePlanet(star, planetIdx)` re-checks the gate at function entry to prevent stale UI bypass.
- **Cost** — `getColonizationCost(colonyCount)` at [starmap.html:6937](starmap.html):
  - 1st colony: free.
  - n ≤ 4: linear scaling `k = n`.
  - n > 4: doubling `k = 4 × 2^(n−4)`.
  - Resources: `credits = ceil(10000 × k)`, `minerals = ceil(5000 × k)`, `food = ceil(1000 × k)`.

| Colony # | k | Credits | Minerals | Food |
|---|---|---|---|---|
| 1st | — | 0 | 0 | 0 |
| 2nd | 1 | 10,000 | 5,000 | 1,000 |
| 3rd | 2 | 20,000 | 10,000 | 2,000 |
| 4th | 3 | 30,000 | 15,000 | 3,000 |
| 5th | 4 | 40,000 | 20,000 | 4,000 |
| 6th | 8 | 80,000 | 40,000 | 8,000 |
| 7th | 16 | 160,000 | 80,000 | 16,000 |
| 8th | 32 | 320,000 | 160,000 | 32,000 |

- On colonize: consume the Colony Ship card (`consumeColonyShip(colonyFleet)`), deduct cost, attach a fresh `colony` object to the planet (see §8) **with `planetSize` mirrored from the planet** (v0.2.0), push into the global `colonies[]` array.

---

## 7. Colony Screen

Centered 88% overlay, max 1400×900. Layout:

- **Header:** Colony name, population display (👤-equivalent + `(cur/max)`), `[+]` Grow button, resource output summary.
- **Left column (~250 px):** Leader slot (220×320, full card) → six action buttons → deck pile (138×200).
- **Right area:** 10 building slots in a flex 5×2 grid (auto-reflows to 4×3 / 3×4 at narrower widths). Queue strip below: cards at 0.625 scale, −50 px overlap, wrap enabled.

### Action buttons

Mapped via `ACTION_TO_CATEGORY` ([starmap.html:2221](starmap.html)):

| Button | Effect |
|---|---|
| Trade | Resource-only. Credits/tick = `TRADE_BASE_CREDITS (5) + Σ(non-credit production)/4`. See `getTradeIncome` at [starmap.html:6645](starmap.html). |
| Buildings | Generates building cards. |
| Admirals | Generates admiral cards. |
| Leaders | Generates leader cards. |
| Ships | Generates ship cards. |
| Terraform | Resource-only. Food/tick = `TERRAFORM_BASE_FOOD (5) + Σ(non-food production)/4`. Folded into raw food **before** starvation check so a Terraforming colony can self-rescue ([starmap.html:6707–6713](starmap.html)). |

### Colony data model ([starmap.html:6965–6975](starmap.html))

```js
planet.colony = {
  population: 1,                          // 1..10, each level = 1 unlocked building slot
  maxPopulation: 10,
  buildings: new Array(10).fill(null),    // index ≥ population is locked
  leaders: [],                            // max 1
  deck: [],                               // face-down { category, faceDown:true }
  queue: [],                              // face-up rolled cards
  activeAction: null,                     // "trade"|"buildings"|"admirals"|"leaders"|"ships"|"terraform"
  genTimer: 0,
  pendingDraw: null,                      // in-flight 3-choice modal state
}
```

Global: `colonies[]` of `{ starId, planetIdx, planet }` references ([starmap.html:6935](starmap.html)).

### Card draw scaling ([starmap.html:6400–6642](starmap.html))

Cost and interval for the next card both scale on two axes:

```
loadC = (cards of category in THIS colony)  / EXPECTED_PER_COLONY[category]
loadE = (cards of category EMPIRE-WIDE)     / EXPECTED_PER_COLONY[category]
mult  = (1 + loadC)^DRAW_K_C  ×  (1 + loadE)^DRAW_K_E
cost     = ceil(BASE_DRAW_COST × mult)
interval = BASE_DRAW_INTERVAL × mult
```

- `BASE_DRAW_COST = 500` (credits, brand-new colony first draw).
- `BASE_DRAW_INTERVAL = 30` (real-seconds, brand-new colony first draw).
- `DRAW_K_C = 1.25` (per-colony exponent).
- `DRAW_K_E = 0.75` (empire-wide exponent).
- `EXPECTED_PER_COLONY = { building:10, ship:5, captain:3, admiral:3, leader:1 }` (`captain` retained for back-compat).
- **Stack penalty:** `DRAW_STACK_PENALTY = 5` — each face-down card already on the pile multiplies the wait for the next by 5×. Encourages spending, not stockpiling. Cost paid at click time is unaffected — only the timer gates pile growth.

Cards are generated face-down at the rolling interval; clicking the deck opens a 1-of-3 rarity-weighted choice modal (or "Discard All"). Buildings/ships/admirals/leaders draw only from researched cards.

### Interaction

- **Drag-drop**: queue ↔ building slot (buildings only), queue ↔ leader slot (leaders only), slot → queue to return. HTML5 drag/drop API with drag-over highlights.
- **Tap-select** (touch-compatible, optional Phase 2 of `UI_RESPONSIVE_PLAN`): tap to mark selected, tap a valid target to place.
- **Magnify on click**: queue cards and placed cards open a `position: fixed` centered overlay appended to `document.body` (no clipping). Discard / Return-to-Queue / Close buttons.
- **Card-select modal**: 1-of-3 + "Discard All" pictured on deck-pile click.
- Placement deducts the card's `cost` from the global resource pool (not rearranging).

### Performance patterns

- `colonyDirty` flag — only full DOM rebuild when state changes.
- `refreshDeckDisplay(col)` — lightweight deck-only update fired the instant a card is generated (prevents "clicked but nothing draws" desyncs).
- Inline resource-display updates in the game loop, no full rebuild per frame.
- `cloneNode/replaceChild` on leader slot and queue to prevent event-listener accumulation.

---

## 8. Population & Starvation

### `POP_LEVELS` ([starmap.html:6415–6426](starmap.html))

| Level | Label | People | foodMaint/tick |
|---|---|---|---|
| 1 | 100K | 100,000 | 1 |
| 2 | 1M | 1,000,000 | 3 |
| 3 | 10M | 10,000,000 | 6 |
| 4 | 100M | 100,000,000 | 10 |
| 5 | 500M | 500,000,000 | 15 |
| 6 | 1B | 1,000,000,000 | 22 |
| 7 | 5B | 5,000,000,000 | 30 |
| 8 | 50B | 50,000,000,000 | 42 |
| 9 | 200B | 200,000,000,000 | 58 |
| 10 | 1T | 1,000,000,000,000 | 80 |

Each level = one more unlocked building slot.

### Growth — buy-only

Passive growth from food surplus has been removed. `buyPopulation()` at [starmap.html:6446](starmap.html) is the only path:

```
getPopGrowthCost(nextLevel):
  k = 2^(nextLevel - 1)
  credits = ceil(2500 × k)
  food    = ceil(1250 × k)
```

| → Level | k | Credits | Food |
|---|---|---|---|
| 2 | 2 | 5,000 | 2,500 |
| 3 | 4 | 10,000 | 5,000 |
| 4 | 8 | 20,000 | 10,000 |
| 5 | 16 | 40,000 | 20,000 |
| 6 | 32 | 80,000 | 40,000 |
| 7 | 64 | 160,000 | 80,000 |
| 8 | 128 | 320,000 | 160,000 |
| 9 | 256 | 640,000 | 320,000 |
| 10 | 512 | 1,280,000 | 640,000 |

### Starvation — production penalty, not pop decline

`getColonyOutput()` at [starmap.html:6717–6722](starmap.html):

```js
const maintenance = getFoodMaintenance(colony.population);
const starving = (raw.food - maintenance) < 0;
for (const id of RESOURCE_IDS) out[id] = raw[id] * (starving && id !== "food" ? 0.2 : 1);
out.food -= maintenance;
```

While food rate is negative, **non-food production drops to 0.2×**. Food itself stays full so players can recover by building food producers or activating Terraform. There is **no 30-second timer**, no population drop, and no slot relock anymore — older docs that describe those are stale. The "saves starving colonies" fix in v0.0.9.25 is the Terraform-folds-into-raw-food behaviour described in §7 — it lets a colony with non-food production climb out of a deficit by Terraforming.

---

## 9. Economy

### Resources

`RESOURCE_DEFS` at [starmap.html:7392](starmap.html), iterated everywhere (never hard-coded). v0.2.0 Phase 1 expanded the catalog from 5 to 10. Each entry carries `category` (`"base" | "generic" | "exotic"`) and a `defaultPinned` flag that drives the top-bar rack.

| id | category | defaultPinned | Notes |
|---|---|---|---|
| `credits` | base | ✓ | gold currency |
| `energy` | base | ✓ | |
| `minerals` | base | ✓ | |
| `research` | base | ✓ | |
| `food` | base | ✓ | |
| `salvage` | generic | — | v0.2.0 — scrap/kill/scout-anomaly drop; spent on deck edits + card rerolls |
| `antimatter` | exotic | — | REFINED from energy + minerals via a special building |
| `darkmatter` | exotic | — | EXTRACTED from rare planets / high-rarity stars |
| `bioplasm` | exotic | — | EXTRACTED from organic planets + dropped by mid-tier NPCs |
| `dragonshard` | exotic | — | DROPPED only by dragons; Singularity Dragon drops 10× |

`STARTING_RESOURCES = { credits: 5000, energy: 5000, minerals: 5000, research: 0, food: 5000 }` ([starmap.html:7429](starmap.html)). Note `research: 0` — you must produce research before you can spend it. Salvage and exotics start at 0 and only enter circulation via their respective gameplay loops.

Resource palette (colors_and_type.css): credits = gold, energy = cyan, minerals = stone grey, research = magenta, food = sage green, salvage = warm brass, antimatter = violet, darkmatter = indigo, bioplasm = bio-green, dragonshard = ember orange.

### Top-bar resource rack (v0.2.0 Phase 1)

The rack iterates `RESOURCE_DEFS.filter(d => pinnedResources.has(d.id))`. Per-cell features:

- **Progress bar**: thin fill across the bottom of each cell, width = `tickAccumulator / TICK_PERIOD`. Acts as a shared "tick clock" so the player feels the economy rhythm even when individual gains are sub-1/sec. Visible when `resourceProgressMode !== "off"`.
- **Right-click cell** to unpin (the rack keeps at least one resource pinned so the bar isn't empty).
- **Chevron button** (`#tb-res-more`) at the rack's right edge → opens `#tb-res-dropdown`, a panel listing every resource with value + rate + Pin/Unpin button.

Settings persisted in save:

- `pinnedResources: string[]` — which resource ids show in the rack.
- `resourceProgressMode: "off" | "bar" | "cell"` — default `"bar"`. The mode toggle UI lands later; for now the field is read but only `bar`/`off` affect rendering.

### Income

- **Trade action**: `TRADE_BASE_CREDITS (5) + Σ(non-credit production)/4` per tick — output-scaled, not population-scaled (changed in v0.0.9.20, then again with output-scaling).
- **Buildings**: each unlocked slot adds its `stats[id]` and subtracts its `upkeep[id]`.
- **Leaders**: same as buildings, but also apply `bonuses[id]` as **% multipliers** to total raw output ([starmap.html:6687–6694](starmap.html)) — see §11.
- **Planet bonuses** (planet card's `bonuses`): % multipliers applied **on top of** leader bonuses (multiplicative compound) at [starmap.html:6695–6701](starmap.html).
- **Terraform action**: `TERRAFORM_BASE_FOOD (5) + Σ(non-food production)/4` per tick, folded into raw food **before** starvation check.
- **Baseline colony food** (v0.2.0 Phase 1, `BASELINE_COLONY_FOOD = 2`): a fixed amount added to raw food every tick regardless of buildings or pop, folded **before** the starvation check. Stops fresh pop-1 colonies from being born starving. Does NOT scale with population — once the colony grows, real food producers carry the maintenance load.

`getColonyOutput(colony, planet)` at [starmap.html:8136](starmap.html) is the canonical resource math — building/leader sums, leader bonus multiplier, planet bonus multiplier, baseline food, terraform food, starvation penalty, food maintenance subtract.

### Salvage drop sources (v0.2.0 Phase 1)

`SALVAGE_BY_RARITY = { common: 5, uncommon: 15, rare: 60, epic: 300, legendary: 2000 }` ([starmap.html:~4090](starmap.html), placeholder; Phase 4 tunes). Three drop paths:

1. **Scrap a card** — `getCardScrapSalvage(card)` is granted when the player:
   - Discards a queue card via the magnified-card "Discard" button.
   - Picks one card from the deck-pile choice modal (the 2 unchosen are scrapped).
   - Hits "Discard All" in the deck-pile choice modal (all 3 rolled choices are scrapped).
2. **Kill a hostile fleet** — per dead ship, salvage = `SALVAGE_BY_RARITY[rarity] × faction.lootSalvageMul`. Pirates: 1.0×; Dragons: 10×. Lands in `loot.resources.salvage` inside `rollCombatLoot`.
3. **Scout anomaly `salvageCache`** — distance-scaled Salvage burst (~800–4800), mirrors `resourceCache` payload shape.

### Dragonshard drop (v0.2.0 Phase 1)

Only dragons drop dragonshard. Per dragon ship: `dragonshard = round(SALVAGE_BY_RARITY[rarity] × 0.1)`. Singularity Dragon (`card.id === "drg_singularity"`) gets a 10× multiplier on top.

### Expenses

| Sink | Where | Formula |
|---|---|---|
| Building / leader upkeep | `getColonyOutput` | Subtracted from raw production per resource. |
| Food maintenance | `getColonyOutput` | `getFoodMaintenance(pop)` per `POP_LEVELS`. |
| Card draw | `getDrawScaling` | See §7 draw scaling. |
| Card placement | drag-drop handlers | One-time `card.cost` deducted from global pool. |
| Colonization | `getColonizationCost` | See §6 table. |
| Population purchase | `getPopGrowthCost` | See §8 table. |

### Tick loop ([starmap.html:6725–6810](starmap.html))

```
tickEconomy(dt):
  tickAccumulator += dt
  for each colony with activeAction other than Trade/Terraform:
    advance genTimer; if past getColonyGenInterval, push face-down card
  while tickAccumulator >= TICK_PERIOD (=1 game-second):
    for each colony:
      out = getColonyOutput(col, planet)
      resources += out
      resources.credits += getTradeIncome(col, out)
    if activeResearch and resources.research > 0:
      spend = min(RESEARCH_SPEND_RATE, resources.research, remaining_cost)
      …
```

`scaledDt = dt × BASE_GAME_SPEED × gameSpeed` is computed once in the game loop ([starmap.html:8051–8300](starmap.html)) and passed to both `tickEconomy(dt)` and `tickEntities(dt)`. No subsystem applies its own speed multiplier on top.

---

## 10. Research

Single-pool, 1-of-3 modal at completion. The per-category-button UI is gone.

- **Gated categories**: `RESEARCH_GATED_CATEGORIES = ["building", "ship", "admiral", "leader", "tech"]` ([starmap.html:6716](starmap.html)). Stars and planets are never gated. Artifacts are never gated either — they live in `ownedArtifacts`, not `researchedCards`.
- **Auto-unlock**: All common cards in `building/ship/admiral/leader` are unlocked at game start **except** those tagged `non-starter`. **Tech and artifact never auto-unlock** — they only enter via the research-choice modal or loot drops.
- **Cost** ([starmap.html:6821](starmap.html)): `cost = ceil(RESEARCH_BASE_COST × RESEARCH_COST_MULTIPLIER^nonTechCount)`, where `nonTechCount = researchCounts.building + .ship + .admiral + .leader + .artifact`. **Tech is excluded from the count** — spamming tech picks doesn't raise the next research price; only permanent unlocks do. `RESEARCH_BASE_COST = 500`, `RESEARCH_COST_MULTIPLIER = 2.0`.

| 5 unlocks owned | Cost |
|---|---|
| 0 | 500 |
| 1 | 1,000 |
| 2 | 2,000 |
| 3 | 4,000 |
| 4 | 8,000 |
| 5 | 16,000 |
| 10 | 512,000 |

- **Spend rate**: `RESEARCH_SPEND_RATE = 5` points / game-second, multiplied by `(1 + sum(researchSpeedPercent artifacts) / 100)`. Caps spending so research takes real time even with overflowing income.
- **State**: `activeResearch = { cost, progress }` (no category — single pool). `pendingResearch = { choices: [card, card, card] } | null` holds the 3 candidates between completion and the player's pick.
- **3-choice roll** ([starmap.html `rollResearchChoices`](starmap.html)): per slot, **66% chance tech**, 34% non-tech (split across `building/ship/admiral/leader/artifact` with weights `[3,3,3,3,2]`). Each candidate uses `rollResearchResult(category)` (existing weight machinery: `common:200, uncommon:60, rare:15, epic:3, legendary:0.3` × per-card `weight`). Artifact slots filter by `categoryData.source === "research" && !ownedArtifacts.has(id)`. Dedupe across slots; up to 5 retries per slot, then a guaranteed-fallback sweep.
- **Modal** (`#research-choice-backdrop` / `#research-choice-modal`, top-level so it works outside the colony screen): backdrop click dismisses but **preserves `pendingResearch`** so the choices reappear when the panel reopens. A green banner at the top of the Research panel (with an "Open" button) indicates a pending pick.
- **Pick handling** (`acceptResearchChoice`):
  - tech → `techInventory[id]++`, also added to `researchedCards`, `researchCounts.tech++`.
  - artifact → `grantArtifact(id)` (effect lives immediately), `researchCounts.artifact++`.
  - building/ship/admiral/leader → `researchedCards.add(id)`, `researchCounts[cat]++`.
- **Save/load**: `pendingResearch.choices` are serialized via `serializeCardRef` and rehydrated on load; v1 saves migrate silently (`pendingResearch` defaults to `null`).
- **`rollCardFromCategory("tech" | "artifact")`** is a coding error — it `console.warn`s and returns null. Tech only enters via research, artifact only via research/loot.
- **Auto-continue** (v0.2.0 Phase 1): `autoContinueResearch` (default `true`, persisted). When set, `acceptResearchChoice` calls `startResearch()` immediately after `pendingResearch = null`, so idle players don't lose all research production while a pending modal is dismissed. Toggle lives in the Research panel idle UI.

### 10b. Artifact effect registry

`ARTIFACT_EFFECTS` ([starmap.html:6584](starmap.html)) — flat permanent effects keyed by `categoryData.effect.kind`. Aggregated lazily via `getArtifactBonuses()` with a version cache invalidated by `bumpArtifactVersion()` (called from `grantArtifact`, `clearGameState`, `deserializeGame`).

| Kind | Args | Wired in | Effect |
|---|---|---|---|
| `flatResourcePerColony` | `{ id, amount }` | `getColonyOutput` after planet bonuses | `+amount` to that resource per colony per tick |
| `flatResourcePerTick` | `{ id, amount }` | `tickEconomy` after the colony loop | `+amount` empire-wide per tick |
| `bonusFleetSize` | `{ amount }` | `getMaxFleetShips` wrap | `+amount` to base fleet cap (with or without admiral) |
| `sensorRangePercent` | `{ amount }` (percent) | `recalcFleetStats` post-admiral; `getEffectiveBaseSensorRange()` wraps the 4 `BASE_SENSOR_RANGE` callsites | Multiplies all sensors by `(1 + amount/100)` |
| `researchSpeedPercent` | `{ amount }` (percent) | research-spend block in `tickEconomy` | Multiplies `RESEARCH_SPEND_RATE` |
| `colonyShipDiscount` | `{ percent }` | `getColonizationCost` | Multiplies cost by `max(0.1, 1 - percent/100)` |

`grantArtifact(id)` is the entry point. It dedupes, bumps the cache version, and re-runs `recalcFleetStats` / sensor reset on existing player fleets/ships so a sensor-bonus artifact visibly grows the disc immediately.

### 10c. Tech effect registry

`TECH_EFFECTS` ([starmap.html:6660](starmap.html)) — consumable activatable effects. Each entry: `{ instant: bool, resolve(args, wx?, wy?) → bool }`. Played from the Collection Tech tab via the Play button on owned cells.

| Kind | Args | Mode | Effect |
|---|---|---|---|
| `gainResources` | `{ deltas: { credits: 5000, ... } }` | instant | `resources[id] += v` for each delta |
| `instantHealAllPlayerShips` | `{ percent }` | instant | Restores `percent`% of max shields/armor on every non-in-combat player ship |
| `areaDamage` | `{ radius, damage }` | targeted | Iterates `mapEntities` where `owner === "npc" && !inCombat` within radius; spreads damage across fleet ships via `applyTechShipDamage` (drains `_combatShields` → `_combatArmor`); removes dead ships and entities |
| `areaHeal` | `{ radius, amount }` | targeted | Iterates `mapEntities` where `owner === "player" && !inCombat`; restores armor then shields |
| `instantRevealRadius` | `{ radius }` | targeted | `detectStarsInRange(wx, wy, radius)` + `markSeenInRange` |

**Targeting mode** ([starmap.html `playTechCard`](starmap.html)):
- Activating a targeted tech sets `techTargetingMode = { cardId, kind, args }` and closes the Collection.
- `pointermove` updates `techTargetingCursor` in **world coords** so the reticle sticks to the same point under camera pan/zoom.
- `render()` calls `drawTechTargetingReticle(ctx)` after the territory contour — translucent disc + crosshair, color from `TECH_RETICLE_COLOR` (red/green/blue per kind).
- The next canvas click resolves at `screenToWorld(sx, sy)` and consumes the charge regardless of whether anything was hit (click = commitment).
- ESC key or right-click cancels without consuming.
- A floating banner (`#tech-targeting-banner`, `pointer-events:none`) tells the player which card is mid-cast and how to cancel.

**v1 limitation**: in-combat ships are intentionally skipped to avoid syncing into the active combat's `combat.sideX.ships` snapshot. A "deployable mid-combat" version is a future phase.

- **Rebalance history**: v0.0.9.15 tightened building upkeep on research-producers; v0.0.9.16 reworked costs and weights and introduced the non-starter tag. The artifact + tech rework (this edit) replaced per-category research with the single-pool 3-choice modal and added the two new categories end-to-end.

---

## 11. Leader Bonuses & Planet Bonuses

Both apply as **percentage multipliers**, applied multiplicatively (compound) in this order ([starmap.html:6687–6701](starmap.html)):

```js
// 1. Sum building stats and upkeep
// 2. Add leader stats and subtract leader upkeep
// 3. Multiply by leader bonuses
for (const l of colony.leaders) if (l && l.bonuses)
  for (const id of RESOURCE_IDS)
    if (l.bonuses[id]) raw[id] *= (1 + l.bonuses[id] / 100);
// 4. Multiply by planet bonuses (stacks on top)
if (planet.card.bonuses)
  for (const id of RESOURCE_IDS)
    if (planet.card.bonuses[id]) raw[id] *= (1 + planet.card.bonuses[id] / 100);
```

- Leader's `bonuses` and `bonusRanges` are rolled at draw time (±25%, with rarity-blended bias). Color-tinted via `statColorStyle(card, "bonusRanges", key, val, defaultColor)`.
- Leader `stats` (flat additions) and `bonuses` (percent) are separate fields and stack.
- Planet bonuses come from the planet template's `categoryData.bonuses` and are pre-rolled at `generatePlanets`.

**v0.0.9.22 reworked** the leader system; **v0.0.9.23** wired bonuses end-to-end ("leader bonuses actually work"). Before v0.0.9.23 the multipliers were rolled but never applied to output.

---

## 12. Fleet & Entity System

### `mapEntities[]`

Two entity types, both `owner ∈ {"player","npc"}`, `stance ∈ {"aggressive","evasive"}`, `inCombat: null | combatId`, plus position and (optional) destination.

| Type | Shape |
|---|---|
| Solo ship | `{ type:"ship", card, owner, stance, x, y, destX, destY, … }` — uses its own card stats. |
| Fleet | `{ type:"fleet", ships:[card,…], admiral:card?, owner, stance, label, x, y, derived stats, inCombat }` — admiral optional. |

### Derived fleet stats (`recalcFleetStats`)

- `speed = min(ships.speed)` — one slow tug holds the fleet back.
- `sensorRange = max(ships.sensorRange)` — best sensor wins.
- `stealth = min(ships.stealth)` — one clunky ship blows cover.
- Damage = sum across ships.
- Admiral `commandBonus` multiplies all ship stats by `(1 + commandBonus/100)` ([starmap.html:2981–2982](starmap.html)); admiral-specific stat bonuses apply per-stat on top.

### Fleet size cap ([starmap.html:3062](starmap.html))

```js
admiral ? (admiral.stats.maxFleetSize || 4) : 3;
```

Without an admiral, fleets cap at 3 ships. With one, cap is the admiral's rolled `maxFleetSize` (typical ranges by rarity: common 4–7, uncommon 6–12, rare 11–24, epic 20–36, legendary 30–50).

### Deployment & travel

Colony screen has a Fleet tab with a deploy area: drag ship cards into deploy slots (`deployShips[]`), optionally drag an admiral, then "Deploy Fleet" or "Deploy Solo" ([starmap.html:7285–7763](starmap.html)). Entities are placed at the colony star with a small offset (40 units) so they don't all stack on the home pixel.

Travel math ([starmap.html:3094–3120](starmap.html)):

```
ent.x += dir.x × ent.speed × dt × WORLD_SPEED_MULT
ent.y += dir.y × ent.speed × dt × WORLD_SPEED_MULT
```

with `WORLD_SPEED_MULT = 0.8`. ETAs come from `formatETA(gameSec)` at [starmap.html:2911](starmap.html), displayed in the entity info panel and as a label under traveling entities on the starmap.

Selected-entity info panel: ship/fleet stats, stance toggle, disband button (only at a colony — returns cards to queue), movement orders via click destination. Right-click drag pan (v0.0.9.25) does not deselect.

---

## 13. Combat

Combat is volley-based and runs in-line with the rest of the game loop but is slowed by `COMBAT_TIME_SCALE = 1 / 100` ([starmap.html:6378](starmap.html)) — combat ticks 100× slower than wall-clock, preserving the pre-real-time tempo while everything else scales with `BASE_GAME_SPEED`.

### Constants ([starmap.html:6377–6391](starmap.html))

| Constant | Value | Meaning |
|---|---|---|
| `SHOT_INTERVAL` | 0.5 game-s | Time between shots in a volley. |
| `COMBAT_TIME_SCALE` | 1/100 | Combat tick slowdown. |
| `COMBAT_HP_SCALE` | 5 | Multiplier on ship shields/armor for combat durability. |
| `RANGE_THRESHOLDS` | `{long:1000, medium:650, short:350}` | World-unit distance at which each weapon range can fire. |
| `ENGAGED_DISTANCE` | 200 | Entities stop closing at this distance. |
| `VISUAL_DT_FACTOR` | 0.1 | Particles tick at `scaledDt × 0.1` so weapon flashes look the same across `BASE_GAME_SPEED` rebases. |
| `COMBAT_TRIANGLE` | (see [starmap.html:6395](starmap.html)) | Per-weapon multipliers vs shields/armor: energy 2/0.5, kinetic 0.5/2, missile 1/1. |

### Engagement

`checkCombatEngagements()` scans non-combat, opposite-owner entities within sensor range (with stealth penalty). Engagement rules per stance (CORE_PLAN D4):

| Attacker | Defender | Outcome |
|---|---|---|
| Aggressive | Aggressive | Both turn toward each other; combat begins. |
| Aggressive | Evasive | Speed-based evasion roll; if failed, combat begins. |
| Evasive | Aggressive | Same — symmetric. |
| Evasive | Evasive | Pass each other; no engagement. |

Evasion: `clamp((mySpeed - theirSpeed) / mySpeed, 0, 1)`.

### Combat loop ([starmap.html:3244–3570](starmap.html))

- Phase: `closing` → `engaged` (when `combat.distance ≤ ENGAGED_DISTANCE`).
- Each tick: entities close at full speed; recompute `combat.distance`; if engaged, on every `SHOT_INTERVAL` each alive ship on each side fires all weapons whose `RANGE_THRESHOLDS[range] ≥ distance`.
- **Hit roll**: `0.70 + sensor × 0.01 − stealth × 0.05 − speed × 0.005`, clamped 0.10–0.95.
- **PD interception (missiles)**: `min(0.80, totalPD × 0.02)` rolled per missile.
- **Damage**: weapon's vs-shields multiplier reduces shields first; on shield depletion, vs-armor multiplier hits armor; ship dies when armor reaches 0. Shields and armor are `card.stats.* × COMBAT_HP_SCALE`.

### Disengagement

Switch to evasive stance mid-combat → speed-based breakaway roll each tick. Both sides survive on success.

### Visuals

- Starmap: red glowing line between combating entities, pulsing ⚔ icon at midpoint (clickable to open overlay), weapon-coloured particle bursts (`--wpn-energy/kinetic/missile`; 8 particles on hit, 3 on miss).
- Combat overlay (~81% area, 0.75 opacity): both sides' ship rosters with rarity-coloured shield/armor HP bars, phase indicator, distance bar, round counter, next-volley countdown, scrolling colour-coded combat log (engage / range / miss / hit / kill / intercept / disengage). Log persists across open/close for the duration of the combat.

### Resolution

Loser removed from map. Winner's surviving ships persist damage on `card._combatShields` / `_combatArmor`; entity unlocked and resumes movement; dead ships filtered from the fleet, stats recalculated.

---

## 14. NPC Factions

NPCs are organized as a registry of **factions** ([`NPC_FACTIONS`, starmap.html:2330](starmap.html)). Each faction plugs into a single shared spawn / loot / render pipeline; adding a new hostile NPC is a data add (one registry entry + N cards), not a refactor. Every NPC fleet carries a `faction` field on its entity (`"pirate" | "dragon" | …`); old saves without the field default to `pirate`.

Per-chunk: `generateChunk()` iterates every faction and rolls each independently against the chunk's base spawn chance (`0.16` cluster / `0.048` void), multiplied by `faction.spawnChanceMul × (1 + 4 × tier)`. Each faction has its own `safeRadius`, `tierRange`, `tierExponent`, `fleetSize` distribution (`exponential` heavy-tail or `fixed` count), `rarityWeights(tier)` curve, and optional `cardFilter(card, tier)` predicate for tier-gating specific templates. Loot routing is controlled by `cardLootBucket` (currently both factions write to `pirateLoot`) and `artifactDrop` (per-combat artifact roll fires only for factions that opt in).

The shared spawner is `maybeSpawnNpcFleet(rng, cx, cy, density, centerX, centerY, faction)` ([starmap.html:2432](starmap.html)); the shared card-pick is `rollNpcShip(rng, tier, faction)` ([starmap.html:2417](starmap.html)). Legacy `getPirateTier` / `rollPirateShip` are thin shims onto these.

### Pirates

- Spawn probability: cluster chunks `~0.16 × tierMul`, void chunks `~0.048 × tierMul`, where `tierMul = 1 + 4 × getPirateTier(x, y)`.
- `safeRadius: 1500`, `tierRange: 80000`, `tierExponent: 1.5` (legacy aliases `PIRATE_HOME_SAFE_RADIUS`, `PIRATE_TIER_RANGE`, `PIRATE_TIER_EXPONENT` retained at [starmap.html:2374–2376](starmap.html)). Tier ramps from 0 (home) to 1 (edge) as `pow(min(1, dist / PIRATE_TIER_RANGE), 1.5)`. Higher tier = rarer pirate ships in the spawn pool.
- Fleet size: heavy-tail exponential (`base: 1, perTier: 5, max: 30`) — most spawns 1–2 ships, occasional ~6-ship fleets at max tier.
- Behaviour: always aggressive, patrol random (~0.2%/frame chance to pick a new destination ±150 units).
- Rendered in crimson `#c04040`; chevron icon with ship count.
- `pirate` is a real card category (6 templates in `game-cards.json`) — uses the ship renderer with subtype "Pirate".
- **Pirate loot** (v0.1.0 Phase 4 #9, commit `1fb9c83`): destroyed pirate fleets drop pirate cards as trophies into `pirateLoot[id]`. They count toward Collection ownership but are not yet deployable into colonies or map entities — "trophies only for v0.1.0; deployable-pirate-ships is a possible future phase" ([starmap.html:6470–6473](starmap.html)).
- Per-combat artifact-drop roll (`LOOT_ARTIFACT_DROP_CHANCE`) fires only against pirate fleets (`artifactDrop: true`).

### Dragons

- Spawn probability: `0.1 ×` the pirate base — one dragon per chunk where ~10 pirate fleets would have spawned. Same `tierRange/tierExponent` ramp.
- `safeRadius: 2500` — wider than pirates because even the weakest dragon is ~2× a `Dreadlord Prime`.
- Fleet size: **fixed at 1**. Always solo; no escorts, no swarms.
- Card pool: 8 templates, all `legendary`. `cardFilter` tier-gates the two outliers — `drg_white` only spawns at `tier ≥ 0.5` (~28k units from home), `drg_singularity` only at `tier ≥ 0.85` (~60k units).
- Stat scaling vs. `Dreadlord Prime` (`shields 70 / armor 90`, total dmg 108): six colored Star Dragons at 2×, White Star at 10×, Singularity at 100×. Damage budget redistributes by color theme (red = kinetic-heavy, blue = energy-heavy, etc.) without changing total threat.
- `sensorRange: 2` (→ 100 world units of detection). `ENGAGED_DISTANCE = 200`, so dragons only aggro the player at point-blank distance. They sit and patrol until you're nearly on top of them.
- Behaviour: always aggressive, same idle-patrol as pirates.
- Rendered in gold `#d4a020` to distinguish from crimson pirates.
- Loot: dragon cards land in the shared `pirateLoot` bucket and surface in the Collection's "Entities" tab, which groups every NPC faction under per-faction section headers. Dragons opt out of the artifact-drop roll for now — `artifactDrop: false`.

---

## 15. Time & Speed

- `BASE_GAME_SPEED = 2.0` — global baseline; 1× is 2× real-time. ([starmap.html:6368](starmap.html))
- `TICK_PERIOD = 1` game-second per resource tick.
- `WORLD_SPEED_MULT = 0.8` — entity movement secondary multiplier.
- `VISUAL_DT_FACTOR = 0.1` — particle/visual rebase.
- `COMBAT_TIME_SCALE = 1/100` — combat-only.
- Player-facing speed buttons render at [starmap.html:1672–1675](starmap.html):

| Button | `data-speed` |
|---|---|
| ⏸ Pause | 0 |
| 1× | 1 (default active) |
| 50× | 50 |
| ⏩ (150×) | 150 |

- `scaledDt = dt × BASE_GAME_SPEED × gameSpeed` is the single master clock, computed once per frame in the game loop ([starmap.html:8051+](starmap.html)) and passed to `tickEconomy(dt)` and `tickEntities(dt)`. Combat applies its own `× COMBAT_TIME_SCALE` on top.
- Paused-state ETAs use `gameSpeed > 0 ? gameSpeed : 1` as a fallback so the UI doesn't show infinity ([starmap.html:2925, 4267, 4269](starmap.html)).
- **Pacing vision** (long-term): combat = days, travel = hours, card drops ~1–2/colony/day. Current values are dev tuning. Don't design systems that only work at fast speed — `BASE_GAME_SPEED` should be a single tunable knob.

---

## 16. Save / Load

- `SAVE_VERSION = 3` (bumped in v0.2.0 Phase 1). `SAVE_LOAD_MIN_VERSION = 1` — the loader accepts any save in `[1, 3]` and silently defaults missing fields. v1 and v2 saves load without losing progress; fields new to v3 (`pinnedResources`, `resourceProgressMode`, `autoContinueResearch`, `planet.size`, `colony.planetSize`, plus the salvage / exotic resources) initialize to sensible defaults. `AUTOSAVE_KEY` stays `idlespace_autosave_v1` so existing autosaves keep loading.
- `AUTOSAVE_KEY = "idlespace_autosave_v1"`, `AUTOSAVE_INTERVAL_MS = 60000` — autosaves every 60 real seconds and on page close (`setInterval(doAutosave, …)` at [starmap.html:8922](starmap.html)).
- Manual export/import via the save menu in the top bar (export downloads JSON; import opens file picker).
- `serializeGame()` and `deserializeGame(data)` cover:
  - All resources (5 base + salvage + 4 exotics as of v0.2.0).
  - All colonies (population, buildings, leaders, deck, queue, activeAction, genTimer, pendingDraw, **`planetSize`** — v0.2.0).
  - All planets (orbit fields, colony, **`size`** — v0.2.0).
  - All map entities (ships, fleets, positions, destinations, stance, owner, inCombat, damage).
  - `researchCounts`, `researchedCards`, `seenCards`, `pirateLoot`, `activeResearch`, **`pendingResearch`** (Phase 3), **`ownedArtifacts`** + **`techInventory`** (Phase 1).
  - **`autoContinueResearch`**, **`pinnedResources`**, **`resourceProgressMode`** (v0.2.0).
  - `gameSpeed` (auto-paused on load — user resumes explicitly).
  - Star map state (explored / detected flags, generated planets).
- Tech-targeting state (`techTargetingMode`, `techTargetingCursor`) is intentionally session-only — saving mid-cast doesn't restore the reticle.
- Card references are stored by `id`; full template is re-resolved from `game-cards.json` (or the override) at load. Missing IDs drop with a console warning (CARDS_PIPELINE_PLAN Phase 4).

A separate IndexedDB store (`idlespace_cards / kv`) holds the card-builder override (`gameCardsOverride` key). Distinct from the localStorage autosave.

---

## 17. UI Architecture

### Top bar

- Logo + version badge.
- Centered resource rack (5 counters with per-tick rates).
- Speed buttons (Pause, 1×, 50×, 150×).
- Action buttons (right-aligned): Colonies, Fleets, Collection, Research, Save menu.
- See [`ui/topbar.css`](ui/topbar.css).

### Overlays

All overlays follow the same pattern — backdrop div + centered overlay div + `.visible` class toggle + 0.3 s opacity transition. Mouse `mousedown` / `wheel` / `contextmenu` handlers check for overlay IDs to prevent starmap interaction bleed-through.

| Overlay | Trigger | Notes |
|---|---|---|
| Select panel | click star | 280-px right-side panel, star card + Explore / View System. |
| System view | dbl-click star | 88% area, max 1400×900; canvas star + planets. |
| Colony screen | dbl-click colonized planet, or Colonies → pick | 88% area; building grid + leader + deck + queue. |
| Colonies list | top-bar Colonies | scrollable list. |
| Fleets list | top-bar Fleets | inventory + status. |
| Collection | top-bar Collection (v0.1.0 Phase 4 #11) | Tabs (in order): Tech, Artifacts, Ships, Buildings, Leaders, Admirals, Planets, Stars, Pirates. Tech tab cells get a Play button on owned cards. |
| Research panel | top-bar Research | Single Start Research button + per-tick progress bar + per-category unlock summary (excludes Tech). |
| Research choice modal | research completes | Top-level `#research-choice-backdrop` (z-index 60) with 3 cards. Backdrop click dismisses but `pendingResearch` survives so the choices reappear. |
| Tech targeting banner | targeted tech card played | Floating banner near top of screen, pointer-events: none. Reticle drawn in canvas. |
| Combat | click ⚔ icon | colony-screen-sized, semi-transparent. |
| Card-select modal | click deck pile | 1-of-3 + Discard All. |
| Magnified card | click any card | `position:fixed` centered, appended to `document.body`. |

### Card chrome

All six player categories + pirate use the metallic `.tpl-metal` template — shared chrome from `ui/card-chrome.css`, per-type middle content from `ui/<type>-card.css`. Known gotchas: never use `backdrop-filter` inside a card (interacts badly with the outer `drop-shadow` filter and the `mix-blend-mode: overlay` on `.bg::before` — silently hides every sibling below the image). The numeric formatting helper is `formatResourceValue()` (mirrored in both `starmap.html` and `card-builder.html`).

### Icons

Zero emojis in HTML (full sweep completed in commit `f82cff7`). Every glyph is an SVG sprite use: `<svg class="ico"><use href="#i-..."/></svg>`, via `ico(id, classes)` helper. Sprite at [`ui/icons.html`](ui/icons.html).

### Responsive / touch

- Touch pan / pinch-zoom on starmap (Pointer Events, commit `b3388c6`).
- Body-scaling rebased to native viewport-meta scaling (commit `40e35dd`).
- Design width 1920 px (commit `62d1207`).
- Phases not yet shipped: CSS variable + clamp() scaling for card / slot dimensions, tap-to-place in colony, hi-DPI canvas.

### Font sizes

~143 hard-coded `font-size: Npx` values across HTML files; consolidation into rem-based design tokens is planned but not started.

---

## 18. Card Builder Companion

[`card-builder.html`](card-builder.html) (2,374 lines) — standalone 3-panel app:

- **Left**: catalog sidebar with category / rarity / tag filters. Rarity-coloured dots, tag pills.
- **Center**: live preview, zoom toggle (1× / 3×), per-card watermark + chrome.
- **Right**: editor — name, category, rarity, image upload, stats / cost / upkeep / bonuses key-value lists, special / flavor, tags, weight, attributes, `categoryData` (per-category fields).

For artifact / tech cards, the editor swaps the stats section for an **Effect (JSON)** textarea (paste `{"kind":"...","amount":5}` etc.). Artifact also gets a **Source** dropdown (`pirate` / `research` / `exploration`). `CATEGORY_DATA_KEYS` in the builder includes `artifact:["source","effect"]` and `tech:["effect"]` so removed values are correctly cleared on save.

**Live sync**: IndexedDB `idlespace_cards / kv / gameCardsOverride`. "Apply to live game" button writes the full bundle; starmap reads it on next load (and badges that an override is active). Explicit push — never auto-applies on keystroke.

**Import / Export**: JSON in/out via header buttons. Sidecar-PNG zip export is planned in CARDS_PIPELINE_PLAN Phase 3 (images currently embedded as `data:` URLs).

Renderers are mirrored — every `build<Type>CardHtml(data)` in `card-builder.html` matches the equivalent in `starmap.html`. Keep them in sync when adding fields.

---

## 19. Version History

Tagged releases plus notable untagged commits, newest first.

| Version | Headline |
|---|---|
| **v0.2.0 Phase 1** (HEAD, in progress) | **Foundation** for v0.2.0. Adds Salvage + 4 exotic resources (antimatter, darkmatter, bioplasm, dragonshard) with the rack iterating `RESOURCE_DEFS`. Salvage drops from scrapping cards, killing NPC fleets (dragons 10×), and the new `salvageCache` scout anomaly; dragons additionally drop dragonshard with the Singularity Dragon at 10× more. New colonies get `BASELINE_COLONY_FOOD = 2` per tick so pop-1 colonies aren't born starving. `acceptResearchChoice` auto-queues the next research when `autoContinueResearch` is on (default). Planets get a `size` field decoupled from rarity (3–10) shown on the planet card + colony header — the steep overcrowding cost ramp is wired in Phase 4. Top-bar rack gets per-cell progress bars (shared tick clock) and a chevron-driven dropdown for pin/unpin. `SAVE_VERSION = 3` with silent v1/v2 migration. |
| v0.1.2 | **Scouting & anomalies** — `Explore` becomes a timed scout. Duration scales with distance from origin (60 s at home → 24 game-hours past `SCOUT_DISTANCE_RANGE = 40000`). The bound scout fleet must remain stationary and out of combat or the scout cancels. On completion, 15% chance of an anomaly: scout-fleet damage, random tech effect, pirate ambush, resource cache, tech gift, artifact relic, or (rare) research breakthrough. Adds in-flight scout state to per-star save/load; older saves load cleanly. |
| v0.1.1 | **Artifact & Tech card systems** — two new card categories. Artifacts are permanent passive unlocks with 6 effect kinds (resource/colony, resource/tick, fleet cap, sensor%, research speed%, colonization discount). Tech cards are consumable activatables with 5 effect kinds (gain resources, area damage / heal, instant reveal, heal all ships). **Research reworked** into a single-pool, 1-of-3 choice modal (~⅔ tech / ⅓ non-tech per slot); cost climbs only on non-tech unlocks. Pirate combat has a per-combat artifact-drop roll, surfaced in the salvage screen. `SAVE_VERSION = 2` with silent v1 → v2 migration. |
| **v0.1.0** | Milestone release: consolidates the entire v0.0.9.x balance + QoL line into the 0.1.0 minor bump. Introduces this canonical IDLESPACE.md reference doc as the single source of truth for the project. |
| v0.0.9.25 | Terraform actually visible; saves starving colonies (terraform folds into raw food before starvation); flicker fix; right-click drag no longer deselects. |
| v0.0.9.24 | Tamer pop/colonize curves; Terraform action introduced. |
| v0.0.9.23 | Leader bonuses actually wired into output; exploration no longer reveals neighbouring stars. |
| v0.0.9.22 | Balance sweep + leader bonuses rework (rolled but not yet applied). |
| v0.0.9.21 | Stat-roll distribution mirrors RARITY_WEIGHTS with rarity-blend toward gold. |
| v0.0.9.20 | Trade action gains +5 credits/tick base + output scaling. |
| v0.0.9.19 | Fix deck-pile draw cost mismatch. |
| v0.0.9.18 | Per-card weight tuning pass; starting credits raised to 5000. |
| v0.0.9.17 | Wire up per-card `weight` field for rarity tweaking. |
| v0.0.9.16 | Research rebalance — costs, rarity weights, non-starter commons tag. |
| v0.0.9.15 | 12 new credit-producing buildings; research upkeep tightened; 4× travel speed. |
| v0.0.9.14 | Revert Firefox-mobile glitch fixes, keep scaling work. |
| v0.0.9.6 – v0.0.9.9 | Firefox compat: explicit mask-clip, unprefixed mask, isolated blend modes, version badge. |
| v0.0.9 | IndexedDB-backed card storage; fix stat-key schema drift. |
| v0.1.0 Phase 4 #11 | Collection tab + click-to-zoom card popup. |
| v0.1.0 Phase 4 #10 | Colony Ships + special-abilities registry. |
| v0.1.0 Phase 4 #9 | Pirate loot drops + playtest tuning. |
| v0.1.0 Phase 1 | Real-time pacing rebase + card-count draw scaling + cost retune. |
| v0.0.8 | Memory-fog trails, empire overlay fixes, card-draw bugs, polish. |
| (untagged) | Metallic card template extended to all 6 types; full emoji sweep (`f82cff7`). |
| v0.0.7 | Idle scaling overhaul — stat rolling, massive rarity spread, cost scaling, research-as-card-pack-opening. |

---

## 20. Not Yet Implemented

- **Fleet management Phase 6** (CORE_PLAN) — fleet panel with list / status / stats / stance, repair / resupply at friendly colonies.
- **Admiral special abilities** — shelved (CORE_PLAN D6). Admirals differentiate through commandBonus + per-stat bonuses + fleet-size only.
- **Deployable pirate-ship loot** — pirate cards drop as trophies for the Collection but can't be placed in colonies or fleets (noted in code as future phase).
- **Targeted tech in active combat** — `areaDamage` / `areaHeal` / `instantRevealRadius` skip entities with `inCombat` set. A combat-aware version would need to sync into the combat's `sideX.ships` snapshot too.
- **Larger artifact catalog** — artifacts still ship one sample per effect kind (6 templates). Tech catalog was expanded to 60 cards covering single-resource grants, multi-resource bundles, exchanges (`cost` + `gainResources`), area damage / heal, and reveal — all reusing the 5 original effect kinds.
- **Per-type CSS motifs** — `ui/artifact-card.css` and `ui/tech-card.css` currently style only the effect chip and glyph color. A rune / circuit motif on the middle content is a future polish.
- **Sidecar PNG image pipeline** — CARDS_PIPELINE_PLAN Phase 3; images still embed as `data:` URLs in some override paths.
- **Tap-to-place / hi-DPI canvas / CSS-variable scaling** — UI_RESPONSIVE_PLAN Phases 2–5.
- **Font-size token unification** — UI_READABILITY_PLAN.
- **Sound / music** — none.
- **Phone / portrait support** — deliberately out of scope.

---

## 21. Constants & Formulas Appendix

Single table of every named constant in the game, with current value and approximate location in `starmap.html`. Re-verify on release.

### Rarity & stat rolling

| Name | Value | Line |
|---|---|---|
| `RARITY_WEIGHTS` | `{ common:60, uncommon:25, rare:10, epic:4, legendary:1 }` | 2234 |
| `STAT_ROLL_VARIANCE` | `0.25` | 2238 |
| `STAT_TIER_BASE_WEIGHTS` | `[60, 25, 10, 4, 1]` (gray, green, blue, purple, gold) | 2245 |
| `STAT_RARITY_BLEND` | `{ common:0, uncommon:0.125, rare:0.25, epic:0.375, legendary:0.5 }` | 2246 |

### Starmap

| Name | Value | Line |
|---|---|---|
| `CHUNK_SIZE` | `400` | 2637 |
| `NOISE_SCALE` | `0.0015` | 2638 |
| `MIN_STAR_SEPARATION` | `240` | 2639 |
| `DENSITY_THRESHOLD` | `0.25` | 2640 |
| `MAX_STARS_PER_CHUNK` | `1` | 2641 |
| `BASE_SENSOR_RANGE` | `500` | 2792 |
| `GALAXY_SEED` | `Math.floor(Math.random()*2147483647)` | 2576 |

### NPC Factions

Faction config lives in the `NPC_FACTIONS` registry; spawn / loot / render code is faction-generic and reads from there.

| Name | Value | Line |
|---|---|---|
| `NPC_FACTIONS` | registry — `{ pirate, dragon }` | 2330 |
| `NPC_FACTIONS.pirate.safeRadius` | `1500` | 2330+ |
| `NPC_FACTIONS.pirate.tierRange` | `80000` | 2330+ |
| `NPC_FACTIONS.pirate.tierExponent` | `1.5` | 2330+ |
| `NPC_FACTIONS.pirate.spawnChanceMul` | `1.0` | 2330+ |
| `NPC_FACTIONS.dragon.safeRadius` | `2500` | 2352+ |
| `NPC_FACTIONS.dragon.spawnChanceMul` | `0.1` (10× rarer than pirates) | 2352+ |
| `NPC_FACTIONS.dragon.fleetSize` | `{ mode: "fixed", count: 1 }` | 2352+ |
| Legacy `PIRATE_TIER_RANGE` alias | `NPC_FACTIONS.pirate.tierRange` | 2374 |
| Legacy `PIRATE_TIER_EXPONENT` alias | `NPC_FACTIONS.pirate.tierExponent` | 2375 |
| Legacy `PIRATE_HOME_SAFE_RADIUS` alias | `NPC_FACTIONS.pirate.safeRadius` | 2376 |
| `getFactionTier(x, y, faction)` | shared tier function | 2378 |
| `rollFactionRarity(rng, tier, faction)` | shared rarity weighter | 2385 |
| `rollNpcShip(rng, tier, faction)` | shared card pick | 2417 |
| `maybeSpawnNpcFleet(...)` | shared chunk-spawn entry | 2432 |

### Scouting (v0.1.2)

| Name | Value | Line |
|---|---|---|
| `SCOUT_MIN_SEC` | `60` (game-s at d=0) | ~3030 |
| `SCOUT_MAX_SEC` | `86400` (24 game-hours) | ~3031 |
| `SCOUT_DISTANCE_RANGE` | `40000` (world units) | ~3032 |
| `SCOUT_DISTANCE_EXPONENT` | `1.3` | ~3033 |
| `SCOUT_ANOMALY_CHANCE` | `0.15` | ~3034 |
| `SCOUT_ANOMALIES` | 7 outcomes, weighted (see §5b) | ~3105 |
| `getScoutDuration(star)` | distance → game-seconds | ~3036 |
| `startScoutingStar(star)` | begins scout (gated by sensor coverage) | ~3045 |
| `tickScouts(dt)` | advances all scouts; cancels on fleet move/combat/loss | ~3135 |
| `cancelScoutingStar(star, reason)` | aborts a scout; reverts panel to Scout button | ~3170 |
| `completeScoutingStar(star)` | flips visibility + rolls anomaly | ~3225 |
| `rollScoutAnomaly()` | weighted pick from `SCOUT_ANOMALIES` | ~3120 |
| `applyScoutAnomaly(a, star, fleet)` | dispatches per `kind` | ~3134 |
| `showAnomalyModal(star, anomaly)` | inline backdrop modal | ~3265 |

### Time

| Name | Value | Line |
|---|---|---|
| `BASE_GAME_SPEED` | `2.0` | 6368 |
| `TICK_PERIOD` | `1` (game-seconds) | 6374 |
| `WORLD_SPEED_MULT` | `0.8` | 6383 |
| `VISUAL_DT_FACTOR` | `0.1` | 6388 |
| `gameSpeed` (initial) | `1` | 6369 |
| Speed buttons | `0, 1, 50, 150` | 1672–1675 |

### Combat

| Name | Value | Line |
|---|---|---|
| `SHOT_INTERVAL` | `0.5` | 6377 |
| `COMBAT_TIME_SCALE` | `1/100` | 6378 |
| `COMBAT_HP_SCALE` | `5` | 6389 |
| `RANGE_THRESHOLDS` | `{ long:1000, medium:650, short:350 }` | 6390 |
| `ENGAGED_DISTANCE` | `200` | 6391 |
| `COMBAT_TRIANGLE` | `energy 2/0.5, kinetic 0.5/2, missile 1/1` | 6395 |

### Card draw

| Name | Value | Line |
|---|---|---|
| `BASE_DRAW_COST` | `500` credits | 6408 |
| `BASE_DRAW_INTERVAL` | `30` real-seconds | 6409 |
| `DRAW_K_C` | `1.25` | 6410 |
| `DRAW_K_E` | `0.75` | 6411 |
| `EXPECTED_PER_COLONY` | `{ building:10, ship:5, captain:3, admiral:3, leader:1 }` | 6412 |
| `DRAW_STACK_PENALTY` | `5` | 6621 |

### Resources & income

| Name | Value | Line |
|---|---|---|
| `RESOURCE_DEFS` | 10 entries: 5 base + salvage + 4 exotics (v0.2.0) | ~7392 |
| `STARTING_RESOURCES` | `{ credits:5000, energy:5000, minerals:5000, research:0, food:5000 }`; salvage + exotics default to 0 | ~7429 |
| `TRADE_BASE_CREDITS` | `5` (+ Σ(non-credit)/4) | ~8114 |
| `TERRAFORM_BASE_FOOD` | `5` (+ Σ(non-food)/4, folded pre-starvation) | ~8134 |
| `BASELINE_COLONY_FOOD` | `2` per tick; added pre-starvation. v0.2.0 — fixes "born starving" | ~8138 |
| `SALVAGE_BY_RARITY` | `{ common:5, uncommon:15, rare:60, epic:300, legendary:2000 }` (placeholder) | ~4090 |
| `pinnedResources` (player setting) | Set of resource ids visible in top-bar rack; defaults to all `defaultPinned: true` | ~7424 |
| `resourceProgressMode` (player setting) | `"off" \| "bar" \| "cell"`; default `"bar"` | ~7425 |

### Population

| Name | Value | Line |
|---|---|---|
| `POP_LEVELS` | 10-row table 100K→1T, foodMaint 1→80 | 6415 |
| Pop growth cost | `credits = ceil(2500 × 2^(level-1))`, `food = ceil(1250 × 2^(level-1))` | 6438 |
| Starvation penalty | `non-food × 0.2` while `raw.food − maintenance < 0` | 6717–6720 |

### Colonization

| Name | Value | Line |
|---|---|---|
| `getColonizationCost(n)` | `k = n` if `n ≤ 4` else `4 × 2^(n-4)`; `credits=10000k, minerals=5000k, food=1000k`; 1st free | 6937 |

### Research

| Name | Value | Line |
|---|---|---|
| `RESEARCH_BASE_COST` | `500` | ~7855 |
| `RESEARCH_COST_MULTIPLIER` | `2.0` | ~7855 |
| `RESEARCH_SPEND_RATE` | `5` points / game-second (× artifact `researchSpeedPercent`) | ~8249 |
| `RESEARCH_GATED_CATEGORIES` | `["building", "ship", "admiral", "leader", "tech"]` | ~7844 |
| Research-pool weights | `{ common:200, uncommon:60, rare:15, epic:3, legendary:0.3 }` | (in `rollResearchResult`) |
| Research-slot tech chance | `0.66` per slot; non-tech weights `[3,3,3,3,2]` for building/ship/admiral/leader/artifact | (in `pickResearchSlotCategory`) |
| `ACTION_TO_CATEGORY` | `{ buildings:"building", admirals:"admiral", leaders:"leader", ships:"ship" }` | 2221 |
| `autoContinueResearch` (player setting) | `true` default; if true, accepting a pick auto-calls `startResearch()` | ~7842 |

### Artifact / Tech

| Name | Value | Line |
|---|---|---|
| `ARTIFACT_EFFECTS` | 6 kinds: flatResourcePerColony, flatResourcePerTick, bonusFleetSize, sensorRangePercent, researchSpeedPercent, colonyShipDiscount | ~6584 |
| `TECH_EFFECTS` | 5 kinds: gainResources, instantHealAllPlayerShips (instant); areaDamage, areaHeal, instantRevealRadius (targeted) | ~6660 |
| `TECH_RETICLE_COLOR` | `{ areaDamage:"#ff6464", areaHeal:"#5be080", instantRevealRadius:"#60a8ff" }` | ~6760 |
| `LOOT_ARTIFACT_DROP_CHANCE` | `0.05` per combat (one roll, not per-ship) | 3579 |

### Save / load

| Name | Value | Line |
|---|---|---|
| `SAVE_VERSION` | `3` (bumped v0.2.0 Phase 1) | ~9879 |
| `SAVE_LOAD_MIN_VERSION` | `1` — silent forward-migration of v1 saves | ~8531 |
| `AUTOSAVE_KEY` | `"idlespace_autosave_v1"` | ~8532 |
| `AUTOSAVE_INTERVAL_MS` | `60000` (60 s) | ~8533 |
| `CARDS_IDB_NAME / STORE / OVERRIDE_KEY` | `"idlespace_cards" / "kv" / "gameCardsOverride"` | 1877–1879 |

### Key functions (by line)

| Function | Line | Purpose |
|---|---|---|
| `pickWeighted(arr, rng)` | 2196 | Weighted random picker — sums `(item.weight ?? 1)`. |
| `rollStats(template)` | 2265 | Rolls all stats ±25% with rarity-blended bias. |
| `rollCardFromCategory(category)` | 2306 | Colony deck draw — rarity-weighted, respects research gate. |
| `rollRarityWithBonus(bonus)` | 2478 | Shifts common→higher tiers for planet generation. |
| `rollStarPlanetSlots(template, rand)` | 2499 | Star → list of planet rarity strings. |
| `rollPlanetCardOfRarity(rarity)` | 2525 | Planet template + ±25% bonuses roll. |
| `generatePlanets(star)` | 2556 | Names + assigns planets to a freshly-explored star. |
| `findColonyShipFleet(star)` | 2815 | Colony-ship gate for the Colonize button. |
| `consumeColonyShip(entity)` | 2845-ish | Removes a colony ship card on use. |
| `formatETA(gameSec)` | 2911 | Human-readable game-time delta. |
| `tickEntities(dt)` | 3094 | Movement + sensor reveal + engagement check. |
| `tickCombats(rawDt)` | 3504 | Combat-scaled loop — closing / engaged / volleys. |
| `recalcFleetStats(ent)` | ~2980 | Derived fleet stats incl. command bonus. |
| `buyPopulation()` | 6446 | Manual pop growth from credits + food. |
| `rollResearchResult(category)` | 6524 | Research card-pack draw. |
| `getDrawScaling(col, category)` | 6603 | Two-axis draw cost + interval. |
| `getColonyGenInterval(col, category)` | 6622 | Stack-penalised gen timer. |
| `getColonyOutput(colony, planet)` | 6772 | Canonical resource math. Now also folds in `flatResourcePerColony` artifact bonuses. |
| `tickEconomy(dt)` | 6831 | Card gen timers + resource ticks + `flatResourcePerTick` artifacts + research spend (with speed%). |
| `getColonizationCost(n)` | 7043 | Colonize cost ramp, with `colonyShipDiscount` artifact applied (capped 90%). |
| `colonizePlanet(star, planetIdx)` | ~7057 | Colony Ship gate + cost + colony attach. |
| `getArtifactBonuses()` | ~6608 | Aggregates the 6 artifact effect kinds. Memoized by `_artifactVersion`. |
| `grantArtifact(id)` | ~6645 | Dedup-adds to `ownedArtifacts`, bumps cache, refreshes fleet sensors. |
| `getEffectiveBaseSensorRange()` | ~6662 | `BASE_SENSOR_RANGE × (1 + sensorMul/100)`. Used by 4 callsites. |
| `playTechCard(id)` | ~6810 | Branches on instant vs targeted; enters targeting mode or fires immediately. |
| `rollResearchChoices()` | ~6975 | Rolls 3 dedup'd candidates with the per-slot 66% tech distribution. |
| `acceptResearchChoice(card)` | ~7020 | Routes the pick into `techInventory` / `grantArtifact` / `researchedCards`. |
| `openResearchChoiceModal(choices)` | ~7050 | Populates and shows `#research-choice-backdrop`. |
| `rollPirateArtifactDrop()` | 3582 | Filters artifact pool by source==="pirate" and not-owned, weighted by rarity. |
| `showResearchReveal(template, category)` | ~9100 | Legacy flip-reveal modal — no longer called by the rework, retained for possible future polish on single-card unlocks. |
| `serializeGame()` / `deserializeGame(data)` | 8416 / 8526 | Save / load. |

---

## 22. Maintenance

Things to do on each tagged release:

1. Bump the version pin at the top of this file. Update "Last verified" date.
2. Append a one-line entry to §19 Version History (newest first).
3. Re-verify §21 constants appendix — search the file for each constant name; if any value or line moved by more than a few rows, update both.
4. If a system materially changed (new mechanic, formula change, file moved), update its section. Don't leave inconsistent values in two places.
5. If a specialized doc is added or retired (CORE_PLAN / CARDS_STYLING_GUIDE / CARDS_PIPELINE_PLAN / UI_*), update the cross-link list at the top.

When in doubt, the **code is truth**. This doc summarises and indexes; it never overrules the actual constant values or function bodies in `starmap.html`.
