# UI Responsive + Touch Plan

Goal: make IdleSpace playable on a tablet without breaking the current 3440x1440 desktop look.

## Core Principles

- **3440x1440 is the reference.** At >=1400w, clamp() / max() caps produce pixel-identical output to today.
- **Additive, not rewrite.** CSS variables + pointer events layer onto existing code.
- **No phone/portrait support.** Target: tablet landscape (~1024+). That's the realistic scope.

## Phase 1 — Touch pan/zoom on starmap

Highest-visible fix (the "pinch zooms the whole page" bug). Self-contained in `starmap.html` around L5137-5298.

- Add `touch-action: none` to `#map-container` so the browser stops hijacking pinch gestures.
- Migrate starmap pan from `mousedown/move/up` to **pointer events** (unifies mouse + touch + pen).
- Add two-finger pinch: track distance between two active pointers, map delta -> `camera.zoom` (existing 0.3-3.0 clamp). Zoom toward the midpoint like the wheel handler does.
- Keep wheel handler for desktop untouched.
- Same treatment for system-view overlay if/when it needs pan/zoom (currently click-only — skip).

## Phase 2 — Tap-to-place (touch-compatible card placement)

HTML5 drag-drop doesn't fire on touch. Tap-to-select + tap-to-place is simpler to build AND nicer UX on tablet, and it layers on top of the existing drag handlers without removing them.

- Add a single `selectedCard` state (source: queue index, slot index, or leader).
- Click a card -> mark it selected (glow/highlight border, dim non-valid targets).
- Click a valid empty target (slot/queue/leader) -> call existing placement function -> clear selection.
- Click the selected card again, press Esc, or click a dim area -> deselect.
- Compatibility rules stay the same (buildings -> building slots only, leaders -> leader slot only, etc.) — we just gate the target highlight on them.
- Existing `draggable` / `dragstart` / `drop` handlers remain. Purely additive.

Scope: queue <-> building slot, queue <-> leader slot, slot -> queue return, fleet ship placement. ~100 lines total.

## Phase 3 — CSS variables + clamp() for scaling

Zero-break because defaults match today's fixed px.

- Add root vars: `--card-w`, `--card-h`, `--slot-w/h`, `--leader-w/h`, `--overlay-max-w/h`, `--font-base`.
- Wrap with `clamp(MIN, vw-based, CURRENT_PX)` — e.g. `--card-w: clamp(160px, 14vw, 220px)`. At 3440w the vw term exceeds 220, clamp returns 220 — unchanged.
- Replace fixed dimensions on: `.card-preview` (220x320), `#leader-slot` (202x294), `#colony-deck` (138x200), overlay max dims (1400x900), magnified card modal (220x320).
- Switch building grid to `grid-template-columns: repeat(auto-fit, minmax(var(--slot-w), 1fr))` -> auto-reflows 5x2 -> 4x3 -> 3x4 at smaller widths without a media query.

## Phase 4 — Overlays & top bar at small sizes

- Resource top bar: add `overflow-x: auto` and compressed labels under `@media (max-width: 1200px)`.
- Combat / research / fleets-list / card-select overlays inherit the var system from Phase 3.
- Save menu keeps its current min/max-width.

## Phase 5 — Canvas hi-DPI + polish

- Add `devicePixelRatio` scaling to starmap + system canvases (crisp on retina tablets).
- Re-fire `resizeCanvas` on overlay close so canvas matches container after layout shifts.

## Testing path

- Chromium devtools device emulation: iPad landscape (1180x820), iPad Pro (1366x1024), Surface (1366x912), then 3440x1440 for the regression check.
- Each phase is independently revertable.

## Deliberate non-goals

- Phone portrait (<768w) — too cramped for the 10-slot colony UI; skip.
- No framework / no preprocessor — stays vanilla.
- No card-art redesign — variables scale the existing template linearly.

## Status

- [x] Phase 0: Plan
- [ ] Phase 1: Touch pan/zoom on starmap
- [ ] Phase 2: Tap-to-place
- [ ] Phase 3: CSS variables + clamp()
- [ ] Phase 4: Top bar & overlay polish
- [ ] Phase 5: Hi-DPI canvas
