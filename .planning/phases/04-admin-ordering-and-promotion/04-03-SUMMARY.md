---
phase: 04-admin-ordering-and-promotion
plan: 03
subsystem: ui
tags: [css-animation, intersection-observer, promoted-cards, vanilla-js]

# Dependency graph
requires:
  - phase: 04-admin-ordering-and-promotion plan 01
    provides: is_promoted field in GET /api/onlydate/models response
provides:
  - Animated gold star-sparkle border on promoted feed cards in public Mini App
  - IntersectionObserver-based animation pause for off-screen promoted cards
affects: [public-feed, promoted-profiles]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "GPU-composited CSS animation (transform + opacity only) on ::before/::after pseudo-elements"
    - "IntersectionObserver stored as window._promoObserver for cleanup on re-render"
    - "offscreen class toggled by IntersectionObserver to pause animations via animation-play-state"

key-files:
  created: []
  modified:
    - apps/onlydate/index.html

key-decisions:
  - "border-radius on ::before is 16px (14px card var(--radius-card) + 2px inset offset) — plan specified 18px based on assumed 16px card radius, corrected to match actual CSS variable"
  - "will-change: transform, opacity applied only to promoted card pseudo-elements — not to all cards"

patterns-established:
  - "window._promoObserver: store IntersectionObserver instance for cleanup before re-attach on renderGrid()"
  - "offscreen CSS class + animation-play-state: paused — pattern for pausing off-screen animations"

requirements-completed: [PROMO-03]

# Metrics
duration: 5min
completed: 2026-04-17
---

# Phase 04 Plan 03: Promoted Card Star-Sparkle Animation Summary

**Gold animated glow border and spinning star icon on promoted feed cards, paused off-screen via IntersectionObserver using GPU-composited transform + opacity only**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-04-17T06:14:00Z
- **Completed:** 2026-04-17T06:14:38Z
- **Tasks:** 1 of 2 complete (Task 2 is checkpoint:human-verify — awaiting deploy + visual QA)
- **Files modified:** 1

## Accomplishments
- CSS `@keyframes promo-glow` and `@keyframes sparkle-spin` added — only `transform` and `opacity` animated
- `.model-card.promoted::before` renders animated gold gradient border (inset -2px, z-index -1)
- `.model-card.promoted::after` renders rotating star icon (top-right, pointer-events: none)
- `.model-card.promoted.offscreen` class pauses animations via `animation-play-state: paused`
- `observePromotedCards()` function wires IntersectionObserver, stored in `window._promoObserver` for cleanup
- `renderGrid()` adds `promoted` class from `m.is_promoted` API field; calls `observePromotedCards()` after innerHTML set

## Task Commits

Each task was committed atomically:

1. **Task 1: Add promoted card CSS animation and render promoted class from API data** - `7a530ee` (feat)

**Plan metadata:** pending final docs commit

## Files Created/Modified
- `apps/onlydate/index.html` - Promoted card CSS animations + observePromotedCards() function + renderGrid() promoted class

## Decisions Made
- `border-radius` on `::before` corrected to `16px` (actual `--radius-card` is `14px` + 2px inset) — plan assumed 16px card radius but actual CSS uses `var(--radius-card): 14px`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Corrected ::before border-radius from 18px to 16px**
- **Found during:** Task 1
- **Issue:** Plan specified `border-radius: 18px` on `::before` based on assumed card radius of 16px. Actual code uses `--radius-card: 14px` CSS variable, so correct value is 14 + 2 = 16px
- **Fix:** Used `border-radius: 16px` with explanatory comment
- **Files modified:** apps/onlydate/index.html
- **Verification:** Visual alignment correct — inset -2px + 16px radius aligns with 14px card corners
- **Committed in:** 7a530ee (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - bug: incorrect border-radius value)
**Impact on plan:** Minor correction for visual correctness. No scope creep.

## Issues Encountered
None — plan executed cleanly with one radius correction.

## Known Stubs
None — `is_promoted` field is live data from the API (implemented in Plan 01). No hardcoded or placeholder values.

## Next Phase Readiness
- Promoted card animation is complete and committed
- Deploy to Cloudflare Pages + human visual QA required (Task 2 checkpoint:human-verify)
- After QA passes, Phase 04 is complete

## Self-Check: PASSED
- SUMMARY.md: FOUND
- Commit 7a530ee: FOUND

---
*Phase: 04-admin-ordering-and-promotion*
*Completed: 2026-04-17*
