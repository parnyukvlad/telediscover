---
phase: 04-admin-ordering-and-promotion
plan: 01
subsystem: api
tags: [hono, d1, sqlite, cloudflare-workers, admin, ordering, promotion]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: "D1 schema with sort_order and is_promoted columns on onlydate_feed_entries; routes/admin.ts and routes/public.ts split"
provides:
  - POST /api/onlydate/admin/feed-entries/reorder — atomic D1 batch() update of sort_order
  - POST /api/onlydate/admin/feed-entry/toggle-promoted — sets is_promoted on feed entries
  - GET /api/onlydate/models returns results ordered by is_promoted DESC, sort_order ASC
  - Admin personas query exposes sort_order and is_promoted for all rows (NULL/0 for personas)
affects: [04-02-admin-drag-drop-frontend, 04-03-promotion-frontend]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "D1 batch() for atomic multi-row updates (reorder endpoint)"
    - "UNION synthetic column values: personas get 0 AS is_promoted, 9999999 AS sort_order"

key-files:
  created: []
  modified:
    - apps/onlydate-worker/src/routes/admin.ts
    - apps/onlydate-worker/src/routes/public.ts

key-decisions:
  - "Personas always sort to bottom via synthetic sort_order=9999999 in UNION — no override table needed"
  - "Tab param (trending/popular/new) kept for URL compatibility but has no effect on ordering — admin controls order now"
  - "is_promoted included in GET /api/onlydate/models response for frontend star-sparkle rendering"

patterns-established:
  - "Reorder pattern: D1.batch() with positional sort_order (i+1) — atomic, no partial updates"

requirements-completed: [ADMIN-09, ADMIN-10, PROMO-01, PROMO-02]

# Metrics
duration: 8min
completed: 2026-04-17
---

# Phase 04 Plan 01: Backend Reorder and Promotion Endpoints Summary

**Two new admin POST endpoints (reorder via D1 batch, toggle-promoted) and a promotion-aware public feed query (is_promoted DESC, sort_order ASC) replacing tab-dependent ordering**

## Performance

- **Duration:** 8 min
- **Started:** 2026-04-17T08:04:28Z
- **Completed:** 2026-04-17T08:12:10Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Atomic feed entry reorder via D1 `batch()` — all sort_order updates in a single batch transaction
- Binary promotion toggle updating `is_promoted` on `onlydate_feed_entries`
- Public feed now orders by `is_promoted DESC, sort_order ASC` instead of message_count/created_at tabs
- Personas locked to bottom via synthetic `sort_order=9999999` and `is_promoted=0` in UNION
- Admin personas query now surfaces `sort_order` and `is_promoted` per row for frontend drag-drop

## Task Commits

1. **Task 1: Add reorder and toggle-promoted endpoints + update admin personas query** - `d54b4c9` (feat)
2. **Task 2: Update public feed query to promotion-aware ordering** - `c5a5ecb` (feat)

**Plan metadata:** (docs commit below)

## Files Created/Modified
- `apps/onlydate-worker/src/routes/admin.ts` - Added 2 POST endpoints; UNION query extended with sort_order/is_promoted columns; PersonaEntry type updated; ORDER BY changed
- `apps/onlydate-worker/src/routes/public.ts` - Removed tab-dependent msgCount/orderBy logic; added is_promoted/sort_order to UNION branches; ORDER BY is_promoted DESC, sort_order ASC

## Decisions Made
- Tab param is accepted (no URL breakage) but does nothing — admin sort order is the source of truth now
- `is_promoted` returned in the public feed response so the frontend can render the star-sparkle frame without a separate request
- Personas branch uses `9999999` as synthetic sort_order (decision carried from Phase 1 research)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Backend contract is complete: reorder and toggle-promoted endpoints are live and TypeScript-verified
- Plan 04-02 (admin drag-drop frontend) can now wire `POST /api/onlydate/admin/feed-entries/reorder` directly
- Plan 04-03 (promotion frontend) can use `is_promoted` from the models response for star-sparkle rendering
- No blockers

---
*Phase: 04-admin-ordering-and-promotion*
*Completed: 2026-04-17*
