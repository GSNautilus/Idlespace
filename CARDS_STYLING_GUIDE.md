# Card Styling Guide

Short reference for the card visual system in IdleSpace. **Ships and pirates** currently use the new metallic template; **stars, planets, admirals, buildings, leaders** still render with the legacy layout and need variants designed against this same vocabulary.

The ship renderer is the reference implementation — use it as the model when building variants for the other types.

## File map

| File | What it does |
|---|---|
| [ui/ship-card.css](ui/ship-card.css) | All `.card-preview.is-ship` styles (shared) |
| [ui/colors_and_type.css](ui/colors_and_type.css) | Rarity, resource, weapon, range palettes + type tokens |
| [ui/chrome.css](ui/chrome.css) | Shared `.metal` surface helpers, `.ico` sprite helper |
| [ui/icons.html](ui/icons.html) | SVG sprite — add `<symbol id="i-...">` for new icons |
| [starmap.html](starmap.html) | In-game rendering. `buildShipCardHtml(card)` lives here. Other types go through `buildCardHtml` → `buildAdmiralStatsHtml` / `buildStarStatsHtml` / `buildPlanetStatsHtml` / `buildGenericStatsHtml` |
| [card-builder.html](card-builder.html) | Card editor preview. `buildShipCardHtml(data)` mirrored here; keep in sync |

Both HTMLs load [ui/ship-card.css](ui/ship-card.css) — edit once, applies everywhere.

The SVG sprite is injected synchronously into both pages via an XHR near the top of `<body>`, so `<use href="#i-..."/>` references resolve before first paint.

## Ship card anatomy (top to bottom)

```
.card-preview.is-ship             ← outer container, drop-shadow rarity glow
├── .bg                           ← gunmetal gradient + brushed streaks + glint
├── .frame-corners                ← 4 L-shaped corner brackets
└── .c                            ← content wrapper (position: absolute, inset: 0)
    ├── .cost                     ← cost chip, absolutely positioned top-right (z:5)
    ├── .hdr                      ← header plate with name + underline
    │   └── .hdr-name
    ├── .img                      ← fixed-height art frame (flex-shrink: 0)
    │   ├── <img>
    │   ├── ::before              ← rarity-colored corner ticks (4 L-chevrons)
    │   ├── ::after               ← scanlines + central vignette
    │   └── .subtype              ← "common · Ship" label, overlaid bottom-left
    ├── .row                      ← defense stats row (shields / armor / speed)
    │   └── .stat × N             ← chip: <svg class="ico"> + .sv value
    ├── .weap                     ← single-row ARMAMENTS block (label in ::before)
    │   └── .wr × N               ← chip: <svg class="ico"> + .sv + .rb (S/M/L)
    ├── .row.u                    ← utility stats row (sensor / pd / stealth)
    ├── .special                  ← gradient pill; .sn label inline with body text
    ├── .flv                      ← flavor text, italic, hairline divider above
    └── .wm                       ← ship-silhouette watermark, absolute bottom
```

The card's logical size is **220×320px** (set by the parent `.card-preview` rule; a lot of layout code assumes this — don't change without a search). Image is pinned at **128px** tall via `flex-shrink: 0` so art never gets crunched by content below it.

## Levers

### Rarity — single source of truth
Every rarity-tinted element reads the CSS variable `--rc`, set per rarity on the root:

```css
.card-preview.is-ship.common    { --rc: var(--rarity-common); }
.card-preview.is-ship.uncommon  { --rc: var(--rarity-uncommon); }
.card-preview.is-ship.rare      { --rc: var(--rarity-rare); }
.card-preview.is-ship.epic      { --rc: var(--rarity-epic); }
.card-preview.is-ship.legendary { --rc: var(--rarity-legendary); }
```

Rarity palette lives in [ui/colors_and_type.css](ui/colors_and_type.css) as `--rarity-common` through `--rarity-legendary`. Change there and every card updates.

### Title (`.hdr`)
- `.hdr { padding }` — vertical room around the name
- `.hdr .hdr-name { font-size }`
- `.hdr::after` — the glowing hairline under the name
- `text-align: center` on `.hdr` to center

### Cost chip (`.cost`)
- `.cost { top, right }` — position in top-right
- Text colored gold via `var(--res-credits)`
- Icon lookup: `RES_ICON_BY_KEY` in the renderer maps resource keys → sprite ids (`credits` → `i-credits`)

### Image frame (`.img`)
- `height` — currently 128px
- `margin` — inset from card edges
- `.img::before` — the 4 rarity-colored corner ticks (8-layer background gradient)
- `.img::after` — scanlines + center-to-edge vignette
- `.img img { object-position }` — crop bias (`center 42%` favours upper half)

