---
type: quick
task_id: 260417-ijz
date: "2026-04-17"
status: complete
commits:
  - bfed472
  - c14bb42
  - e951272
files_modified:
  - apps/onlydate-worker/migrations/0008_persona_cover_url.sql
  - apps/onlydate-worker/src/routes/admin.ts
  - apps/onlydate-worker/src/routes/public.ts
  - apps/onlydate/photochoose/index.html
---

# Quick Task 260417-ijz: Add cover_url Override for Regular Personas

**One-liner:** cover_url UPSERT via onlydate_persona_config for personas-table rows, with pencil-edit modal forking by source in admin panel.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Migration 0008 — cover_url column to onlydate_persona_config | bfed472 | migrations/0008_persona_cover_url.sql |
| 2 | Backend — persona/set-cover endpoint + admin/public query updates | c14bb42 | routes/admin.ts, routes/public.ts |
| 3 | Frontend — pencil for all personas, modal fork by source | e951272 | photochoose/index.html |

## What Was Done

**Migration:** `ALTER TABLE onlydate_persona_config ADD COLUMN cover_url TEXT` applied to remote D1 via wrangler.

**Backend:**
- New `POST /api/onlydate/admin/persona/set-cover` endpoint UPSERTs `cover_url` into `onlydate_persona_config` using `ON CONFLICT(persona_id) DO UPDATE`.
- Admin `GET /api/onlydate/admin/personas`: personas UNION branch now selects `COALESCE(opc2.cover_url, NULL) AS cover_url` (was `NULL`).
- Public `GET /api/onlydate/models`: personas branch now `COALESCE(opc2.cover_url, ${COVER_PHOTO})` — opc2 join already existed.
- Public `GET /api/onlydate/models/:username`: personas branch now `COALESCE(pc.cover_url, ${COVER_PHOTO})` with new `LEFT JOIN onlydate_persona_config pc ON pc.persona_id = p.id`.

**Frontend:**
- Pencil button now renders for ALL persona rows (previously only feed_entry rows).
- Edit modal name/handle fields wrapped in `#edit-modal-name-field` / `#edit-modal-handle-field` divs for conditional display.
- `openEditModal`: hides name/handle divs for `source='personas'`, focuses Cover URL field instead.
- `submitEditPersona`: branches by `source` — feed_entry calls `feed-entry/update`, personas-type calls `persona/set-cover`.
- `pnpm run minify` completed without errors.

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check

- [x] `apps/onlydate-worker/migrations/0008_persona_cover_url.sql` exists
- [x] `POST /api/onlydate/admin/persona/set-cover` added to admin.ts
- [x] Admin personas query: `COALESCE(opc2.cover_url, NULL)` in place
- [x] Public models query: `COALESCE(opc2.cover_url, ${COVER_PHOTO})` in place
- [x] Public models/:username: `COALESCE(pc.cover_url, ${COVER_PHOTO})` + LEFT JOIN in place
- [x] TypeScript compiles: `tsc --noEmit` exit 0
- [x] Pencil button rendered for all persona rows
- [x] Edit modal forks by source (name/handle hidden for personas-type)
- [x] `pnpm run minify` succeeded
- [x] All commits: bfed472, c14bb42, e951272

## Self-Check: PASSED
