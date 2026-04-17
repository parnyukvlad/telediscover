# Phase 1: Foundation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-16
**Phase:** 01-foundation
**Areas discussed:** Events schema, Router split structure, sort_order defaults, Migration count

---

## Events Schema

| Option | Description | Selected |
|--------|-------------|----------|
| Minimal (id, event_type, user_id, created_at only) | Lean table; add columns in Phase 2 via migration | |
| Full attribution columns now | Include start_param + utm_* + persona_handle in Phase 1 | ✓ |

**User's choice:** Delegated to Claude.
**Notes:** Chose full schema upfront to avoid a Phase 2 ALTER TABLE. All attribution columns nullable so non-attribution events leave them NULL. Three indexes cover per-user queries, TTL pruning, and funnel aggregation.

---

## Router Split Structure

| Option | Description | Selected |
|--------|-------------|----------|
| Minimal 2-file (admin + public) | Webhook stays in index.ts | |
| 3 route files + shared/ (admin, public, webhook) | Clean separation by concern | ✓ |
| Granular 5+ files | One file per endpoint group | |

**User's choice:** Delegated to Claude.
**Notes:** 3 route files + 3 shared utility files keeps index.ts as a thin assembly point. Webhook is small but logically distinct enough to warrant its own file. shared/ follows the roadmap spec.

---

## sort_order Default for Existing Rows

| Option | Description | Selected |
|--------|-------------|----------|
| NULL | Requires NULLS LAST in ORDER BY | |
| 0 | All tied — stable only by rowid | |
| Sequential by created_at | 1, 2, 3… via UPDATE in migration | ✓ |

**User's choice:** Delegated to Claude.
**Notes:** Sequential gives admin a sensible drag-drop starting state. Implemented via UPDATE in the migration using a correlated subquery on created_at.

---

## Migration Count

| Option | Description | Selected |
|--------|-------------|----------|
| 1 file with all changes | Simpler | |
| 2 files (columns + events table) | One logical concern per file | ✓ |

**User's choice:** Delegated to Claude.
**Notes:** Follows existing convention. 0004 = feed_entry_ordering, 0005 = events. Easier to reason about in D1 dashboard.

---

## Claude's Discretion

- Hono mounting pattern (app.route() vs sub-app)
- Named exports style in shared/db.ts
- Migration idempotency guards (IF NOT EXISTS)

## Deferred Ideas

- sessionStorage password fix — future security phase
- FK constraint on onlydate_feed_photos.feed_entry_id — future phase
- Wildcard CORS restriction — future phase
