---
phase: 3
slug: layout-cta-and-analytics-frontend
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-16
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | None — zero automated tests exist (see TESTING.md) |
| **Config file** | None |
| **Quick run command** | `pnpm typecheck` (TypeScript only; frontend is vanilla JS) |
| **Full suite command** | `pnpm typecheck` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Manual visual check in browser (wrangler dev + Telegram WebApp dev mode)
- **After every plan wave:** `pnpm typecheck` (ensures worker TypeScript unchanged) + manual smoke test in Telegram iOS
- **Before `/gsd:verify-work`:** All 5 phase success criteria must be TRUE
- **Max feedback latency:** ~30 seconds (manual visual check per task)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 03-01-01 | 01 | 1 | LAYOUT-01, LAYOUT-02 | visual/manual | — | N/A | ⬜ pending |
| 03-01-02 | 01 | 1 | LAYOUT-03 | visual/manual | — | N/A | ⬜ pending |
| 03-02-01 | 02 | 1 | CHAT-01, CHAT-02, CHAT-03 | manual (Telegram client) | — | N/A | ⬜ pending |
| 03-03-01 | 03 | 2 | PERF-01, PERF-02, PERF-05 | inspect network tab / DOM | — | N/A | ⬜ pending |
| 03-04-01 | 04 | 2 | TRACK-07 | D1 query after tap | — | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

None — no test framework setup is needed. All changes target `apps/onlydate/index.html` (vanilla JS/CSS). Testing is manual per TESTING.md documented status.

*Existing infrastructure covers all phase requirements (TypeScript typecheck covers backend; frontend is untestable with current tooling).*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Portrait fill on mobile Telegram | LAYOUT-01 | No CSS test tooling | Open Mini App in Telegram iOS/Android; verify full-screen portrait with no gray bars |
| 9:16 centered on Desktop, dark letterbox | LAYOUT-02 | Visual layout | Open Mini App in Telegram Desktop; verify centered 9:16 column with dark letterboxing |
| Safe areas don't break layout | LAYOUT-03 | Device-specific env vars | Test on iPhone with notch; verify tab-bar not clipped, profile-topbar not hidden under status bar |
| Feed card chat icon opens Telegram DM | CHAT-01 | Requires live Telegram client | Tap chat icon on feed card; verify DM opens with correct model handle |
| Profile message button opens DM | CHAT-02 | Requires live Telegram client | Open profile, tap message button; verify DM opens |
| Works iOS / Android / Desktop | CHAT-03 | Three platforms | Repeat CHAT-01/02 on each platform; verify no Safari handoff or broken nav |
| First card loads eagerly | PERF-01 | Network inspection | Open DevTools Network; verify first card image has no `loading="lazy"` attribute |
| Other images lazy-load | PERF-02 | Network inspection | Scroll down; verify below-fold images not fetched until in viewport |
| Share button absent, simplified UI | PERF-05 | DOM inspection | Inspect profile view; confirm share button removed or hidden |
| Analytics events land in D1 before navigation | TRACK-07 | D1 query after tap | Tap chat button; query D1 for `feed_card_click_chat` / `profile_click_chat`; confirm row present before DM opens |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
