# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v1.0 — Ad-Launch Readiness

**Shipped:** 2026-04-17
**Phases:** 5 | **Plans:** 15 | **Sessions:** ~8

### What Was Built

- **Foundation:** D1 schema migrations (sort_order, is_promoted, onlydate_events), worker modularized into routes/ + shared/, admin credential rotated from source literal to Wrangler secret
- **Analytics backend:** HMAC-validated event ingestion (POST /api/onlydate/track), PostHog relay via ctx.waitUntil, 90-day TTL cron, per-user attribution capture (start_param + utm_*)
- **Frontend:** 9:16 portrait layout with 100dvh + iOS safe-area, chat CTA deeplinks to `t.me/<handle>` with sendBeacon tracking, profile_click_chat and session_start events
- **Admin ordering & promotion:** SortableJS drag-drop reorder (D1 batch atomic), is_promoted toggle, animated gold star-sparkle on public feed cards (IntersectionObserver + GPU-composited CSS)
- **Admin profile & image management:** Feed entry edit modal, photo hide/unhide, client-side canvas WebP resize (≤800px, 0.85 quality), HTML minification pipeline (38% reduction)

### What Worked

- **Shared utility module pattern** (`src/shared/auth.ts`, `db.ts`, `telegram.ts`) — clean separation, easy to extend per-phase without touching other routes
- **D1 batch() for atomic operations** — used in both reorder (multi-row sort_order update) and delete (photos + entry in one transaction) without needing transactions API
- **Fields allowlist for dynamic UPDATE** — SQL-safe pattern without string interpolation, reusable
- **sendBeacon + keepalive fallback** — covers both payload-too-large edge cases and older Telegram WebView contexts
- **Yolo mode + phase branches** — kept execution fast; planning artifacts committed per-phase without blocking code work

### What Was Inefficient

- **Plan 02-03 was documentation-only** — a full plan slot was used just to fix a traceability gap (TRACK-07 scope split). Could have been caught during Phase 2 review.
- **Config inconsistency:** top-level `branching_strategy: "phase"` but `git.branching_strategy: "none"` — caused confusion when handling branches at milestone completion
- **Phase branches never merged to master during development** — master stayed at initial commit throughout all 5 phases; merge debt accumulated

### Patterns Established

- `{ ok: true, ...fields }` / `{ error: string }` response shape — consistent across all 13+ admin routes
- Route sub-app pattern: each `routes/*.ts` is a `new Hono<{Bindings:Env}>()` mounted in thin `index.ts`
- `canvas.toBlob('image/webp')` client-side resize with Safari fallback (check `blob.type` post-toBlob)
- `deploy:pages` chains `minify → wrangler pages deploy` so dist is always fresh — no manual pre-step

### Key Lessons

1. **Split scope explicitly in context docs.** TRACK-07 split (backend Phase 2 / frontend Phase 3) caused a documentation plan just to fix the traceability. Document scope splits in CONTEXT.md upfront.
2. **Merge to main incrementally.** Letting 100 commits accumulate on feature branches before merging creates a large squash-or-history decision at completion.
3. **Yolo mode saves time for mature plans.** When planning was thorough, yolo execution was smooth. The only rework was in underdefined scope boundaries.

### Cost Observations

- Model mix: ~80% sonnet, ~20% opus (researchers + roadmapper)
- Sessions: ~8 across 5 phases
- Notable: Phase 4 Plan 03 (30M duration_seconds in STATE.md) was a data anomaly — actual execution was ~30 minutes

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Sessions | Phases | Key Change |
|-----------|----------|--------|------------|
| v1.0 | ~8 | 5 | First milestone — baseline established |

### Cumulative Quality

| Milestone | Tests | Coverage | Zero-Dep Additions |
|-----------|-------|----------|-------------------|
| v1.0 | 0 (manual UAT) | — | SortableJS CDN only |

### Top Lessons (Verified Across Milestones)

1. Document scope splits explicitly in phase CONTEXT.md — ambiguous boundaries cause documentation rework
2. Merge incrementally to avoid end-of-milestone branch debt
