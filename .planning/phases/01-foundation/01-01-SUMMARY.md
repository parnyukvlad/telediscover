---
phase: 01-foundation
plan: 01
subsystem: database
tags: [d1, sqlite, migrations, analytics, ordering]

# Dependency graph
requires: []
provides:
  - sort_order and is_promoted columns on onlydate_feed_entries (Phase 4 drag-drop ordering + promotion)
  - onlydate_events table with 9 columns and 3 indexes (Phase 2 analytics tracking)
affects:
  - 01-02 (router modularization — no dependency, but same phase)
  - Phase 2 (analytics tracking — consumes onlydate_events)
  - Phase 4 (admin ordering/promotion — consumes sort_order, is_promoted, idx_feed_entries_sort)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "D1 ALTER TABLE migration with correlated subquery UPDATE for backfill"
    - "Composite index matching ORDER BY clause for query optimization"

key-files:
  created:
    - apps/onlydate-worker/migrations/0004_feed_entry_ordering.sql
    - apps/onlydate-worker/migrations/0005_events.sql
  modified: []

key-decisions:
  - "sort_order is nullable INTEGER (no NOT NULL) so D1 accepts ALTER TABLE on existing rows without error; UPDATE immediately backfills all rows"
  - "is_promoted uses INTEGER NOT NULL DEFAULT 0 — D1 allows adding NOT NULL column with a DEFAULT"
  - "user_id stored as TEXT not INTEGER to avoid integer overflow and match Telegram ID patterns across codebase"
  - "Composite index (is_promoted DESC, sort_order ASC) mirrors the Phase 4 ORDER BY exactly"
  - "Three indexes on onlydate_events target the three query patterns: per-user, TTL pruning, funnel aggregation"

patterns-established:
  - "Migration 0004: ALTER TABLE + correlated subquery UPDATE for sequential sort_order backfill"
  - "Migration 0005: CREATE TABLE IF NOT EXISTS with all nullable attribution columns for future Phase 2 population"

requirements-completed: []

# Metrics
duration: 2min
completed: 2026-04-16
---

# Phase 1 Plan 01: DB Schema Migrations for Ordering, Promotion, and Analytics

**Two D1 migration files adding sort_order + is_promoted to feed entries and creating the onlydate_events analytics table with 3 query-optimized indexes**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-04-16T19:10:23Z
- **Completed:** 2026-04-16T19:11:39Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Migration 0004 adds `sort_order INTEGER` and `is_promoted INTEGER NOT NULL DEFAULT 0` to `onlydate_feed_entries`, backfills existing rows with sequential sort order derived from `created_at`, and creates composite index `(is_promoted DESC, sort_order ASC)` matching the Phase 4 ORDER BY clause
- Migration 0005 creates `onlydate_events` with the exact 9-column schema specified in D-04 through D-08, plus 3 indexes covering per-user queries, TTL pruning, and funnel aggregation
- Migrations 0001–0003 were not touched

## Task Commits

Each task was committed atomically:

1. **Task 1: Migration 0004 — sort_order + is_promoted on feed entries** - `bff7ca3` (chore)
2. **Task 2: Migration 0005 — onlydate_events analytics table** - `8859853` (chore)

## Files Created/Modified
- `apps/onlydate-worker/migrations/0004_feed_entry_ordering.sql` — ALTER TABLE adds sort_order + is_promoted; correlated subquery UPDATE backfills sequential order; composite index for Phase 4 ORDER BY
- `apps/onlydate-worker/migrations/0005_events.sql` — CREATE TABLE onlydate_events (9 columns); 3 indexes for per-user queries, TTL cron pruning, and funnel aggregation

## Decisions Made
- `sort_order` is nullable (no `NOT NULL`) because D1 rejects `ALTER TABLE ADD COLUMN NOT NULL` without a default on existing tables. The correlated subquery `UPDATE` immediately after ensures every row gets a value.
- `is_promoted INTEGER NOT NULL DEFAULT 0` is safe because D1 permits `NOT NULL` with a `DEFAULT` on new columns.
- `user_id TEXT` (not INTEGER) matches Telegram ID handling across the codebase and avoids integer overflow.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

**Manual step required after this plan:** Apply the migrations to the remote D1 database with valid Cloudflare credentials:

```bash
wrangler d1 migrations apply onlydate-api --remote
```

This requires a Cloudflare account with API access and the Worker's `wrangler.toml` database binding configured. The migration files are ready; only the `wrangler` CLI invocation is needed.

## Known Stubs

None — this plan only creates SQL migration files; no application code or UI was modified.

## Next Phase Readiness
- Migration 0004 ready: Phase 4 can implement drag-drop ordering and promotion toggle on top of the new columns and index
- Migration 0005 ready: Phase 2 can implement `POST /api/onlydate/track` and the 90-day TTL cron against the new `onlydate_events` table
- Blocker: migrations must be applied (`wrangler d1 migrations apply --remote`) before any Phase 2 or Phase 4 code that inserts/queries the new columns/table goes live

---
*Phase: 01-foundation*
*Completed: 2026-04-16*
