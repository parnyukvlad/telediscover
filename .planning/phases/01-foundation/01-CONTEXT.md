# Phase 1: Foundation - Context

**Gathered:** 2026-04-16
**Status:** Ready for planning

<domain>
## Phase Boundary

Three structural changes that unblock all later phases:
1. Schema migrations — add `sort_order` + `is_promoted` to `onlydate_feed_entries`; create `onlydate_events` table
2. Router modularization — split `apps/onlydate-worker/src/index.ts` (733 lines) into `routes/` + `shared/` files with no functional change
3. Admin credential rotation — remove hardcoded `ADMIN_PASSWORD` string literal; read from `c.env.ADMIN_PASSWORD` (Wrangler secret)

No user-facing changes in this phase.

</domain>

<decisions>
## Implementation Decisions

### D1 Migrations

- **D-01:** Two migration files, one logical concern each:
  - `0004_feed_entry_ordering.sql` — adds `sort_order INTEGER` and `is_promoted INTEGER NOT NULL DEFAULT 0` to `onlydate_feed_entries`
  - `0005_events.sql` — creates `onlydate_events` table with indexes
- **D-02:** Existing `onlydate_feed_entries` rows get `sort_order` populated sequentially by `created_at` via an `UPDATE` in the migration (1, 2, 3…). This gives the admin a sensible drag-drop starting point rather than all rows tied at 0 or NULL.
- **D-03:** `is_promoted` defaults to `0` for all existing and new rows.

### `onlydate_events` Table Schema

- **D-04:** Columns:
  ```sql
  CREATE TABLE IF NOT EXISTS onlydate_events (
    id             TEXT    PRIMARY KEY,
    event_type     TEXT    NOT NULL,
    user_id        TEXT    NOT NULL,
    persona_handle TEXT,
    start_param    TEXT,
    utm_source     TEXT,
    utm_medium     TEXT,
    utm_campaign   TEXT,
    created_at     INTEGER NOT NULL
  );
  ```
- **D-05:** Three indexes:
  - `(user_id, event_type)` — per-user event queries (TRACK-02, TRACK-03)
  - `(created_at)` — 90-day TTL cron pruning (TRACK-08)
  - `(event_type)` — funnel aggregation (TRACK-01, TRACK-04)
- **D-06:** `user_id` stores the Telegram user ID as TEXT (not INTEGER) — consistent with how Telegram IDs are handled across the codebase; avoids integer overflow edge cases.
- **D-07:** `persona_handle` captures the model the event relates to (nullable — not all events are model-specific, e.g. `session_start`).
- **D-08:** Attribution columns (`start_param`, `utm_source`, `utm_medium`, `utm_campaign`) are nullable; only `session_start` events populate them. Phase 2 defines which events populate which columns.

### Router Modularization

- **D-09:** Target file structure:
  ```
  apps/onlydate-worker/src/
  ├── index.ts              # Thin assembly: Hono app, CORS middleware, route mounts, export default
  ├── routes/
  │   ├── admin.ts          # All POST + GET /api/onlydate/admin/* endpoints
  │   ├── public.ts         # GET /, GET /media/*, GET /api/onlydate/models, GET /api/onlydate/models/:username
  │   └── webhook.ts        # POST /webhook/onlydate
  └── shared/
      ├── auth.ts           # isAdmin() — reads from c.env.ADMIN_PASSWORD
      ├── db.ts             # COVER_PHOTO SQL fragment, HAS_FREE_PHOTO, feedFilter()
      └── telegram.ts       # tgSend(), MEDIA_BASE, MINIAPP_URL
  ```
- **D-10:** `index.ts` mounts each route file as a Hono sub-app or uses `app.route()`. No logic lives in `index.ts` beyond middleware and mounting.
- **D-11:** Zero functional change — all existing routes respond identically before and after the split. No route renames, no response shape changes.

### Admin Credential Rotation

