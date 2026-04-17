---
phase: 2
slug: analytics-backend
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-16
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | None — no test infrastructure (deferred per REQUIREMENTS.md v2 deferred list) |
| **Config file** | none |
| **Quick run command** | `pnpm --filter onlydate-worker typecheck` |
| **Full suite command** | `pnpm --filter onlydate-worker typecheck` + manual curl against `wrangler dev` |
| **Estimated runtime** | ~5 seconds (typecheck only) |

---

## Sampling Rate

- **After every task commit:** Run `pnpm --filter onlydate-worker typecheck`
- **After every plan wave:** Run typecheck + manual curl smoke test against `wrangler dev`
- **Before `/gsd:verify-work`:** Phase success criteria 1 and 2 verified manually (D1 row visible, tampered hash rejected with 403)
- **Max feedback latency:** ~5 seconds for typecheck

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| verifyInitData impl | analytics plan | 1 | TRACK-05 | type + manual curl | `pnpm typecheck` + curl tampered hash | ❌ W0 | ⬜ pending |
| POST /api/onlydate/track | analytics plan | 1 | TRACK-05, TRACK-06 | manual curl | curl valid initData, check D1 row | ❌ W0 | ⬜ pending |
| PostHog relay | analytics plan | 1 | TRACK-01..04 | manual smoke | PostHog Live Events view | manual-only | ⬜ pending |
| Cron handler + wrangler.toml | cron plan | 2 | TRACK-08 | manual | `wrangler dev --test-scheduled` + D1 query | manual-only | ⬜ pending |
| POSTHOG_API_KEY secret | deployment | 2 | TRACK-01 | manual | `wrangler secret list` shows POSTHOG_API_KEY | manual-only | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

No Wave 0 setup needed — automated test framework is out of scope per REQUIREMENTS.md v2 deferred list ("Automated test suite — tracking as known gap"). `pnpm typecheck` uses existing tsconfig.

*Existing infrastructure covers all automated verification needs for this phase.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Events appear in PostHog Live Events | TRACK-01..04 | Requires live network call to EU PostHog endpoint | POST to /api/onlydate/track with valid initData, check PostHog UI within 30s |
| start_param stored on session_start | TRACK-06 | D1 REST API requires CF account creds not in CI | Check D1 dashboard for row with start_param populated |
| Cron deletes 90-day-old rows | TRACK-08 | Requires live D1 and time manipulation | Insert test row with created_at 91 days ago, run `wrangler dev --test-scheduled`, confirm row deleted |
| Tampered hash rejected with 403 | TRACK-05 | Requires live Worker and real BOT_TOKEN | curl with modified initData hash, expect 403 + no D1 row written |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
