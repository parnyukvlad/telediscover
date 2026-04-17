---
phase: 03-layout-cta-and-analytics-frontend
plan: "03"
subsystem: frontend
tags: [chat-cta, analytics, performance, feed, profile, lightbox]
dependency_graph:
  requires: [03-02]
  provides: [CHAT-01, CHAT-02, CHAT-03, PERF-01, PERF-02, PERF-05, TRACK-07-frontend]
  affects: [apps/onlydate/index.html]
tech_stack:
  added: []
  patterns:
    - Delegated click handler with chat-button branch checked before card-open branch (stopPropagation pattern)
    - track() fired before navigation to guarantee event dispatch before Mini App closes (sendBeacon + keepalive)
    - Lightbox handler navigates directly to avoid double-firing profile_click_chat
key_files:
  created: []
  modified:
    - apps/onlydate/index.html
decisions:
  - Lightbox msg handler inlines navigation instead of delegating to onMessageClick() — avoids double-firing profile_click_chat (one call site per user gesture)
  - card-chat-btn branch placed FIRST in delegated listener + stopPropagation to prevent card-open from co-firing
  - track() always fires before tg.openTelegramLink / window.open — TRACK-07 guarantee even when Mini App closes immediately
metrics:
  duration_seconds: 368
  completed_date: "2026-04-16"
  tasks_completed: 2
  tasks_total: 3
  files_modified: 1
key_decisions:
  - Lightbox msg handler inlines navigation (no delegation to onMessageClick) to prevent double profile_click_chat fire
  - chat button branch checked before card branch in delegated listener — stopPropagation prevents profile open on chat tap
---

# Phase 03 Plan 03: Chat CTA buttons, analytics instrumentation, share removal, eager loading Summary

Card chat icon button on every feed card, full analytics instrumentation across all three chat CTA paths (card / profile / lightbox), share button removed, first-card eager loading applied.

## What Was Built

### Task 1: Card chat button + delegated handler + first-card eager loading

Modified `renderGrid()` to add a paper-plane SVG button (`card-chat-btn`) to every feed card. The first card's `<img>` uses `loading="eager"` (PERF-01); all subsequent cards use `loading="lazy"` (PERF-02). The `i` parameter from `.map(function (m, i)` was already in scope — no new variable needed.

Modified `attachGridEvents()` to check `.card-chat-btn` FIRST in the delegated click handler. When the chat button is tapped:
1. `e.stopPropagation()` fires
2. `track('feed_card_click_chat', { persona_handle: handle })` fires (TRACK-07 — before navigation)
3. `tg.openTelegramLink(url)` fires (with `window.open` fallback)
4. Handler returns — `.model-card` branch is never reached

When the user taps elsewhere on the card, the `.card-chat-btn` closest check returns null, flow falls through to the `.model-card` branch, and `openProfile()` is called as before.

### Task 2: Profile/lightbox chat CTAs + share removal

Four edits in one task:

1. **renderProfile() HTML**: Removed `<button class="btn-outline" id="btn-share">↗ Share</button>` and its event listener. Changed `💬 Message` label to `Message` (D-24).
2. **onShareClick() deleted**: Entire function body removed (D-20).
3. **onMessageClick() instrumented**: `track('profile_click_chat', { persona_handle: currentProfile.username })` prepended before `var url =` — fires before navigation (TRACK-07).
4. **$lightboxMsg handler replaced**: Instead of delegating to `onMessageClick()` (which would double-fire `profile_click_chat`), the handler now fires `track('profile_click_chat')` itself, then calls `closeLightbox()`, then navigates directly. This ensures exactly one `profile_click_chat` event per lightbox tap.

## Verification Results

```
btn-share count:          0  (must be 0)    ✓
onShareClick count:       0  (must be 0)    ✓
card-chat-btn count:      4  (must be 3+)   ✓  (CSS×2 + template + handler)
feed_card_click_chat:     1  (must be 1)    ✓
profile_click_chat:       2  (must be 2)    ✓  (onMessageClick + lightbox)
loading="eager" count:    1  (must be 1)    ✓
session_start count:      1  (must be 1)    ✓
profile_open count:       1  (must be 1)    ✓
```

## Deviations from Plan

None — plan executed exactly as written. The plan itself noted the double-fire risk for the lightbox handler and prescribed the inline navigation pattern (Edit 4 final form). That prescription was followed.

## Known Stubs

None. All three chat CTA paths are fully wired. Analytics events flow to the existing `track()` function (implemented in Plan 02) which uses `sendBeacon` with `keepalive` fallback.

## Commits

| Task | Commit | Message |
|------|--------|---------|
| Task 1 | 736d71d | feat(03-03): card chat button + delegated handler + first-card eager loading |
| Task 2 | b3e7d95 | feat(03-03): profile/lightbox chat CTAs + share button removal |

## Checkpoint Status

Task 3 is `type="checkpoint:human-verify"` — execution paused. Human verification of all Phase 3 changes required in the Telegram client before the phase can be called complete.

## Self-Check: PASSED

- apps/onlydate/index.html: FOUND
- Commit 736d71d: FOUND
- Commit b3e7d95: FOUND
