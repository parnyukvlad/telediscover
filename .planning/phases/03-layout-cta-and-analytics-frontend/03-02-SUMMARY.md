---
phase: 03-layout-cta-and-analytics-frontend
plan: "02"
subsystem: frontend-analytics
tags: [analytics, tracking, attribution, session, telegram]
dependency_graph:
  requires: [03-01]
  provides: [track-utility, session-start-event, profile-open-event, attribution-capture]
  affects: [apps/onlydate/index.html]
tech_stack:
  added: []
  patterns:
    - navigator.sendBeacon with Blob JSON payload for fire-and-forget analytics
    - sessionStorage for attribution persistence across WebView hot-reloads
    - fetch keepalive fallback when sendBeacon unavailable or returns false
key_files:
  created: []
  modified:
    - apps/onlydate/index.html
decisions:
  - track() uses navigator.sendBeacon with new Blob([payload], {type:'application/json'}) — plain string sends as text/plain which Hono c.req.json() rejects
  - if (!sent) fallback checks sendBeacon return value (not just availability) — covers payload-too-large and older WebView cases
  - sessionStorage checked first in init() so attribution survives Telegram WebView hot-reload where tg.initDataUnsafe.start_param is lost
  - track() defined before const tg — safe because track() is only called after tg is initialized inside init() and event handlers
metrics:
  duration_seconds: 206
  completed_date: "2026-04-16"
  tasks_completed: 2
  files_modified: 1
---

# Phase 03 Plan 02: Analytics Frontend Wiring Summary

**One-liner:** Fire-and-forget `track()` via sendBeacon/fetch-keepalive with sessionStorage-persisted attribution for `session_start` and `profile_open` events.

## What Was Built

Added the `track()` analytics utility function and wired `session_start` (with attribution) and `profile_open` events into `apps/onlydate/index.html`.

### Task 1: track() utility function

Inserted `function track(eventType, extra)` immediately after `const API_BASE` and before `const tg` in the script block. The function:

- Builds a JSON payload by merging base fields (all nullable) with the `extra` argument via `Object.assign`
- Sends via `navigator.sendBeacon(url, new Blob([payload], { type: 'application/json' }))` — the Blob wrapper is required because a plain string sends as `text/plain` which Hono's `c.req.json()` rejects
- Falls back to `fetch` with `keepalive: true` when `sendBeacon` is unavailable OR returns `false` (payload too large, page unloading)
- All failures silently swallowed — user experience is never degraded

### Task 2: Attribution read + event wiring

**init() attribution block** (inserted before `renderSkeletons()`):
- Checks `sessionStorage.getItem('od_attr')` first — if present from a previous hot-reload, uses it directly
- On first load: reads `tg.initDataUnsafe.start_param` (with triple guard for null safety) and URL `utm_*` params, stores in sessionStorage
- Fires `track('session_start', attr)` immediately with all four attribution fields

**Safe-area JS override** (appended after attribution block):
- Reads `tg.contentSafeAreaInset.top` for older Telegram clients where CSS `env()` returns 0
- Sets `$tabBar.style.paddingTop` directly

**openProfile() profile_open** (inserted after `renderProfile(profile)`):
- Fires `track('profile_open', { persona_handle: currentProfile.username || null })`
- Called on every profile view (no deduplication — matches plan spec)

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — all tracking events are fully wired to the backend endpoint `POST /api/onlydate/track`.

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| Task 1 | ebd924e | feat(03-02): add track() analytics utility to Mini App script |
| Task 2 | ea30dd1 | feat(03-02): wire session_start attribution and profile_open events |

## Self-Check: PASSED

- [x] `apps/onlydate/index.html` modified — confirmed
- [x] Commit ebd924e exists — confirmed
- [x] Commit ea30dd1 exists — confirmed
- [x] `function track` appears exactly 1 time — confirmed
- [x] `od_attr` appears exactly 2 times (getItem + setItem) — confirmed
- [x] `session_start` appears exactly 1 time — confirmed
- [x] `profile_open` appears exactly 1 time — confirmed
- [x] `keepalive` appears exactly 1 time — confirmed
- [x] `track('session_start', attr)` at line 652 is BEFORE `renderSkeletons()` at line 659 — confirmed
- [x] `renderProfile(profile)` at line 781 is BEFORE `track('profile_open', ...)` at line 782 — confirmed
