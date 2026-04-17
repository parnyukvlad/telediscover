---
phase: 02-analytics-backend
plan: 02
subsystem: worker-wiring
tags: [analytics, cron, posthog, wrangler, typescript]
dependency_graph:
  requires: [02-01]
  provides: [analytics-route-mounted, cron-prune-wired, posthog-key-available]
  affects: [apps/onlydate-worker/src/index.ts, apps/onlydate-worker/wrangler.toml]
tech_stack:
  added: []
  patterns: [hono-object-export-with-scheduled, d1-cron-delete, wrangler-vars-public-token]
key_files:
  created: []
  modified:
    - apps/onlydate-worker/src/index.ts
    - apps/onlydate-worker/wrangler.toml
    - apps/onlydate-worker/src/shared/telegram.ts
decisions:
  - "POSTHOG_API_KEY placed in [vars] (not wrangler secret) — it is a public write-only PostHog project token, safe to commit per PostHog documentation"
  - "export default refactored to object form { fetch: app.fetch, scheduled() } — required for Cloudflare Workers cron trigger support"
  - "pruneOldEvents uses Date.now() milliseconds for cutoff — matches D-04 decision from Phase 1 (created_at stores Unix ms)"
metrics:
  duration_minutes: 15
  completed_date: "2026-04-16"
  tasks_completed: 2
  files_modified: 3
---

# Phase 2 Plan 02: Worker Wiring & Cron Summary

**One-liner:** Mounted analytics route in index.ts, refactored to object-export with scheduled() cron, added POSTHOG_API_KEY to wrangler.toml [vars] and daily prune trigger.

## What Was Built

### Task 1: Refactor index.ts
- Added `import analyticsRoutes from './routes/analytics'`
- Added `POSTHOG_API_KEY: string` to `Env` interface
- Mounted `app.route('/', analyticsRoutes)` — POST /api/onlydate/track now reachable
- Added `pruneOldEvents(db)` — deletes `onlydate_events` rows older than 90 days using parameterized D1 query
- Refactored `export default app` → `export default { fetch: app.fetch, scheduled(...) }` — object form required for cron support
- `scheduled()` calls `ctx.waitUntil(pruneOldEvents(env.DB))` daily at midnight UTC

### Task 2: Update wrangler.toml
- Added `POSTHOG_API_KEY = "phc_zprkyviP8t2JwCCMWQUPn3GwJmi6MtAXvApPkUBXtf6f"` to `[vars]`
- Added `[triggers]` section with `crons = ["0 0 * * *"]`
- All existing bindings (DB, MEDIA, ADMIN_PASSWORD) preserved unchanged

## Commits

| Task | Commit | Files |
|------|--------|-------|
| Task 1 | 14db682 | apps/onlydate-worker/src/index.ts, apps/onlydate-worker/src/shared/telegram.ts |
| Task 2 | 297067f | apps/onlydate-worker/wrangler.toml |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed URLSearchParams.entries() type error in shared/telegram.ts**
- **Found during:** Task 1 verification (pnpm typecheck)
- **Issue:** `[...params.entries()]` on line 29 caused `TS2339: Property 'entries' does not exist on type 'URLSearchParams'` — the default `@cloudflare/workers-types` index.d.ts URLSearchParams class is overridden by the DOM lib, hiding iterator methods
- **Fix:** Replaced spread+entries with `forEach` to collect key-value pairs into `[string, string][]` array — avoids the type conflict entirely
- **Files modified:** `apps/onlydate-worker/src/shared/telegram.ts`
- **Commit:** 14db682 (included in Task 1 commit)

## Verification

- `pnpm --filter onlydate-worker typecheck` exits 0 — no type errors
- `apps/onlydate-worker/src/index.ts` contains `import analyticsRoutes from './routes/analytics'`
- `apps/onlydate-worker/src/index.ts` contains `fetch: app.fetch` (object export form)
- `apps/onlydate-worker/src/index.ts` contains `async scheduled(`
- `apps/onlydate-worker/src/index.ts` does NOT contain `export default app`
- `apps/onlydate-worker/wrangler.toml` contains `[triggers]` and `crons = ["0 0 * * *"]`
- `apps/onlydate-worker/wrangler.toml` contains `POSTHOG_API_KEY`

## Known Stubs

None. All wiring is functional — analytics route mounted, cron handler wired, POSTHOG_API_KEY available as binding.

## Self-Check: PASSED