- **D-12:** Add `ADMIN_PASSWORD: string` to the `Env` interface in `index.ts`.
- **D-13:** Remove the `const ADMIN_PASSWORD = '...'` literal from source entirely.
- **D-14:** `isAdmin()` in `shared/auth.ts` reads `c.env.ADMIN_PASSWORD` — signature stays compatible with all existing call sites.
- **D-15:** The Wrangler secret name is `ADMIN_PASSWORD` (matches `c.env.ADMIN_PASSWORD`).
- **D-16:** The admin frontend (`apps/onlydate/photochoose/index.html`) continues to send the raw password via `X-Admin-Password` header and stores it in `sessionStorage`. That is a known debt (CONCERNS.md [HIGH]) but is explicitly out of scope for Phase 1 — do not change frontend auth behavior.

### Claude's Discretion

- Exact Hono `app.route()` vs sub-app mounting pattern — pick whichever keeps `index.ts` cleanest
- Internal `db.ts` SQL fragment exports — named exports, not a class; match existing pattern
- Migration idempotency (`IF NOT EXISTS`, `IF NOT EXISTS` on indexes) — apply where SQLite supports it

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing Schema
- `apps/onlydate-worker/migrations/0002_feed_entries.sql` — current `onlydate_feed_entries` schema (columns being extended)
- `apps/onlydate-worker/migrations/0003_feed_photos.sql` — `onlydate_feed_photos` schema (reference for migration style)

### Codebase Health
- `.planning/codebase/CONCERNS.md` — [CRITICAL] hardcoded password section; [HIGH] sessionStorage password (do not worsen)
- `.planning/codebase/ARCHITECTURE.md` — Anti-Pattern 5 (monolithic index.ts) being addressed here
- `.planning/research/PITFALLS.md` — Pitfall 2 (credential exposure widened by new admin endpoints)

### Phase Downstream Dependencies
- `.planning/ROADMAP.md` §Phase 1 Success Criteria — the four acceptance conditions the planner must verify
- `.planning/ROADMAP.md` §Phase 2 — consumer of `onlydate_events` schema created here; schema must align with TRACK-01–08

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `Env` interface (`index.ts:3-7`) — extend with `ADMIN_PASSWORD: string`; already has `DB`, `BOT_TOKEN`, `MEDIA`
- `isAdmin()` function (`index.ts:16-18`) — move to `shared/auth.ts`; update to use `c.env.ADMIN_PASSWORD`
- `feedFilter()` function (`index.ts:190-194`) — move to `shared/db.ts` unchanged
- `COVER_PHOTO` + `HAS_FREE_PHOTO` SQL fragments (`index.ts:201-241`) — move to `shared/db.ts` as named exports
- `tgSend()` helper (`index.ts:694-702`) — move to `shared/telegram.ts`

### Established Patterns
- Route handler pattern: `if (!isAdmin(c)) return c.json({ error: 'Unauthorized' }, 401);` → `try/catch` → D1 prepare/bind → `{ ok: true }` or `{ error }` — preserve in route files
- Migration style: `CREATE TABLE IF NOT EXISTS`, snake_case columns, `INTEGER NOT NULL DEFAULT n` for booleans
- Migration naming: `NNNN_description.sql` (4-digit zero-padded)

### Integration Points
- `index.ts` `export default app` — must remain; Cloudflare Workers requires a default export
- `wrangler.toml` — needs `ADMIN_PASSWORD` added as a secret binding declaration (planner must note this; actual secret value provisioned via `wrangler secret put`)

</code_context>

<specifics>
## Specific Ideas

- No specific UI/UX requirements — this phase has no user-facing changes
- The phrase "no functional change" in Success Criteria 3 is the constraint that governs the entire refactor

</specifics>

<deferred>
## Deferred Ideas

- Fix admin `sessionStorage` password storage (CONCERNS.md [HIGH]) — out of scope per D-16; address in a future security-focused phase
- Add FK constraint on `onlydate_feed_photos.feed_entry_id` — noted in CONCERNS.md [MEDIUM]; not touched here to keep migrations minimal
- Fix wildcard CORS to restrict admin endpoints — CONCERNS.md [HIGH]; not in scope for Phase 1

</deferred>

---

*Phase: 01-foundation*
*Context gathered: 2026-04-16*
