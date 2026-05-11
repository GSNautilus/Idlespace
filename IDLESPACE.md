# IdleSpace — Game Design & Implementation Reference

**Version pinned:** `v0.0.9.25` (5 commits past tag `v0.0.9.21`; HEAD `27b59f8`)
**Last verified against code:** 2026-05-10
**Primary source:** [`starmap.html`](starmap.html) (8,956 lines)
**Card data:** [`data/game-cards.json`](data/game-cards.json) (108 cards, schema v1)

This is the living reference for "how does IdleSpace work today, and where does each system live in the code." Specialized companion docs cover topics in more depth — link to them rather than duplicating:

- [`CORE_PLAN.md`](CORE_PLAN.md) — Combat / fleet / stance / admiral design decisions D1–D8 and phase tracker.
- [`CARDS_STYLING_GUIDE.md`](CARDS_STYLING_GUIDE.md) — The metallic "Rustfang" card template, CSS file map, anatomy.
- [`CARDS_PIPELINE_PLAN.md`](CARDS_PIPELINE_PLAN.md) — Card data pipeline (JSON source of truth, IndexedDB override, sidecar PNG plan).
- [`UI_RESPONSIVE_PLAN.md`](UI_RESPONSIVE_PLAN.md) — Tablet / touch / pinch-zoom roadmap.
- [`UI_READABILITY_PLAN.md`](UI_READABILITY_PLAN.md) — Font-size token plan (uncommitted).

**How to keep this doc current:** When you tag a release, bump the version pin at top, append a one-line entry to §20 Version History, and re-verify the §22 constants appendix against `starmap.html`. When a system materially changes, update its section and update the §22 appendix line for any constant that moved.

---

## 1. What IdleSpace Is

IdleSpace is an **idle space 4X collectible card game**. Every meaningful in-game entity — a star, a planet, a building, a leader, a ship, an admiral — is a card with rolled stats, a rarity, and a place in a deck/slot/fleet. The player explores a procedural starmap, discovers and colonizes planets, places building cards in colony slots, researches new cards (a "card pack opening" reveal), assembles fleets under admirals, and fights NPC pirates whose tier scales with distance from home.

### Design pillars

1. **Cards are everything.** Stars, planets, buildings, leaders, ships, admirals all render through the same metallic template (see [`CARDS_STYLING_GUIDE.md`](CARDS_STYLING_GUIDE.md)). The card abstraction unifies the visual + mechanical language.
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

1. **Explore.** Click a detected star → select panel; double-click to enter its system view. Exploring a star reveals the star card itself but **no longer auto-reveals neighbours** (v0.0.9.23). Sensor range from colonies and traveling entities is what surfaces new stars.
2. **Discover.** System view rolls planets via `generatePlanets(star)` ([starmap.html:2556](starmap.html)). Higher-rarity stars produce more and rarer planets.
3. **Colonize.** Move a fleet carrying a card with `special: "colonize"` into the star's sensor range, click the planet's **Colonize** button, pay the cost. The Colony Ship card is consumed.
4. **Build.** Set the colony's action (Trade / Buildings / Admirals / Leaders / Ships / Terraform). For card-generating actions, face-down cards appear in the deck pile on an escalating timer. Click pile → pick 1 of 3 rarity-weighted choices → land in queue → drag into a slot.
5. **Research.** Choose a gated category (building / ship / admiral / leader), pay the escalating cost (capped 5 research/s), wait, get a card-pack reveal.
6. **Expand.** Population grows by purchase (food + credits); each pop level unlocks one more building slot up to 10. More colonies → more income → more researches → more / bigger fleets → push back the pirate frontier.
7. **Combat sub-loop.** Fleets engage when two opposing entities enter detection range with compatible stances (D4 in [`CORE_PLAN.md`](CORE_PLAN.md)). Combat is volley-based, internally slowed 100× to preserve pre-real-time-rebase tempo. Loser destroyed; winner retains damage on surviving ships and can return for repair (Phase 6, not yet built).

---

## 4. Card System

### Categories (canonical: 6 + 1 NPC)

