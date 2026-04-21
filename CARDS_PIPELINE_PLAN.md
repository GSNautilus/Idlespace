# Cards Pipeline Plan

## Overview

Move card definitions out of the embedded `*_TEMPLATES` arrays in `starmap.html` and into a single file, `data/game-cards.json`, that is:

- Read by `starmap.html` at boot (with a `localStorage` override path for live-editing against an open builder).
- Written by `card-builder.html` — both via the shared `localStorage` live loop and via a committable zip bundle for deployment.
- The sole source of truth for card data at runtime. Saves reference cards only by `id` and re-resolve at load.

Images move from base64 blobs in JSON to sidecar PNGs under `assets/cards/<category>/<id>.png`.

**Scope of this effort: data pipeline only.** No changes to in-game card rendering, no design/balance changes, no new mechanics. Card art rendering inside the game is a separate, later effort.

---

## Current state

- `starmap.html` hardcodes `STAR_TEMPLATES`, `PLANET_TEMPLATES`, `BUILDING_TEMPLATES`, `LEADER_TEMPLATES`, `ADMIRAL_TEMPLATES`, `SHIP_TEMPLATES` (lines 1598–1986). ~390 lines of template data.
- `data/game-cards.json` already contains extracted stars/planets/buildings in a category-nested shape. Leaders/admirals/ships are not yet extracted. Schema needs to be reshaped per this plan.
- `card-builder.html` reads/writes a flat array with base64 images under `localStorage['idlespace_cards']`. Schema diverges from the game's (no `upkeep`, `planetGen`, `bonuses`, `weight`).
- `assets/idlespace-cards.json` is the card-builder's export (3.1 MB, base64 images). Retired by this work.

---

## Target schema

### File-level

```json
{
  "version": 1,
  "cards": [ ... ]
}
```

### Card

```json
{
  "id": "bld_009",
  "name": "Quantum Computer",
  "category": "building",
  "rarity": "rare",
  "weight": 1,
  "image": "assets/cards/building/bld_009.png",
  "stats":  { "research": 75 },
  "cost":   { "energy": 120, "minerals": 80, "credits": 250 },
  "upkeep": { "energy": 15 },
  "special": "Boosts all research output by 10%.",
  "flavor": "Processing power beyond mortal comprehension.",
  "tags": ["needs-art"],
  "attributes": {},
  "categoryData": {}
}
```

### Category-specific data (`categoryData`)

- **star:** `{ "planetGen": { "count": [2, 4], "guaranteed": ["rare"], "bonus": 2 } }`
- **planet:** `{ "bonuses": { "energy": 55, "credits": 25 } }`
- **building / leader / admiral / ship:** empty today; open for category-specific fields later

### Schema rules

- Missing `stats` / `cost` / `upkeep` / `tags` / `attributes` / `categoryData` default to empty.
- `image` may be either a repo-relative path or a `data:` URL (the latter is used during `localStorage`-override mode where builder images are still base64).
- `weight` is a within-rarity pick multiplier. Default `1`. `0` excludes the card from random draws without deleting it (useful for story-only cards). Does **not** affect the between-rarity roll — that's still `RARITY_WEIGHTS`.
- `attributes` is for typed metadata we'll reason about programmatically (`race`, `faction`, `alignment`, etc.). `tags` is for loose strings.
- Unknown fields are preserved on round-trip by both starmap (load) and card-builder (load → edit → save).
- Structural fields are strict: missing `id` / `category` / `rarity` is an error at load. Everything else tolerates omission.

---

## Pipeline

### Live dev loop (same browser)

1. Open `card-builder.html`, edit.
2. Click **Apply to live game** → builder writes the full game-schema bundle to `localStorage['idlespace_gameCards_override']`.
3. `starmap.html` (either open in another tab or loaded after) reads the override at boot.
4. Optional: `BroadcastChannel('idlespace-cards')` so an already-open starmap tab hot-reloads on push.

**Loader precedence in starmap:**

1. `localStorage['idlespace_gameCards_override']`
2. `fetch('data/game-cards.json')`
3. Hard error — no embedded fallback

### Ship artifact (zip export)

Card-builder's **Export bundle** button produces `idlespace-cards-bundle.zip`:

