---
phase: 05-admin-profile-and-image-management
plan: "01"
subsystem: backend
tags: [admin, feed-entry, photos, migration, d1, r2]
dependency_graph:
  requires: []
  provides: [feed-entry/update endpoint, feed-entry/photo/toggle-hidden endpoint, is_hidden on feed photos, atomic batch delete, feed_entry profile photos]
  affects: [admin UI (Plan 02), public profile page]
tech_stack:
  added: []
  patterns: [D1 batch() for atomic multi-statement delete, allowlist field building for safe dynamic UPDATE]
key_files:
  created:
    - apps/onlydate-worker/migrations/0007_feed_photo_hidden.sql
  modified:
    - apps/onlydate-worker/src/routes/admin.ts
    - apps/onlydate-worker/src/routes/public.ts
decisions:
  - "D1 batch() used for atomic photos+entry delete — ensures no orphan photo rows if entry delete fails"
  - "Feed entry profile photos served from onlydate_feed_photos (filtered by is_hidden=0), not media_library — separate table per architecture"
  - "fields[] allowlist for dynamic UPDATE in feed-entry/update — SQL-injection safe without string interpolation"
metrics:
  duration: "~15 minutes"
  completed: "2026-04-17T10:55:38Z"
  tasks_completed: 3
  files_modified: 3
---

# Phase 05 Plan 01: Backend Admin Endpoints and Public Profile Fix Summary

**One-liner:** Added feed-entry/update and photo/toggle-hidden endpoints, fixed silent R2 error swallowing, made feed-entry/delete atomic via DB.batch(), and wired is_hidden-filtered onlydate_feed_photos into the public profile endpoint.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | D1 migration — add is_hidden to onlydate_feed_photos | d32e2bf | migrations/0007_feed_photo_hidden.sql |
| 2 | New admin endpoints, R2 logging fix, batch delete, is_hidden in personas response | f286896 | routes/admin.ts |
| 3 | Fix public profile endpoint to serve feed_entry photos with is_hidden filter | 29fd46a | routes/public.ts |

## What Was Built

### Migration 0007
`ALTER TABLE onlydate_feed_photos ADD COLUMN is_hidden INTEGER NOT NULL DEFAULT 0` — applied to remote D1 (`telegram-saas-db`). Existing rows default to 0 (visible).

### New Endpoints (admin.ts)

**POST /api/onlydate/admin/feed-entry/update**
- Accepts `{ feed_entry_id, display_name?, handle?, cover_url? }`
- Builds UPDATE dynamically from a `string[]` allowlist (not user input) — SQL injection safe
- Returns 409 `{ error: 'Handle already exists' }` on UNIQUE constraint violation
- Returns `{ ok: true }` on success

**POST /api/onlydate/admin/feed-entry/photo/toggle-hidden**
- Accepts `{ photo_id, is_hidden: boolean }`
- Updates `onlydate_feed_photos.is_hidden` directly
- Returns `{ ok: true }` on success

### Fixes (admin.ts)

**R2 logging:** Both `feed-entry/photo/delete` and `feed-entry/delete` now log R2 failures via `console.error('[OnlyDate] R2 delete failed:', ...)` instead of silently swallowing errors with `.catch(() => {})`.

**Atomic delete:** `feed-entry/delete` now uses `DB.batch([deletePhotos, deleteEntry])` to atomically remove both photos and the entry in a single D1 transaction, preventing orphan rows.

**GET /admin/personas:** Now includes `fp.is_hidden` in the feed_entry photo SELECT and propagates it through the Map push and `entry.photos.push()` so `is_hidden` is a real boolean (not hardcoded `false`) on feed entry photo rows.

### Public Profile Fix (public.ts)

`GET /api/onlydate/models/:username` now:
1. Resolves the persona via the existing UNION query
2. Checks if `persona.id` exists in `onlydate_feed_entries`
3. **Feed entry personas:** fetches from `onlydate_feed_photos WHERE feed_entry_id = ? AND is_hidden = 0`
4. **Legacy personas:** uses the existing `media_library`/`media_files` path unchanged

Cost: one extra D1 query per profile view — acceptable for a non-hot-path endpoint.

## Verification Results

| Check | Result |
|-------|--------|
| migration `is_hidden` grep | 2 matches |
| `feed-entry/update` in admin.ts | 3 matches |
| `photo/toggle-hidden` in admin.ts | 3 matches |
| `catch(() => {})` in admin.ts | 0 matches (removed) |
| `console.error.*R2 delete` in admin.ts | 2 matches |
| `DB.batch` in admin.ts | 2 matches |
| `isFeedEntry` in public.ts | 2 matches |
| `onlydate_feed_photos` in public.ts | 2 matches |
| `is_hidden = 0` in public.ts | 2 matches |
| `pnpm typecheck` | exits 0 |

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — all endpoints are wired to real D1 queries. No placeholder or hardcoded data.

## Self-Check: PASSED
