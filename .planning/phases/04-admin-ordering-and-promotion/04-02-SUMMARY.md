---
phase: 04-admin-ordering-and-promotion
plan: 02
subsystem: ui
tags: [sortablejs, drag-drop, admin, promotion, vanilla-js]

requires:
  - phase: 04-01
    provides: Backend endpoints for reorder (POST /api/onlydate/admin/feed-entries/reorder) and toggle-promoted (POST /api/onlydate/admin/feed-entry/toggle-promoted); updated GET /api/onlydate/admin/personas response with sort_order and is_promoted fields

provides:
  - SortableJS touch-friendly drag-drop reorder on feed_entry rows in admin panel
  - Promote toggle button per feed_entry row with gold active state
  - Feed entries sorted above legacy personas in admin list with visual divider
  - Drag handles auto-hidden when search is active

affects:
  - 04-03 (public feed star-sparkle frame for promoted cards)

tech-stack:
  added:
    - SortableJS 1.15.7 (CDN script tag)
  patterns:
    - initSortable() called after every renderPersonaList() to reinitialize after DOM replacement
    - window._sortable stores instance for cleanup before reinit
    - data-source attribute on persona rows drives SortableJS filter
    - personaRowHtml() helper decouples row rendering from list iteration

key-files:
  created: []
  modified:
    - apps/onlydate/photochoose/index.html

key-decisions:
  - "SortableJS instance destroyed and recreated on every renderPersonaList() call — simpler than trying to keep instance alive across innerHTML replacement"
  - "Drag handles hidden via .hidden CSS class when search is active — prevents partial-order bug from filtered view producing incomplete ID array"
  - "Legacy personas rendered below a divider with sort by name — matches public feed ordering intent"

patterns-established:
  - "Pattern: initSortable() must be called at end of renderPersonaList() to handle DOM replacement lifecycle"

requirements-completed: [ADMIN-08]

duration: 15min
completed: 2026-04-17
---

# Phase 04 Plan 02: Admin Ordering and Promotion UI Summary

**SortableJS drag-drop reordering with promote toggle added to admin panel — feed entries draggable, personas read-only, drag disabled during search**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-04-17T07:30:00Z
- **Completed:** 2026-04-17T07:45:00Z
- **Tasks:** 1 of 2 auto (Task 2 is checkpoint:human-verify — stopped here)
- **Files modified:** 1

## Accomplishments
- Added SortableJS 1.15.7 via CDN script tag in admin panel head
- Replaced monolithic `renderPersonaList()` with version that sorts feed entries first (by sort_order), then legacy personas (by name) below a divider
- Extracted `personaRowHtml()` helper that renders drag handle and promote button conditionally per source
- Added `initSortable()` that reinitializes on every render, uses filter to block personas rows, calls reorder endpoint on drag end
- Added promote toggle click handler in delegated listener — updates in-memory state, re-renders list on success

## Task Commits

1. **Task 1: Add SortableJS, drag handles, promote toggle, and reorder persistence** - `07aba0f` (feat)

## Files Created/Modified
- `apps/onlydate/photochoose/index.html` - SortableJS CDN, CSS for drag-handle/btn-promo/sortable-ghost/persona-divider, refactored renderPersonaList with personaRowHtml helper, initSortable, promote toggle handler

## Decisions Made
- SortableJS instance destroyed and recreated on every `renderPersonaList()` call — the existing pattern replaces `$personaList.innerHTML` entirely, making keep-alive impractical
- Drag handles hidden via `.hidden` CSS class when search is active — prevents submitting partial order array from filtered view (Research open question 2)
- `filter: '[data-source="personas"], .persona-divider'` prevents dragging legacy rows or the divider itself (Research Pitfall 1)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None — no external service configuration required.

## Next Phase Readiness
- Task 2 (checkpoint:human-verify) requires deploying the updated admin panel and manually verifying drag-drop, promote toggle, and search mode behavior
- After human verification, Phase 04 Plan 03 (public feed star-sparkle frame) can proceed

## Known Stubs
None — all wired to real endpoints from Plan 01.

---
*Phase: 04-admin-ordering-and-promotion*
*Completed: 2026-04-17*
