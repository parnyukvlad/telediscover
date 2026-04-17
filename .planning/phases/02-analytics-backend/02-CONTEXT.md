# Phase 2: Analytics Backend - Context

**Gathered:** 2026-04-16
**Status:** Ready for planning

<domain>
## Phase Boundary

Server infrastructure only — no frontend changes this phase:
1. `POST /api/onlydate/track` endpoint — receives events, validates Telegram initData HMAC, writes to D1 `onlydate_events`, relays to PostHog
2. Scheduled cron — deletes `onlydate_events` rows older than 90 days
3. PostHog EU cloud integration — plain fetch to capture endpoint, fire-and-forget via `ctx.waitUntil`

Phase 3 (frontend) adds the client-side `track()` calls that hit this endpoint. Phase 2 only ships the server.

</domain>

<decisions>
## Implementation Decisions

### PostHog Integration

- **D-01:** PostHog EU cloud free tier — host constant: `https://eu.i.posthog.com`
- **D-02:** Project token stored as Wrangler secret `POSTHOG_API_KEY` (same pattern as `ADMIN_PASSWORD`). Add to `Env` interface and document in `wrangler.toml` as a CLI comment. Actual value: `<see Cloudflare Workers secret — provision with: wrangler secret put POSTHOG_API_KEY>`
- **D-03:** PostHog capture via plain `fetch` to `https://eu.i.posthog.com/capture/` — NO posthog-node SDK (blocks response latency; resolved in STATE.md). Wrap dispatch in `ctx.waitUntil(sendToPostHog(...))`.
- **D-04:** PostHog wizard (`npx @posthog/wizard`) is NOT used — we use direct HTTP calls; the wizard is for full SDK installs into apps, not Workers.
- **D-05:** PostHog `distinctId` = `tg_${user_id}` — prefixed to avoid namespace collision with non-Telegram sources (Pitfall 6).
- **D-06:** Never send PII to PostHog — no `first_name`, `last_name`, `username`, `photo_url`. Only safe property is `language_code` if needed for segmentation (Pitfall 7).
- **D-07:** PostHog event names mirror D1 `event_type` values exactly: `session_start`, `profile_open`, `feed_card_click_chat`, `profile_click_chat`.

### initData HMAC Validation

- **D-08:** HMAC validation is always enforced — no bypass in any environment. For local dev, developers add `BOT_TOKEN` to `.dev.vars` and send real initData from Telegram. No dev-mode escape hatch.
- **D-09:** Key derivation: Mini App scheme — `HMAC-SHA256(data_check_string, HMAC-SHA256("WebAppData", bot_token))`. Do NOT use the Telegram Login Widget scheme (`SHA256(bot_token)`). Implementation template in PITFALLS.md Pitfall 11.
- **D-10:** `auth_date` freshness window: **24 hours** (86400 seconds). Events with `auth_date` older than 24h are rejected with 403.
- **D-11:** Validation failure response: `403 { error: 'Unauthorized' }` — consistent with existing auth failure shape. Log failure with `[OnlyDate] track: initData validation failed` prefix.
- **D-12:** `verifyInitData(initData: string, botToken: string): Promise<boolean>` exported from `src/shared/telegram.ts` — placed alongside existing Telegram utilities.

### Route File

- **D-13:** New `src/routes/analytics.ts` — separate file for the tracking endpoint. Keeps `public.ts` clean; analytics HMAC logic is a distinct enough concern.
- **D-14:** Route path: `POST /api/onlydate/track`
- **D-15:** Request body:
  ```json
  {
    "initData": "<raw initData string from Telegram.WebApp.initData>",
    "event_type": "session_start | profile_open | feed_card_click_chat | profile_click_chat",
    "persona_handle": "<handle or null>",
    "start_param": "<tgWebAppStartParam or null>",
    "utm_source": "<string or null>",
    "utm_medium": "<string or null>",
    "utm_campaign": "<string or null>"
  }
  ```
- **D-16:** Response: `{ ok: true }` on success — consistent with all other write endpoints. `{ error }` with 400/403/500 on failure.
- **D-17:** Event flow inside the handler:
  1. Parse JSON body
  2. Validate required fields (`initData`, `event_type`)
  3. `verifyInitData` → 403 on failure
  4. Extract `user_id` from validated initData
  5. `await c.env.DB.prepare(...).bind(...).run()` — write to D1
  6. `ctx.waitUntil(sendToPostHog(...))` — relay to PostHog (non-blocking)
  7. Return `{ ok: true }`

### TTL Cron

- **D-18:** Cron schedule: `0 0 * * *` (daily at midnight UTC) — added to `wrangler.toml` `[triggers]` section.
- **D-19:** Retention: delete rows where `created_at < Date.now() - 90 * 24 * 60 * 60 * 1000` (90 days in Unix milliseconds — `created_at` stores Unix ms per D-04 in Phase 1 CONTEXT.md).
- **D-20:** Cron handler lives in `src/index.ts` as the `scheduled()` export on the default export object — standard Cloudflare Workers cron pattern alongside the existing HTTP `fetch` handler.