| Category | Templates in `game-cards.json` | Notes |
|---|---|---|
| star | 12 (3/2/3/3/1 by rarity) | Discovered on map; fixed stats; carry `categoryData.planetGen`. |
| planet | 14 (4/4/2/2/2) | Rolled at system view; carry `categoryData.bonuses` (resource %). |
| building | 32 (10/10/5/4/3) | Largest pool. Placed in colony slots; `stats` produce, `upkeep` consumes. |
| leader | 13 (4/3/3/2/1) | One per colony. `stats` add to output; `bonuses` multiply output %. |
| ship | 18 (6/5/3/2/2) | Fleet components. Combat stats: `shields, armor, speed, sensorRange, stealth, pointDefense, energyDmg, energyRange, kineticDmg, kineticRange, missileDmg, missileRange`. |
| admiral | 13 (4/3/3/2/1) | One per fleet. `stats.commandBonus` (% to all ship stats), `stats.maxFleetSize` (ship cap, default 3 without admiral). |
| **pirate** | 6 | NPC-only ship variant; reuses ship renderer with `category === "pirate"`. Dropped as loot trophies, not yet deployable. |

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

Schema rules (per [`CARDS_PIPELINE_PLAN.md`](CARDS_PIPELINE_PLAN.md)): missing optional fields default to empty; missing `id` / `category` / `rarity` is a hard error; unknown fields are preserved round-trip by both loader and card-builder.

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

Visual rendering: `buildCardHtml(card)` ([starmap.html](starmap.html)) dispatches per `card.category` to `buildShipCardHtml / buildBuildingCardHtml / buildPlanetCardHtml / buildStarCardHtml / buildLeaderCardHtml / buildAdmiralCardHtml`. Each emits `class="card-preview tpl-metal is-<type> <rarity>"`; the metallic chrome activates automatically from `ui/card-chrome.css`. See [`CARDS_STYLING_GUIDE.md`](CARDS_STYLING_GUIDE.md) for the full anatomy.

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

- States: **unknown** (no render) → **detected** (sensor-revealed; mystery-card preview) → **explored** (full card data + planet generation).
- `BASE_SENSOR_RANGE = 500` world units for colonies and the home star ([starmap.html:2792](starmap.html)).
- Entity sensor radius = `card.stats.sensorRange × 50` world units. Fleet's effective sensor = max across its ships.
- **v0.0.9.23 change:** Exploring a star no longer reveals its neighbours. You must move a sensor-equipped entity to surface the next stars.
- Fog-of-war is a memory bitmap per chunk (`TILES_PER_CHUNK = 4` → 16-bit visited map), rendered via offscreen canvas + `destination-out` composite. Detected stars keep a small permanent fog hole so they don't vanish.

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
- `rollPlanetCardOfRarity(rarity)` at [starmap.html:2525](starmap.html) picks a template and rolls its bonuses ±25%.
- `generatePlanets(star)` at [starmap.html:2556](starmap.html) names planets after the parent star with roman numerals.

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

- On colonize: consume the Colony Ship card (`consumeColonyShip(colonyFleet)`), deduct cost, attach a fresh `colony` object to the planet (see §8), push into the global `colonies[]` array.

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

`RESOURCE_DEFS` at [starmap.html:6353](starmap.html), iterated everywhere (never hard-coded). `RESOURCE_IDS = ["credits", "energy", "minerals", "research", "food"]`.

`STARTING_RESOURCES = { credits: 5000, energy: 5000, minerals: 5000, research: 0, food: 5000 }` ([starmap.html:6363](starmap.html)). Note `research: 0` — you must produce research before you can spend it.

Resource palette (colors_and_type.css): credits = gold, energy = cyan, minerals = stone grey, research = magenta, food = sage green. Distinct hues so the icon tint alone identifies the resource.

### Income