```
game-cards.json
assets/cards/star/str_001.png
assets/cards/building/bld_009.png
assets/cards/ship/shp_001.png
...
```

User unzips into the repo root, commits, pushes. GH Pages serves it as normal.

Zip writer is no-dep STORE-only (images are already PNG-compressed; no benefit from DEFLATE).

---

## UI hooks

### `starmap.html`

- Import/export menu gets **Open Card Builder ↗** (new tab).
- **Noticeable corner badge** ("Live builder override") when the localStorage override is active, with a **Revert to shipped cards** action.

### `card-builder.html`

- **Live-linked** indicator when override is set.
- **Apply to live game** button — explicit push, never auto-applies on keystroke.
- **Export bundle (.zip)** button.
- Editor fields extended: `upkeep`, `weight`, `categoryData.planetGen` (stars), `categoryData.bonuses` (planets), `attributes` (free-form key/value).

---

## Phases

### Phase 1 — Loader with temporary fallback

- Add `getTemplates(category)` accessor; route every template read through it.
- Fetch `data/game-cards.json` at boot; fall back to embedded templates during this phase only.
- Extract leaders/admirals/ships into `data/game-cards.json` in the new flat-plus-`categoryData` shape.
- Rework stars/planets in the file from category-nested to flat + `categoryData`.

### Phase 2 — Card-builder schema extension

- Add editor UI for `upkeep`, `weight`, `attributes`, and `categoryData` (category-aware fields).
- Card-builder reads/writes `{ version, cards }`.
- Preserve unknown fields on round-trip.

### Phase 3 — Sidecar image pipeline

- `assets/cards/<category>/<id>.png` is the canonical layout.
- Card JSON references paths; loader still accepts `data:` URLs.
- Add **Export bundle (.zip)** to card-builder.
- No in-game image rendering yet.

### Phase 4 — Save/load by ID

- Audit save format.
- Every card reference (colony buildings, fleet ships, decks, queues, leader slot) stores only `{ id }` + per-instance state (rolled stats, HP, damage, position).
- Load re-resolves definition from the active cards file.
- Missing IDs drop with a console warning.

### Phase 5 — Strip embedded templates

- Delete `*_TEMPLATES` arrays from `starmap.html`.
- Load failure → error screen and halt (no fallback).

### Phase 6 — Live link + dev ergonomics

- `localStorage` override loader path.
- Corner badge in starmap.
- `BroadcastChannel` hot reload.
- **Apply to live game** button in card-builder.
- **Open Card Builder ↗** link in starmap.
- Document `python -m http.server 8000` workflow.

---

## Ground rules for code

- Never hard-code the category list at runtime — derive it from what's in the file.
- Never iterate a fixed list of resources — iterate the keyed object.
- Loader is forgiving on optional fields, strict on structural ones (`id`, `category`, `rarity`).
- Unknown category → warning, still buckets generically.
- Save files store only IDs + per-instance state. Card definition always re-resolves at load.
- Registry constants (`RESOURCE_DEFS`, `RARITY_WEIGHTS`, `RESEARCH_COSTS_BY_RARITY`, rarity colors) remain hardcoded, but are only ever accessed via object iteration so they can migrate into `game-cards.json` later without touching consumers.

---

## Deferred (designed for, not built)

- Moving resource / rarity / research-cost registries into `game-cards.json`.
- Structured abilities engine (`abilities: [{ trigger, effect, ... }]`). `special` stays as flavor text.
- Richer cost expressions (OR / AND / scaling). Flat keyed map only for now.
- In-game card art rendering.
- File System Access API "save directly into project" (Chromium-only; zip path is sufficient).

---

## Decisions recorded

- **Fallback:** none after Phase 5 — hard error if cards file is missing.
- **Source of truth:** `game-cards.json`; saves re-resolve by ID.
- **Push model:** explicit. No auto-apply on builder edits.
- **Override indicator:** noticeable corner badge in starmap.
- **Export format:** pure zip download (no FSA).
- **Categories:** flat `cards` array; `category` is a field, not a top-level key.
- **Category-specific data:** lives under `categoryData`.
- **Extensibility:** `attributes` for typed metadata, `tags` for loose strings, unknown fields preserved on round-trip.
- **Rarity tuning:** per-card `weight` multiplier within a rarity tier. Default `1`, `0` excludes from draws.
