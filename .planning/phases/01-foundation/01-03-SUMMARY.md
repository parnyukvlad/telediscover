---
phase: 01-foundation
plan: 03
subsystem: auth
tags: [typescript, hono, cloudflare-workers, credential-rotation, refactor]

# Dependency graph
requires:
  - phase: 01-02
    provides: "shared/auth.ts, shared/db.ts, shared/telegram.ts utility modules"
provides:
  - "apps/onlydate-worker/src/routes/admin.ts — all 13 admin route handlers + getFeedMode helper"
  - "apps/onlydate-worker/src/routes/public.ts — health, media serve, /api/onlydate/models, /api/onlydate/models/:username"
  - "apps/onlydate-worker/src/routes/webhook.ts — POST /webhook/onlydate Telegram bot handler"
  - "apps/onlydate-worker/src/index.ts — thin 32-line assembly: CORS + route mounts + 404"
  - "ADMIN_PASSWORD credential rotation: no literal in any source file"
affects: [02-analytics, 03-frontend, 04-admin, 05-performance]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Route file splitting: src/routes/ contains admin.ts, public.ts, webhook.ts — each a Hono sub-app with export default"
    - "Thin assembly pattern: index.ts only does CORS middleware + app.route() mounts + notFound"
    - "getFeedMode exported from admin.ts for cross-route reuse (public.ts imports it)"

key-files:
  created:
    - apps/onlydate-worker/src/routes/admin.ts
    - apps/onlydate-worker/src/routes/public.ts
    - apps/onlydate-worker/src/routes/webhook.ts
  modified:
    - apps/onlydate-worker/src/index.ts
    - apps/onlydate-worker/wrangler.toml

key-decisions:
  - "getFeedMode placed in routes/admin.ts and exported — public.ts imports it since it calls the same DB helper; avoids circular dependency with shared/"
  - "Env interface duplicated in each route file (admin.ts, public.ts, webhook.ts, index.ts) — consistent with Hono sub-app pattern; no shared types package this milestone"
  - "wrangler.toml documents ADMIN_PASSWORD as a comment/instruction rather than a [secrets] table — Wrangler v3 secrets are set via CLI, not declared in toml"

patterns-established:
  - "Hono sub-app pattern: const app = new Hono<{ Bindings: Env }>(); ... export default app; — used in all three route files"
  - "Route mounting: app.route('/', subApp) in index.ts — paths preserved from original index.ts"

requirements-completed: []

# Metrics
duration: 5min
completed: 2026-04-16
---

# Phase 1 Plan 03: Route Splitting and Credential Rotation Summary

**Worker source split into routes/ + shared/ structure with ADMIN_PASSWORD removed from all source files — credential rotation fully effective, index.ts reduced from 733 to 32 lines.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-04-16T19:16:39Z
- **Completed:** 2026-04-16T19:22:00Z
- **Tasks:** 2 completed
- **Files modified:** 2 (index.ts, wrangler.toml), 3 created (routes/)

## Accomplishments

- Created `src/routes/admin.ts` — all 13 admin route handlers copied verbatim from index.ts, imports `isAdmin` from `shared/auth` and `MEDIA_BASE` from `shared/telegram`, exports `getFeedMode` for reuse
- Created `src/routes/public.ts` — health check, R2 media serve, `/api/onlydate/models`, `/api/onlydate/models/:username`, imports SQL fragments from `shared/db` and `getFeedMode` from `./admin`
- Created `src/routes/webhook.ts` — POST `/webhook/onlydate` Telegram bot handler, imports `tgSend` and `MINIAPP_URL` from `shared/telegram`
- Rewrote `src/index.ts` from 733 lines to 32 lines — thin assembly: CORS middleware + three `app.route('/', ...)` mounts + `app.notFound` + `export default app`
- Added `ADMIN_PASSWORD: string` to `Env` interface in `index.ts` — credential rotation complete; `const ADMIN_PASSWORD = 'PhotoAdmin#9Kz$M2pVL8xR5nQ!2025'` no longer exists anywhere in source
- Added `wrangler secret put ADMIN_PASSWORD` comment to `wrangler.toml` documenting the manual deployment step
- TypeScript compilation passes (`npx tsc --noEmit` exits 0)

## Task Commits

1. **Task 1: Create routes/admin.ts, routes/public.ts, routes/webhook.ts** — `8cc6a73` (feat)
2. **Task 2: Rewrite index.ts as thin assembly, document ADMIN_PASSWORD secret** — `939e239` (feat)

## Final File Structure

```
apps/onlydate-worker/src/
├── index.ts              (32 lines — thin assembly)
├── routes/
│   ├── admin.ts          (all 13 admin routes + getFeedMode helper)
│   ├── public.ts         (health, media, /models, /models/:username)
│   └── webhook.ts        (POST /webhook/onlydate)
└── shared/
    ├── auth.ts           (isAdmin — from Plan 02)
    ├── db.ts             (COVER_PHOTO, HAS_FREE_PHOTO, feedFilter — from Plan 02)
    └── telegram.ts       (tgSend, MEDIA_BASE, MINIAPP_URL — from Plan 02)
```

## Credential Rotation Confirmation

```
grep -r "PhotoAdmin" apps/onlydate-worker/src/   → (no output — NOT FOUND)
grep -r "const ADMIN_PASSWORD" apps/onlydate-worker/src/ → (no output — NOT FOUND)
```

ADMIN_PASSWORD literal is completely gone from all source files. The credential rotation started in Plan 02 (`shared/auth.ts` using `c.env.ADMIN_PASSWORD`) is now fully effective.

## TypeScript Compilation

`npx tsc --noEmit` exits 0 — zero compilation errors.

## Route Coverage

All original routes from index.ts are present in routes/:

| Route | File |
|-------|------|
| GET / | routes/public.ts |
| GET /media/* | routes/public.ts |
| GET /api/onlydate/models | routes/public.ts |
| GET /api/onlydate/models/:username | routes/public.ts |
| POST /api/onlydate/admin/upload | routes/admin.ts |
| POST /api/onlydate/admin/feed-entry/photo/add | routes/admin.ts |
| POST /api/onlydate/admin/feed-entry/photo/delete | routes/admin.ts |
| POST /api/onlydate/admin/feed-entry/delete | routes/admin.ts |
| POST /api/onlydate/admin/feed-entry/set-cover | routes/admin.ts |
| GET /api/onlydate/admin/personas | routes/admin.ts |
| POST /api/onlydate/admin/photo/toggle | routes/admin.ts |
| POST /api/onlydate/admin/photo/cover | routes/admin.ts |
| POST /api/onlydate/admin/persona/create | routes/admin.ts |
| GET /api/onlydate/admin/feed-settings | routes/admin.ts |
| POST /api/onlydate/admin/feed-settings | routes/admin.ts |
| POST /api/onlydate/admin/persona/set-feed-visibility | routes/admin.ts |
| POST /api/onlydate/admin/persona/toggle-active | routes/admin.ts |
| POST /webhook/onlydate | routes/webhook.ts |

## Manual Steps Required (Before Deploy)

1. **Set admin password secret:**
   ```bash
   wrangler secret put ADMIN_PASSWORD
   # Enter the actual password value when prompted
   ```

2. **Apply DB migrations (if not already done from Plan 01):**
   ```bash
   wrangler d1 migrations apply onlydate-api --remote
   ```

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None.

## Self-Check: PASSED