- **Trade action**: `TRADE_BASE_CREDITS (5) + Σ(non-credit production)/4` per tick — output-scaled, not population-scaled (changed in v0.0.9.20, then again with output-scaling).
- **Buildings**: each unlocked slot adds its `stats[id]` and subtracts its `upkeep[id]`.
- **Leaders**: same as buildings, but also apply `bonuses[id]` as **% multipliers** to total raw output ([starmap.html:6687–6694](starmap.html)) — see §11.
- **Planet bonuses** (planet card's `bonuses`): % multipliers applied **on top of** leader bonuses (multiplicative compound) at [starmap.html:6695–6701](starmap.html).
- **Terraform action**: `TERRAFORM_BASE_FOOD (5) + Σ(non-food production)/4` per tick, folded into raw food **before** starvation check.

`getColonyOutput(colony, planet)` at [starmap.html:6666](starmap.html) is the canonical resource math — building/leader sums, leader bonus multiplier, planet bonus multiplier, terraform food, starvation penalty, food maintenance subtract.

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

- **Gated categories**: `RESEARCH_GATED_CATEGORIES = ["building", "ship", "admiral", "leader"]` ([starmap.html:6510](starmap.html)). Stars and planets are never gated (discovered through exploration).
- **Auto-unlock**: All common cards in gated categories are unlocked at game start **except** those tagged `non-starter` (v0.0.9.16) — non-starter commons must be researched like uncommons.
- **Cost**: `cost = ceil(RESEARCH_BASE_COST × RESEARCH_COST_MULTIPLIER^count)` per category-research-count. Per-category counter in `researchCounts = { building:0, ship:0, admiral:0, leader:0 }`. `RESEARCH_BASE_COST = 500`, `RESEARCH_COST_MULTIPLIER = 2.0`. ([starmap.html:6512–6515](starmap.html))

| Research # | Cost |
|---|---|
| 1st | 500 |
| 2nd | 1,000 |
| 3rd | 2,000 |
| 4th | 4,000 |
| 5th | 8,000 |
| 10th | 256,000 |

- **Spend rate**: `RESEARCH_SPEND_RATE = 5` points / game-second. Caps spending so completion takes meaningful real time even with overflowing research income.
- **State**: `activeResearch = { category, cost, progress }`, `researchedCards = Set<id>` of unlocked card IDs.
- **Card-pack opening**: on completion, `rollResearchResult(category)` ([starmap.html:6524](starmap.html)) draws from the unresearched pool with weights `{ common:200, uncommon:60, rare:15, epic:3, legendary:0.3 }` × per-card `weight`. `showResearchReveal(template, category)` ([starmap.html:8249](starmap.html)) plays the flip-reveal animation; the card is added to `researchedCards`.
- **Rebalance history**: v0.0.9.15 tightened building upkeep on research-producers; v0.0.9.16 reworked costs and weights and introduced the non-starter tag.

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

Without an admiral, fleets cap at 3 ships. With one, cap is the admiral's rolled `maxFleetSize` (typical ranges in `CORE_PLAN.md` D7: common 4–7, uncommon 6–12, rare 11–24, epic 20–36, legendary 30–50).

### Deployment & travel

Colony screen has a Fleet tab with a deploy area: drag ship cards into deploy slots (`deployShips[]`), optionally drag an admiral, then "Deploy Fleet" or "Deploy Solo" ([starmap.html:7285–7763](starmap.html)). Entities are placed at the colony star with a small offset (40 units) so they don't all stack on the home pixel.

Travel math ([starmap.html:3094–3120](starmap.html)):

```
ent.x += dir.x × ent.speed × dt × WORLD_SPEED_MULT
ent.y += dir.y × ent.speed × dt × WORLD_SPEED_MULT
```

with `WORLD_SPEED_MULT = 0.8`. ETAs come from `formatETA(gameSec)` at [starmap.html:2911](starmap.html), displayed in the entity info panel and as a label under traveling entities on the starmap.

Selected-entity info panel: ship/fleet stats, stance toggle, disband button (only at a colony — returns cards to queue), movement orders via click destination. Right-click drag pan (v0.0.9.25) does not deselect.

For the design rationale behind stance, evasion, and fleet aggregation: see [`CORE_PLAN.md`](CORE_PLAN.md) D3–D7.

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

For the locked design decisions behind combat: see [`CORE_PLAN.md`](CORE_PLAN.md) D1 (triangle), D2 (range as distance), D3 (stealth), D8 (entities & resolution).

---

## 14. NPC Pirates

- Deterministic spawn in `generateChunk()` via the chunk-seeded RNG ([starmap.html:2703–2738](starmap.html)).
- Spawn probability: cluster chunks (density ≥ threshold) `~0.16 × tierMul`, void chunks `~0.048 × tierMul`, where `tierMul = 1 + 4 × getPirateTier(x, y)`.
- `PIRATE_TIER_RANGE = 80000`, `PIRATE_TIER_EXPONENT = 1.5`, `PIRATE_HOME_SAFE_RADIUS = 1500` ([starmap.html:2168–2174](starmap.html)). Tier ramps from 0 (home) to 1 (edge) as `pow(min(1, dist / PIRATE_TIER_RANGE), 1.5)`. Higher tier = rarer pirate ships in the spawn pool.
- No spawns within `PIRATE_HOME_SAFE_RADIUS = 1500` of (0, 0).
- Behaviour: always aggressive, patrol random (~0.2%/frame chance to pick a new destination ±150 units).
- Rendered in crimson `#c04040`; chevron icon with ship count.
- `pirate` is a real card category (6 templates in `game-cards.json`) — uses the ship renderer with subtype "Pirate".
- **Pirate loot** (v0.1.0 Phase 4 #9, commit `1fb9c83`): destroyed enemy fleets drop pirate cards as trophies into `pirateLoot[id]`. They count toward Collection ownership but are not yet deployable into colonies or map entities — "trophies only for v0.1.0; deployable-pirate-ships is a possible future phase" ([starmap.html:6470–6473](starmap.html)).

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

- `SAVE_VERSION = 1` ([starmap.html:8300](starmap.html)). Loader rejects mismatches.
- `AUTOSAVE_KEY = "idlespace_autosave_v1"`, `AUTOSAVE_INTERVAL_MS = 60000` — autosaves every 60 real seconds and on page close (`setInterval(doAutosave, …)` at [starmap.html:8922](starmap.html)).
- Manual export/import via the save menu in the top bar (export downloads JSON; import opens file picker).
- `serializeGame()` ([starmap.html:8416](starmap.html)) and `deserializeGame(data)` ([starmap.html:8526](starmap.html)) cover:
  - All 5 resources.
  - All colonies (population, buildings, leaders, deck, queue, activeAction, genTimer, pendingDraw).
  - All map entities (ships, fleets, positions, destinations, stance, owner, inCombat, damage).
  - `researchCounts`, `researchedCards`, `seenCards`, `pirateLoot`, `activeResearch`.
  - `gameSpeed` (auto-paused on load — user resumes explicitly).
  - Star map state (explored / detected flags, generated planets).
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
| Collection | top-bar Collection (v0.1.0 Phase 4 #11) | grid with click-to-zoom; tracks Seen / Owned. |
| Research panel | top-bar Research | category buttons + progress bar + known-card list. |
| Research reveal | research completes | full-screen flip-reveal modal. |
| Combat | click ⚔ icon | colony-screen-sized, semi-transparent. |
| Card-select modal | click deck pile | 1-of-3 + Discard All. |
| Magnified card | click any card | `position:fixed` centered, appended to `document.body`. |

### Card chrome

All six player categories + pirate use the metallic `.tpl-metal` template. See [`CARDS_STYLING_GUIDE.md`](CARDS_STYLING_GUIDE.md) for the file map, anatomy, gotchas (no `backdrop-filter`, `mix-blend-mode` isolation, etc.), and the numeric formatting helper `formatResourceValue()`.

### Icons

Zero emojis in HTML (full sweep completed in commit `f82cff7`). Every glyph is an SVG sprite use: `<svg class="ico"><use href="#i-..."/></svg>`, via `ico(id, classes)` helper. Sprite at [`ui/icons.html`](ui/icons.html).

### Responsive / touch

- Touch pan / pinch-zoom on starmap (Pointer Events, commit `b3388c6`).
- Body-scaling rebased to native viewport-meta scaling (commit `40e35dd`).
- Design width 1920 px (commit `62d1207`).
- Phases not yet shipped (CSS variable + clamp() scaling for card / slot dimensions, tap-to-place in colony, hi-DPI canvas): see [`UI_RESPONSIVE_PLAN.md`](UI_RESPONSIVE_PLAN.md).

### Font sizes

~143 hard-coded `font-size: Npx` values across HTML files; consolidation into rem-based design tokens is planned in [`UI_READABILITY_PLAN.md`](UI_READABILITY_PLAN.md) (uncommitted).

---

## 18. Card Builder Companion

[`card-builder.html`](card-builder.html) (2,374 lines) — standalone 3-panel app:

- **Left**: catalog sidebar with category / rarity / tag filters. Rarity-coloured dots, tag pills.
- **Center**: live preview, zoom toggle (1× / 3×), per-card watermark + chrome.
- **Right**: editor — name, category, rarity, image upload, stats / cost / upkeep / bonuses key-value lists, special / flavor, tags, weight, attributes, `categoryData` (per-category fields).

**Live sync**: IndexedDB `idlespace_cards / kv / gameCardsOverride`. "Apply to live game" button writes the full bundle; starmap reads it on next load (and badges that an override is active). Explicit push — never auto-applies on keystroke.

**Import / Export**: JSON in/out via header buttons. Sidecar-PNG zip export is planned in CARDS_PIPELINE_PLAN Phase 3 (images currently embedded as `data:` URLs).

Renderers are mirrored — every `build<Type>CardHtml(data)` in `card-builder.html` matches the equivalent in `starmap.html`. Keep them in sync when adding fields.

---

## 19. Version History

Tagged releases plus notable untagged commits, newest first.

| Version | Headline |
|---|---|
| **v0.0.9.25** (HEAD) | Terraform actually visible; saves starving colonies (terraform folds into raw food before starvation); flicker fix; right-click drag no longer deselects. |
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

### Pirates

| Name | Value | Line |
|---|---|---|
| `PIRATE_TIER_RANGE` | `80000` | 2168 |
| `PIRATE_TIER_EXPONENT` | `1.5` | 2169 |
| `PIRATE_HOME_SAFE_RADIUS` | `1500` | 2171 |

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
| `STARTING_RESOURCES` | `{ credits:5000, energy:5000, minerals:5000, research:0, food:5000 }` | 6363 |
| `TRADE_BASE_CREDITS` | `5` (+ Σ(non-credit)/4) | 6644 |
| `TERRAFORM_BASE_FOOD` | `5` (+ Σ(non-food)/4, folded pre-starvation) | 6655 |

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
| `RESEARCH_BASE_COST` | `500` | 6462 |
| `RESEARCH_COST_MULTIPLIER` | `2.0` | 6463 |
| `RESEARCH_SPEND_RATE` | `5` points / game-second | 6464 |
| `RESEARCH_GATED_CATEGORIES` | `["building", "ship", "admiral", "leader"]` | 6510 |
| Research-pool weights | `{ common:200, uncommon:60, rare:15, epic:3, legendary:0.3 }` | 6533 |
| `ACTION_TO_CATEGORY` | `{ buildings:"building", admirals:"admiral", leaders:"leader", ships:"ship" }` | 2221 |

### Save / load

| Name | Value | Line |
|---|---|---|
| `SAVE_VERSION` | `1` | 8300 |
| `AUTOSAVE_KEY` | `"idlespace_autosave_v1"` | 8301 |
| `AUTOSAVE_INTERVAL_MS` | `60000` (60 s) | 8302 |
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
| `getColonyOutput(colony, planet)` | 6666 | Canonical resource math (the most important function in the game). |
| `tickEconomy(dt)` | 6725 | Card gen timers + resource ticks + research spend. |
| `getColonizationCost(n)` | 6937 | Colonize cost ramp. |
| `colonizePlanet(star, planetIdx)` | 6950 | Colony Ship gate + cost + colony attach. |
| `showResearchReveal(template, category)` | 8249 | Flip-reveal modal. |
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