### Subtype badge (`.subtype`)
Positioned absolutely over the image, bottom-left, aligned with the bottom-left corner tick. Has a strong `text-shadow` for readability over any portrait. Built in JS as:
```js
const subLabel = `${card.rarity} · ${card.category === "pirate" ? "Pirate" : "Ship"}`;
```

### Stat rows (`.row` / `.stat`)
- `.row { padding, gap }` — spacing between chips
- `.stat` — single chip: icon + value
- `.stat .ico.shield/.armor/.sensor/...` — per-icon color overrides; default is `var(--fg-muted)`
- `.sv` — the numeric value (white, 13px, tabular-nums)

Defense uses `.row`; utility uses `.row.u` (extra top-border divider with rarity-colored center dash).

### Armaments (`.weap` / `.wr`)
- `.weap` — single horizontal row of weapon chips (`flex-direction: row`, centered)
- `.weap::before { content: 'ARMAMENTS' }` — floating label centered above the row
- `.wr` — one weapon chip. Left-border accent via `var(--wr-c, var(--rc))`; the renderer sets `--wr-c` inline per weapon (`var(--wpn-energy)`, `var(--wpn-kinetic)`, `var(--wpn-missile)`)
- `.rb.S`, `.rb.M`, `.rb.L` — range-badge colors; pull from `--range-short/medium/long`

### Special ability (`.special`)
- Gradient pill that fades rarity color into the gunmetal base
- `.special .sn` — inline label (renders the word "Special" before the ability text, on the same line)

### Flavor (`.flv`)
- Italic, centered, muted rarity-tinted
- `.flv::before` — the short hairline divider above

### Watermark (`.wm`)
Faint rarity-colored ship silhouette (from `#i-solo-ship` sprite) behind the flavor. `opacity: 0.09` by default.

## Numeric formatting

`formatResourceValue(val)` (defined in both starmap.html and card-builder.html, kept in sync) abbreviates large numbers:
- < 1,000 → raw (`800`, `54`)
- 1,000–9,999 → one decimal, trailing `.0` stripped (`1200` → `1.2K`, `5000` → `5K`)
- ≥ 10,000 → integer K (`16000` → `16K`)
- ≥ 1M / 1B / 1T → same pattern with `M` / `B` / `T` suffix

Use it everywhere a user-visible number can grow large (stats, costs, weapon damage).

## Extending to other card types

When adapting a new type (planet, star, admiral, building, leader):

1. **Keep the outer class `.card-preview`** — many JS call sites select on it.
2. **Add a new type flag class** (e.g. `.is-planet`, `.is-star`, …) alongside the rarity class.
3. **Put type-specific styles in a new shared CSS file** (`ui/planet-card.css` etc.) scoped under `.card-preview.is-planet`, and link it from both HTMLs. Share chrome with `.is-ship` where it makes sense.
4. **Write a `buildPlanetCardHtml(card)` (or equivalent)** mirroring `buildShipCardHtml`. Put it in both starmap.html and card-builder.html.
5. **Route from `buildCardHtml` in starmap.html** and from `updatePreview` in card-builder.html, branching on `card.category`.
6. **Data shapes to render per type** (see `data/game-cards.json` for examples):
   - `star` → `categoryData.planetGen.{count, guaranteed, bonus}` (no `stats`/`cost`)
   - `planet` → `categoryData.bonuses` (map of resource → % bonus)
   - `admiral` → `stats.commandBonus`, `stats.maxFleetSize`, plus optional stat bonuses
   - `building` → `stats` (production), `upkeep`, `cost`
   - `leader` → `stats` (mixed leadership attributes), `cost`
7. **Reuse the ship vocabulary** where it fits — `.row`/`.stat` for value chips, `.special` for abilities, `.flv` for flavor. Only introduce new structures where the type actually needs them.

The visual goal is a consistent family: same rarity border, same gunmetal body, same corner brackets, same flavor style. Only the middle (image area + body stats) changes per type.

## Gotchas

- **Never use `backdrop-filter` inside the card.** It interacts badly with the card's outer `drop-shadow` filter and the `mix-blend-mode: overlay` on `.bg::before`, silently hiding every sibling below the image (DOM still present, visually gone). Use `rgba(0,0,0,0.7)` for frosted-glass effects instead.
- **Card-builder's `readKvRows()` lowercases every stat key** (`sensorRange` → `sensorrange`). `normalizeShipStats()` in card-builder.html aliases the lowercased variants back to camelCase before rendering. When you write a `buildPlanetCardHtml` etc., do the same if your type uses camelCase keys.
- **`flex-shrink: 0` on the image is load-bearing.** Without it, flex compression can shrink the image when content below grows, causing art to crop inconsistently across cards.