### Env Interface

- **D-21:** Add `POSTHOG_API_KEY: string` to the `Env` interface in `src/index.ts` and `src/routes/analytics.ts`. Document in `wrangler.toml` alongside the `ADMIN_PASSWORD` CLI comment.

### Claude's Discretion

- Exact PostHog capture payload structure — follow PostHog's standard `/capture/` schema (`api_key`, `event`, `distinct_id`, `properties`, `timestamp`)
- Whether `sendToPostHog()` is a local function inside `analytics.ts` or exported from `shared/telegram.ts` — whichever keeps the module boundaries clean
- Error handling for PostHog relay failure — swallowed silently (non-critical; D1 write is the source of truth)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 2 Requirements
- `.planning/ROADMAP.md` §Phase 2 — 5 acceptance conditions (what must be TRUE)
- `.planning/REQUIREMENTS.md` §TRACK — TRACK-01 through TRACK-08

### Schema (from Phase 1)
- `.planning/phases/01-foundation/01-CONTEXT.md` — D-04 through D-08: `onlydate_events` table schema, columns, indexes
- `apps/onlydate-worker/migrations/0005_events.sql` — actual migration (created in Phase 1)

### Pitfalls to avoid
- `.planning/research/PITFALLS.md` Pitfall 1 — initData HMAC validation algorithm
- `.planning/research/PITFALLS.md` Pitfall 4 — start_param capture: read once on session_start, not on every event
- `.planning/research/PITFALLS.md` Pitfall 5 — ctx.waitUntil for PostHog relay
- `.planning/research/PITFALLS.md` Pitfall 6 — tg_ prefix for PostHog distinctId
- `.planning/research/PITFALLS.md` Pitfall 7 — no PII in PostHog
- `.planning/research/PITFALLS.md` Pitfall 8 — D1 table growth, index discipline
- `.planning/research/PITFALLS.md` Pitfall 11 — Mini App HMAC key derivation (NOT Login Widget)
- `.planning/research/PITFALLS.md` Pitfall 14 — bot token freshness

### Existing code patterns
- `apps/onlydate-worker/src/shared/auth.ts` — pattern for extracting shared utility (`verifyInitData` follows same export style)
- `apps/onlydate-worker/src/shared/telegram.ts` — plain fetch pattern; `verifyInitData` added here
- `apps/onlydate-worker/src/routes/public.ts` — Hono route pattern to replicate in analytics.ts
- `apps/onlydate-worker/src/index.ts` — `app.route()` mounting + `Env` interface (add `POSTHOG_API_KEY`)
- `apps/onlydate-worker/wrangler.toml` — secret declaration pattern (CLI comment style)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/shared/telegram.ts` — `tgSend()` plain-fetch pattern reusable for PostHog relay; `verifyInitData()` added to same file
- `src/shared/auth.ts` — `isAdmin()` shows the exported-async-function pattern for shared validators
- `src/index.ts` `Env` interface — extend with `POSTHOG_API_KEY: string`; `BOT_TOKEN` already present (needed by `verifyInitData`)

### Established Patterns
- Route handler: `isAdmin(c)` check → `c.req.json()` try-catch → validation → D1 prepare/bind/run → `{ ok: true }` — replicate in analytics.ts with `verifyInitData` replacing `isAdmin`
- Error shape: `{ error: 'Unauthorized' }` 401 for admin, same `{ error: 'Unauthorized' }` 403 for invalid initData
- Log prefix: `[OnlyDate] <route> error:` — use `[OnlyDate] track:` for analytics route logs
- Secret binding: `c.env.ADMIN_PASSWORD` → `c.env.POSTHOG_API_KEY` same pattern

### Integration Points
- `src/index.ts`: `app.route('/', analyticsRoutes)` — new mount alongside admin/public/webhook
- `wrangler.toml` `[triggers]` section: add cron schedule `0 0 * * *`; add `scheduled()` export in `src/index.ts`
- `wrangler.toml` CLI comment: document `POSTHOG_API_KEY` as secret (same style as `ADMIN_PASSWORD`)

</code_context>

<specifics>
## Specific Ideas

- PostHog EU region: `https://eu.i.posthog.com` — operator has EU cloud account
- PostHog project token: `<see Cloudflare Workers secret — provision with: wrangler secret put POSTHOG_API_KEY>` (store as `POSTHOG_API_KEY` Wrangler secret — do NOT hardcode in source)
- The PostHog wizard install command the operator shared (`npx @posthog/wizard`) is not needed — we use raw HTTP calls

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 02-analytics-backend*
*Context gathered: 2026-04-16*
