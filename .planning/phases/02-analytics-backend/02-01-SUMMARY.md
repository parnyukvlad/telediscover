---
phase: 02-analytics-backend
plan: "01"
subsystem: analytics
tags: [analytics, security, telegram, posthog, hmac]
dependency_graph:
  requires: []
  provides:
    - verifyInitData (shared/telegram.ts)
    - POST /api/onlydate/track (routes/analytics.ts)
  affects:
    - apps/onlydate-worker/src/index.ts (Plan 02-02 will mount the route)
tech_stack:
  added: []
  patterns:
    - Mini App HMAC-SHA256 key derivation (WebAppData scheme)
    - Hono sub-app with Env bindings pattern
    - c.executionCtx.waitUntil for fire-and-forget PostHog relay
key_files:
  created:
    - apps/onlydate-worker/src/routes/analytics.ts
  modified:
    - apps/onlydate-worker/src/shared/telegram.ts
decisions:
  - verifyInitData uses Mini App HMAC scheme (WebAppData key, not Login Widget SHA256)
  - HMAC check always first, auth_date freshness second — never reversed
  - user_id extracted from server-validated initData only, never client-supplied
  - D1 write is synchronous (awaited) — source of truth; PostHog relay is fire-and-forget
  - distinct_id = tg_${userId} prefix to avoid namespace collision in PostHog
  - No PII (first_name, last_name, username, photo_url) sent to PostHog
  - sendToPostHog is module-private in analytics.ts, not exported to shared/
metrics:
  duration_seconds: 124
  completed_date: "2026-04-16"
  tasks_completed: 2
  tasks_total: 2
  files_created: 1
  files_modified: 1
---

# Phase 02 Plan 01: Analytics Core — verifyInitData + POST /track Summary

**One-liner:** JWT-style server-side HMAC validation for Telegram initData plus trusted event pipeline writing to D1 and relaying to PostHog EU via waitUntil.

## What Was Built

Two files implement the core analytics data pipeline:

1. **`apps/onlydate-worker/src/shared/telegram.ts`** — appended `verifyInitData(initData, botToken)` which validates Telegram Mini App initData using the correct HMAC scheme (HMAC-SHA256 of data_check_string keyed with HMAC-SHA256("WebAppData", botToken)), then checks auth_date freshness within 24 hours. Existing exports (`MEDIA_BASE`, `MINIAPP_URL`, `tgSend`) unchanged.

2. **`apps/onlydate-worker/src/routes/analytics.ts`** — new Hono sub-app exporting `default app` with `POST /api/onlydate/track`. The route: parses request body, validates required fields, runs HMAC verification, extracts user_id from validated initData (never client-supplied), writes event row to D1 `onlydate_events` synchronously, then fire-and-forgets to PostHog EU via `c.executionCtx.waitUntil`.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add verifyInitData to shared/telegram.ts | 5d4c293 | apps/onlydate-worker/src/shared/telegram.ts |
| 2 | Create routes/analytics.ts with POST /api/onlydate/track | 8450862 | apps/onlydate-worker/src/routes/analytics.ts |

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| Mini App HMAC scheme (WebAppData key derivation) | Per D-09: distinct from Login Widget scheme; Telegram enforces different key derivation for Mini Apps |
| HMAC check before auth_date | Prevents timing attacks — don't reveal freshness info on tampered tokens |
| user_id from server-validated initData only | Prevents event forgery via client-supplied user_id (CLAUDE.md identity constraint) |
| D1 write synchronous, PostHog fire-and-forget | D1 is source of truth; PostHog relay failure must not block the response or lose the D1 record |
| distinct_id = tg_${userId} | Avoids collision with other PostHog projects using numeric IDs |
| No PII to PostHog | D-06 constraint; first_name/last_name/username/photo_url excluded |
| sendToPostHog module-private | Clean boundary; PostHog relay is an implementation detail of this route file |

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None. This plan produces infrastructure only (no UI components, no data rendering to frontend).

## Self-Check: PASSED

Files exist:
- FOUND: apps/onlydate-worker/src/shared/telegram.ts (verifyInitData appended)
- FOUND: apps/onlydate-worker/src/routes/analytics.ts (created)

Commits exist:
- FOUND: 5d4c293 — feat(02-01): add verifyInitData HMAC validator to shared/telegram.ts
- FOUND: 8450862 — feat(02-01): create routes/analytics.ts with POST /api/onlydate/track
