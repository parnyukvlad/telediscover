---
phase: quick
plan: 260417-bwk
subsystem: admin-ordering-and-promotion
tags: [admin-ui, drag-drop, promotion, personas, d1, migration]
dependency_graph:
  requires: [phase-04-admin-ordering-and-promotion]
  provides: [persona-reorder, persona-promote]
  affects: [public-feed-ordering, admin-persona-list]
tech_stack:
  added: [onlydate_persona_config table]
  patterns: [UPSERT ON CONFLICT, split-table routing by ID lookup]
key_files:
  created:
    - apps/onlydate-worker/migrations/0006_persona_config.sql
  modified:
    - apps/onlydate-worker/src/routes/admin.ts
    - apps/onlydate-worker/src/routes/public.ts
    - apps/onlydate/photochoose/index.html
decisions:
  - "onlydate_persona_config uses UPSERT ON CONFLICT(persona_id) to persist sort_order and is_promoted without touching read-only personas table"
  - "reorder handler resolves persona vs feed_entry IDs by querying onlydate_feed_entries membership — avoids client sending source type"
  - "renderPersonaRow delete button kept behind p.source === 'feed_entry' guard — personas from personas table cannot be deleted"
  - "isFeedEntry variable kept in renderPhotoGrid (different function) — upload card vs read-only photo view logic is still source-dependent"
metrics:
  duration: "~15 min"
  completed: "2026-04-17T06:39:37Z"
  tasks_completed: 3
  files_modified: 4
---

# Quick Task 260417-bwk: Extend Reordering and Promotion to All Personas — Summary

**One-liner:** Drag-drop reordering and Promote toggle now work for `source='personas'` rows via a new `onlydate_persona_config` UPSERT table, unifying the admin list into a single flat sorted feed.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Migration — create onlydate_persona_config table | `1f22558` | `migrations/0006_persona_config.sql` |
| 2 | Backend — wire onlydate_persona_config into admin and public routes | `6eba2f3` | `routes/admin.ts`, `routes/public.ts` |
| 3 | Admin UI — enable drag and Promote for all rows | `88c006d` | `photochoose/index.html` |

## What Was Built

**Migration (`0006_persona_config.sql`):** New table `onlydate_persona_config(persona_id PK, sort_order, is_promoted, updated_at)` — stores overrides for personas from the read-only `personas` table.

**admin.ts changes:**
- `GET /api/onlydate/admin/personas` — personas branch now LEFT JOINs `onlydate_persona_config opc2` to return real `sort_order` and `is_promoted` instead of NULL/0.
- `POST /api/onlydate/admin/feed-entries/reorder` — handler now queries `onlydate_feed_entries` to split the ID array, UPDATEs feed entries by position, UPSERTs into `onlydate_persona_config` for persona IDs.
- `POST /api/onlydate/admin/feed-entry/toggle-promoted` — handler checks if ID exists in `onlydate_feed_entries`; if not, UPSERTs into `onlydate_persona_config`.

**public.ts change:**
- `GET /api/onlydate/models` — personas subquery LEFT JOINs `onlydate_persona_config opc2` so public feed respects admin-set `sort_order` and `is_promoted` for all persona types.

**photochoose/index.html changes:**
- `renderPersonaRow`: All rows get drag handle and Promote button regardless of `source`.
- `renderPersonaList`: Single flat list sorted by `sort_order` ascending then name; "Legacy Personas (read-only)" divider removed.
- `initSortable`: `filter` cleared so Sortable does not block persona rows; `onEnd` collects all `[data-persona-id]` rows (not just `feed_entry`) for the reorder POST.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Type Error] TypeScript TS18048 on body.order inside closures**
- **Found during:** Task 2 TypeScript verification
- **Issue:** `body.order` typed as `string[] | undefined`; after `Array.isArray(body.order)` guard, TypeScript does not narrow the type inside subsequent `.map()` closures, producing `TS18048: 'body.order' is possibly 'undefined'`.
- **Fix:** Captured `const order = body.order as string[]` immediately after the guard, replacing all `body.order` references inside the `try` block.
- **Files modified:** `apps/onlydate-worker/src/routes/admin.ts`
- **Commit:** `6eba2f3`

**2. [Rule 1 - Orphaned reference] isFeedEntry used in delete button after variable removal**
- **Found during:** Task 3 — after removing `isFeedEntry` from `renderPersonaRow`, the delete button condition still referenced it.
- **Fix:** Replaced `isFeedEntry` with inline `p.source === 'feed_entry'` expression in the delete button ternary — preserves correct behavior (only feed_entry rows are deletable).
- **Files modified:** `apps/onlydate/photochoose/index.html`
- **Commit:** `88c006d`

## Known Stubs

None. All data paths are wired to real DB columns via COALESCE fallbacks.

## Self-Check: PASSED

- FOUND: `apps/onlydate-worker/migrations/0006_persona_config.sql`
- FOUND: `apps/onlydate-worker/src/routes/admin.ts`
- FOUND: `apps/onlydate-worker/src/routes/public.ts`
- FOUND: `apps/onlydate/photochoose/index.html`
- FOUND commit `1f22558` (migration)
- FOUND commit `6eba2f3` (backend)
- FOUND commit `88c006d` (admin UI)
