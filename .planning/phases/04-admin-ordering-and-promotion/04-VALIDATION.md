---
phase: 04
slug: admin-ordering-and-promotion
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-17
---

# Phase 04 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | none — no automated test framework in project (known gap) |
| **Config file** | none |
| **Quick run command** | `npx tsc --noEmit` |
| **Full suite command** | `npx tsc --noEmit` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx tsc --noEmit`
- **After every plan wave:** Run `npx tsc --noEmit`
- **Before `/gsd:verify-work`:** TypeScript check must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 04-01-01 | 01 | 1 | ADMIN-08 | manual | grep sort_order | ✅ | ⬜ pending |
| 04-01-02 | 01 | 1 | ADMIN-09 | manual | grep 9999999 | ✅ | ⬜ pending |
| 04-01-03 | 01 | 1 | ADMIN-10 | manual | grep is_promoted | ✅ | ⬜ pending |
| 04-02-01 | 02 | 2 | PROMO-01 | manual | visual in Telegram | ❌ | ⬜ pending |
| 04-02-02 | 02 | 2 | PROMO-02 | manual | grep @keyframes | ✅ | ⬜ pending |
| 04-02-03 | 02 | 2 | PROMO-03 | manual | visual on Android | ❌ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*Existing infrastructure covers all phase requirements. No automated test framework — project relies on TypeScript type-checking and manual verification (known gap from PROJECT.md Out of Scope).*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Drag-drop reorder in admin | ADMIN-08 | Touch interaction requires live browser | Open /photochoose, drag entries, verify order persists |
| Personas always below feed entries | ADMIN-09 | Visual ordering requires live feed | Open public feed, verify personas appear at bottom |
| Promote toggle moves entry up | ADMIN-10 | Visual ordering requires live feed | Toggle promote in admin, reload public feed |
| Star-sparkle animation visible | PROMO-01, PROMO-02 | CSS animation requires visual check | Open public feed, verify promoted cards have animated frame |
| Smooth animation on mid-range Android | PROMO-03 | Performance requires physical device | Open on Android, check for jank in star animation |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
