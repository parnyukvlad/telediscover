---
phase: 5
slug: admin-profile-and-image-management
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-17
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | none — vanilla JS frontend, no unit test runner in project |
| **Config file** | none |
| **Quick run command** | `grep -c "PATTERN" FILE` (per-task grep checks defined below) |
| **Full suite command** | Manual deploy + human QA per task checkpoint |
| **Estimated runtime** | ~30 seconds per grep batch |

---

## Sampling Rate

- **After every task commit:** Run grep verify commands from the task's `<verify>` block
- **After every plan wave:** Human deploy + spot check on staging
- **Before `/gsd:verify-work`:** All grep checks pass; deploy confirmed; human QA done
- **Max feedback latency:** 60 seconds (grep) / human gate at phase end

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | Status |
|---------|------|------|-------------|-----------|-------------------|--------|
| 05-01-01 | 01 | 1 | ADMIN-07 | grep | `grep -c "is_hidden" apps/onlydate-worker/migrations/0007_feed_photo_hidden.sql` | ⬜ pending |
| 05-01-02 | 01 | 1 | ADMIN-01 | grep | `grep -c "feed-entry/update" apps/onlydate-worker/src/routes/admin.ts` | ⬜ pending |
| 05-01-03 | 01 | 1 | ADMIN-07 | grep | `grep -c "photo/toggle-hidden" apps/onlydate-worker/src/routes/admin.ts` | ⬜ pending |
| 05-01-04 | 01 | 1 | ADMIN-03,ADMIN-06 | grep | `grep -c "console.error.*R2 delete" apps/onlydate-worker/src/routes/admin.ts` | ⬜ pending |
| 05-01-05 | 01 | 1 | ADMIN-07 | grep | `grep -c "onlydate_feed_photos.*is_hidden" apps/onlydate-worker/src/routes/public.ts` | ⬜ pending |
| 05-02-01 | 02 | 2 | ADMIN-01 | grep | `grep -c "editPersona\|edit-modal\|feed-entry/update" apps/onlydate/photochoose/index.html` | ⬜ pending |
| 05-02-02 | 02 | 2 | ADMIN-07 | grep | `grep -c "toggle-hidden\|photo/toggle-hidden" apps/onlydate/photochoose/index.html` | ⬜ pending |
| 05-02-03 | 02 | 2 | PERF-03 | grep | `grep -c "resizeToWebP\|toBlob" apps/onlydate/photochoose/index.html` | ⬜ pending |
| 05-03-01 | 03 | 3 | PERF-04 | grep | `test -f apps/onlydate-dist/index.html && echo EXISTS` | ⬜ pending |
| 05-03-02 | 03 | 3 | PERF-04 | grep | `grep -c "onlydate-dist" package.json` | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

No test framework needed — all verification is grep-based or manual. No Wave 0 setup required.

*Existing infrastructure (grep + manual QA) covers all phase requirements.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Edit modal updates profile on public feed immediately | ADMIN-01 | Needs live deploy + browser check | Open admin, edit display_name, confirm public feed shows new name without refresh |
| Hide/unhide profile — no page refresh | ADMIN-02 | Needs live deploy + browser interaction | Toggle feed_visible, confirm persona disappears/appears in public feed |
| Soft-delete removes profile from feed | ADMIN-03 | Needs live deploy | Set is_active=0, confirm profile gone from public feed |
| R2 delete errors visible in Worker logs | ADMIN-03,ADMIN-06 | Needs Cloudflare dashboard | Trigger a delete with invalid R2 key, confirm error in Cloudflare Worker logs |
| Gallery photo hide/unhide on admin + public profile | ADMIN-07 | Needs live deploy | Hide a feed_entry photo in admin, confirm it's gone from public profile view |
| Canvas resize produces ≤800px WebP | PERF-03 | Needs browser DevTools | Upload a large image, check Network tab: Content-Type: image/webp, check width ≤ 800px in R2 |
| Minified HTML is smaller than source | PERF-04 | File size comparison | `wc -c apps/onlydate/index.html apps/onlydate-dist/index.html` |
| Minified app still works end-to-end | PERF-04 | Functional check | Open `apps/onlydate-dist` in browser, verify feed loads and chat buttons work |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or manual verification documented
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0: not applicable (no test framework)
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s for grep checks
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
