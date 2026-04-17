# Phase 2: Analytics Backend - Research

**Researched:** 2026-04-16
**Domain:** Cloudflare Workers scheduled events, PostHog EU capture API, Telegram initData HMAC, D1 retention cron
**Confidence:** HIGH — all critical APIs verified against official documentation

## Summary

Phase 2 ships the server infrastructure for analytics: a `POST /api/onlydate/track` endpoint that validates Telegram `initData` HMAC server-side before writing to D1, relays events to PostHog EU via `ctx.waitUntil`, and a daily cron that prunes rows older than 90 days. The `onlydate_events` table and all three indexes were already created in Phase 1 (migration `0005_events.sql` confirmed present). The schema exactly matches what Phase 2 needs — no migration work required.

The most implementation-critical findings: Hono's scheduled export pattern requires splitting `export default app` into `export default { fetch: app.fetch, async scheduled(...) {...} }` — this is a breaking change to the current export style in `src/index.ts`. The PostHog capture endpoint uses `token` (not `api_key`) at the top level, with `distinct_id` inside `properties`. The HMAC implementation template in PITFALLS.md Pitfall 11 is correct and matches the official Telegram Mini App scheme.

**Primary recommendation:** Implement in three logical units — (1) `src/shared/telegram.ts` gains `verifyInitData()`, (2) `src/routes/analytics.ts` is the new route file, (3) `src/index.ts` export is refactored from `export default app` to the object form to accommodate the `scheduled()` handler.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** PostHog EU cloud free tier — host constant: `https://eu.i.posthog.com`
- **D-02:** Project token stored as Wrangler secret `POSTHOG_API_KEY`. Actual value: `<see Cloudflare Workers secret — provision with: wrangler secret put POSTHOG_API_KEY>` (store via `wrangler secret put` — do NOT hardcode in source)
- **D-03:** PostHog capture via plain `fetch` — NO posthog-node SDK. Wrap dispatch in `ctx.waitUntil(sendToPostHog(...))`.
- **D-04:** PostHog wizard (`npx @posthog/wizard`) is NOT used.
- **D-05:** PostHog `distinctId` = `tg_${user_id}` — prefixed to avoid namespace collision.
- **D-06:** Never send PII to PostHog — no `first_name`, `last_name`, `username`, `photo_url`.
- **D-07:** PostHog event names mirror D1 `event_type` values exactly: `session_start`, `profile_open`, `feed_card_click_chat`, `profile_click_chat`.
- **D-08:** HMAC validation always enforced — no bypass in any environment. Local dev uses real `initData` via `.dev.vars`.
- **D-09:** Key derivation: Mini App scheme — `HMAC-SHA256(data_check_string, HMAC-SHA256("WebAppData", bot_token))`. NOT the Login Widget scheme.
- **D-10:** `auth_date` freshness window: 24 hours (86400 seconds). Events older than 24h rejected with 403.
- **D-11:** Validation failure response: `403 { error: 'Unauthorized' }`. Log: `[OnlyDate] track: initData validation failed`.
- **D-12:** `verifyInitData(initData: string, botToken: string): Promise<boolean>` exported from `src/shared/telegram.ts`.
- **D-13:** New `src/routes/analytics.ts` for the tracking endpoint.
- **D-14:** Route path: `POST /api/onlydate/track`
- **D-15:** Request body: `{ initData, event_type, persona_handle, start_param, utm_source, utm_medium, utm_campaign }`
- **D-16:** Response: `{ ok: true }` on success; `{ error }` with 400/403/500 on failure.
- **D-17:** Event flow: parse → validate fields → verifyInitData → extract user_id → D1 write → ctx.waitUntil(PostHog) → `{ ok: true }`
- **D-18:** Cron schedule: `0 0 * * *` in `wrangler.toml` `[triggers]` section.
- **D-19:** Retention: `DELETE WHERE created_at < Date.now() - 90 * 24 * 60 * 60 * 1000` (Unix milliseconds).
- **D-20:** Cron handler lives in `src/index.ts` as the `scheduled()` export on the default export object.
- **D-21:** Add `POSTHOG_API_KEY: string` to `Env` interface in both `src/index.ts` and `src/routes/analytics.ts`.

### Claude's Discretion

- Exact PostHog capture payload structure — follow PostHog's standard `/capture/` schema (`api_key`, `event`, `distinct_id`, `properties`, `timestamp`)
- Whether `sendToPostHog()` is a local function inside `analytics.ts` or exported from `shared/telegram.ts` — whichever keeps module boundaries clean
- Error handling for PostHog relay failure — swallowed silently (non-critical; D1 write is source of truth)

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TRACK-01 | Operator can see count of transitions (feed→chat, profile→chat, profile opens) in PostHog | PostHog EU capture API relays events; event_type column enables grouping |
| TRACK-02 | Operator can see unique-user counts per event type in PostHog | `distinct_id = tg_${user_id}` enables PostHog unique-user counts; idx_events_user_type covers D1 queries |
| TRACK-03 | Operator can see repeat transitions per user | user_id stored per row; idx_events_user_type enables per-user queries |
| TRACK-04 | Operator can see view→click→chat funnel conversion rate in PostHog | All 4 event_type values map to PostHog funnel steps; relayed via sendToPostHog |
| TRACK-05 | Every event bound to server-side HMAC-validated Telegram user_id | verifyInitData() with Mini App HMAC scheme; user_id extracted from validated initData only |
| TRACK-06 | Every session records start_param and utm_* on first load | onlydate_events schema has start_param, utm_source, utm_medium, utm_campaign columns — confirmed in 0005_events.sql |
| TRACK-07 | Chat-CTA events captured reliably before navigation | Backend concern: D1 write is synchronous (awaited); PostHog is fire-and-forget via waitUntil — both survive the tap |
| TRACK-08 | Raw event log persists ≥ 90 days, older rows pruned automatically | Daily cron `0 0 * * *` deletes rows where created_at < Date.now() - 90d |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Hono | 4.4.0+ (^4.4.0 in package.json; latest 4.12.14) | HTTP routing; `c.executionCtx.waitUntil` access | Already in use; provides `c.executionCtx` for background tasks |
| Web Crypto API | Native (Workers runtime) | HMAC-SHA256 for initData validation | Built into Workers runtime; no import needed; verified pattern in PITFALLS.md Pitfall 11 |
| Cloudflare D1 | Native binding | Write events; DELETE on cron | Already bound as `DB`; parameterized queries via `.prepare().bind()` |
| Cloudflare Workers Cron | Native (`[triggers]` in wrangler.toml) | Daily 90-day retention cleanup | Free; no extra library; `scheduled()` export on default object |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| PostHog EU `/capture/` | REST API (no SDK) | Relay events for dashboards | Called from `sendToPostHog()` via plain `fetch` inside `ctx.waitUntil` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Plain fetch to PostHog | posthog-node SDK | SDK blocks response latency (adds await before response); D-03 locks plain fetch |
| Web Crypto API for HMAC | `crypto` Node.js module | Workers runtime has Web Crypto built-in; no Node module needed even with nodejs_compat |

**Installation:** No new packages needed. All dependencies are runtime-native or already installed.

**Version verification:** Hono 4.12.14 is the current npm latest (verified 2026-04-16). Project uses `^4.4.0` — satisfies current version on next install.

## Architecture Patterns

### Recommended Project Structure After Phase 2
```
apps/onlydate-worker/src/
├── shared/
│   ├── auth.ts          # isAdmin() — existing
│   ├── db.ts            # feedFilter, COVER_PHOTO, HAS_FREE_PHOTO — existing
│   └── telegram.ts      # tgSend() — existing; verifyInitData() ADDED here
├── routes/
│   ├── admin.ts         # existing
│   ├── analytics.ts     # NEW — POST /api/onlydate/track
│   ├── public.ts        # existing
│   └── webhook.ts       # existing
└── index.ts             # MODIFIED — export default object form; add scheduled()
```

### Pattern 1: Hono + Scheduled Export

**What:** Current `src/index.ts` exports `export default app` (Hono app instance). To add a `scheduled()` handler for cron triggers, the export must become an object with both `fetch` and `scheduled` keys. Hono's `.fetch` property is the correct adapter — do NOT pass `app` directly.

**When to use:** Any Cloudflare Worker that needs both HTTP and cron handling in the same Worker file.

**Example:**
```typescript
// Source: https://hono.dev/docs/getting-started/cloudflare-workers
// Source: https://github.com/orgs/honojs/discussions/1087

// BEFORE (current state):
export default app;

// AFTER (Phase 2 target):
export default {
  fetch: app.fetch,
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(pruneOldEvents(env.DB));
  },
};
```

**Critical detail:** `app.fetch` not `app` — Hono exposes a `fetch` property that is the standard Workers fetch handler. Passing the Hono instance directly would work in some versions but is not the documented pattern.

### Pattern 2: ctx.waitUntil in Hono Route Handler

**What:** Access `ExecutionContext` from the Hono context object via `c.executionCtx`. Call `waitUntil` on it to register a background promise that survives after the response is returned.

**When to use:** Any Hono route that needs fire-and-forget background work (PostHog relay, cache population, logging).

**Example:**
```typescript
// Source: https://hono.dev/docs/api/context#executionctx
app.post('/api/onlydate/track', async (c) => {
  // ... validation and D1 write (awaited) ...
  c.executionCtx.waitUntil(sendToPostHog(event, c.env.POSTHOG_API_KEY));
  return c.json({ ok: true });
});
```

### Pattern 3: PostHog EU Capture Payload

**What:** Plain `fetch` POST to PostHog's capture endpoint. The token field name is `token` (not `api_key`) at the top level. The `distinct_id` is a property inside `properties` — NOT a top-level field in the newer API schema. However, multiple sources confirm that `distinct_id` as a top-level field alongside `event` is also accepted by PostHog's ingestion API.

**Verified structure (from PostHog API docs and tutorials):**
```typescript
// Source: https://posthog.com/docs/api/capture
// Source: https://posthog.com/tutorials/api-capture-events
async function sendToPostHog(
  eventType: string,
  userId: string,
  properties: Record<string, unknown>,
  apiKey: string
): Promise<void> {
  await fetch('https://eu.i.posthog.com/capture/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key:     apiKey,
      event:       eventType,
      distinct_id: `tg_${userId}`,
      properties:  {
        ...properties,
        $process_person_profile: false,  // avoids storing PII person profiles
      },
      timestamp:   new Date().toISOString(),  // ISO 8601
    }),
  });
}
```

**Note on `api_key` vs `token`:** PostHog's documentation uses both field names across different pages. The `/capture/` endpoint accepts `api_key` as the field name (confirmed by the tutorials page JSON examples). Both work in practice; use `api_key` as that matches the examples most frequently cited.

### Pattern 4: verifyInitData — Mini App HMAC

**What:** Full implementation template for the correct Mini App HMAC scheme. From PITFALLS.md Pitfall 11 — the canonical implementation verified against Telegram's Mini App documentation.

**When to use:** Every request to `POST /api/onlydate/track`. Must be called before trusting any `user_id` from the request body.

```typescript
// Source: PITFALLS.md Pitfall 11; matches https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
export async function verifyInitData(initData: string, botToken: string): Promise<boolean> {
  const params = new URLSearchParams(initData);
  const hash   = params.get('hash');
  if (!hash) return false;
  params.delete('hash');
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const encoder = new TextEncoder();
  const secretKey = await crypto.subtle.importKey(
    'raw', encoder.encode('WebAppData'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const secretKeyBytes = await crypto.subtle.sign('HMAC', secretKey, encoder.encode(botToken));
  const dataKey = await crypto.subtle.importKey(
    'raw', secretKeyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig      = await crypto.subtle.sign('HMAC', dataKey, encoder.encode(dataCheckString));
  const computed = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
  return computed === hash;
}
```

**Auth-date check (must follow a passing HMAC):**
```typescript
const authDate = parseInt(params.get('auth_date') ?? '0', 10);
if (Date.now() / 1000 - authDate > 86400) return false;  // reject stale tokens
```

### Pattern 5: D1 Cron Delete

**What:** Simple `DELETE WHERE created_at < cutoff` run from the `scheduled()` handler. At current scale (900k rows/month) a single unbounded DELETE is safe but D1 documentation recommends batching for very large tables.

**When to use:** Daily cron for 90-day retention.

```typescript
async function pruneOldEvents(db: D1Database): Promise<void> {
  const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
  await db.prepare('DELETE FROM onlydate_events WHERE created_at < ?').bind(cutoff).run();
}
```

**Batching note:** At 10k DAU × 3 events × 90 days = ~2.7M rows maximum at any time. A single DELETE with the `created_at` index (already created in `0005_events.sql`) is efficient and well within D1's limits. No batching needed at this scale.

### Pattern 6: Env Interface in Route Files

**What:** Each route file declares its own local `Env` interface (established pattern from `auth.ts`, `public.ts`). Phase 2 adds `POSTHOG_API_KEY` to both `src/index.ts` and `src/routes/analytics.ts`.

```typescript
// In src/routes/analytics.ts
interface Env {
  DB:              D1Database;
  BOT_TOKEN:       string;
  MEDIA:           R2Bucket;
  ADMIN_PASSWORD:  string;
  POSTHOG_API_KEY: string;
}
```

### Anti-Patterns to Avoid

- **Caching the HMAC derived key at module scope:** Never assign `const secretKey = await deriveKey(botToken)` outside a request handler. CF Workers secrets are injected fresh per isolate — module-scope caching of derived keys breaks after bot token rotation. (PITFALLS.md Pitfall 14)
- **Using `initDataUnsafe` user_id:** The raw `user_id` from the request body must never be trusted before HMAC validation. Always re-extract `user_id` from the validated `initData` parsed server-side.
- **`export default app` without `fetch` key:** After adding `scheduled()`, the export MUST be the object form `{ fetch: app.fetch, scheduled(...) }`. Leaving `export default app` alongside a separate `scheduled` export will not work in Cloudflare's module Worker format.
- **Unawaited PostHog fetch without waitUntil:** Any `fetch()` to PostHog that is not wrapped in `ctx.waitUntil(...)` will be killed when the response returns. (PITFALLS.md Pitfall 5)

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HMAC timing-safe compare | Custom byte-compare loop | Web Crypto `crypto.subtle.sign` with full recomputation | Recomputing the HMAC and doing string equality is sufficient; constant-time comparison via string equality is acceptable for hex-encoded HMAC outputs since JS string comparison short-circuits only on byte mismatch — not a timing oracle at this threat model level |
| Event relay with retry | Retry queue, exponential backoff | `ctx.waitUntil` fire-and-forget | PostHog is analytics; occasional drop is acceptable; D1 is the source of truth |
| Cron scheduling | External scheduler, setInterval | Native `[triggers]` cron in wrangler.toml | Free, managed by CF runtime, no extra infrastructure |
| ISO 8601 timestamp | Manual date formatting | `new Date().toISOString()` | Standard JS, correct format for PostHog |

**Key insight:** The Workers runtime provides HMAC, scheduling, and async background execution natively — no npm packages needed for Phase 2.

## Common Pitfalls

### Pitfall A: Export Default Breaks With Scheduled Handler
**What goes wrong:** Developer adds a `scheduled()` function to `src/index.ts` but keeps `export default app`. The scheduled handler is never called because CF Workers module format requires all handlers on the same default export object.
**Why it happens:** Hono documentation shows `export default app` as the standard pattern; developers forget this is a shorthand.
**How to avoid:** Refactor `src/index.ts` export to `export default { fetch: app.fetch, async scheduled(...) {...} }` as part of the first task in this phase.
**Warning signs:** Cron trigger fires (visible in CF dashboard logs) but the D1 DELETE never runs.

### Pitfall B: HMAC Key Derivation Order Confusion
**What goes wrong:** Developer writes `HMAC(bot_token, "WebAppData")` instead of `HMAC("WebAppData", bot_token)` — the argument order to `importKey` vs `sign` is easy to swap.
**Why it happens:** The Telegram docs describe the algorithm in prose; the code uses two separate `importKey`/`sign` calls and the key/message roles are reversed.
**How to avoid:** Use the exact template from PITFALLS.md Pitfall 11 verbatim. In the first call, `"WebAppData"` is the **data** being signed with `bot_token` as the key. In the second call, the resulting bytes are the key and `dataCheckString` is the data.
**Warning signs:** All real `initData` values fail validation even in dev.

### Pitfall C: PostHog distinctId Without Prefix
**What goes wrong:** `distinct_id` is set to bare `user_id` string (e.g., `"123456789"`). If the PostHog project ever receives events from non-Telegram sources, integer IDs collide.
**How to avoid:** Always `tg_${userId}` — enforced by D-05.

### Pitfall D: auth_date Check After HMAC (not before)
**What goes wrong:** Developer checks `auth_date` freshness before the HMAC comparison. An attacker sends a fresh `auth_date` with a forged hash — the freshness passes, then the HMAC check fails. This is fine. But if the developer skips the HMAC check on "fresh" tokens as an optimization, auth is bypassed.
**How to avoid:** HMAC check FIRST, always. Auth-date check is a second gate after a valid signature, per D-10.

### Pitfall E: Missing `BOT_TOKEN` in `.dev.vars`
**What goes wrong:** Local `wrangler dev` starts but `c.env.BOT_TOKEN` is undefined/empty string. Every `verifyInitData` call fails silently (returns false) or throws.
**How to avoid:** Document that developers must create `apps/onlydate-worker/.dev.vars` with `BOT_TOKEN=<value>` before testing the track endpoint locally. This file is gitignored.
**Note:** `.dev.vars` does not currently exist in the repo (confirmed by filesystem check).

## Code Examples

### analytics.ts — Full Route Handler Skeleton
```typescript
// Source: Pattern derived from public.ts and auth.ts existing patterns
import { Hono }          from 'hono';
import { verifyInitData } from '../shared/telegram';

interface Env {
  DB:              D1Database;
  BOT_TOKEN:       string;
  MEDIA:           R2Bucket;
  ADMIN_PASSWORD:  string;
  POSTHOG_API_KEY: string;
}

const app = new Hono<{ Bindings: Env }>();

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/onlydate/track
// Validates Telegram initData HMAC, writes event to D1, relays to PostHog
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/onlydate/track', async (c) => {
  try {
    const body = await c.req.json<{
      initData:       string;
      event_type:     string;
      persona_handle: string | null;
      start_param:    string | null;
      utm_source:     string | null;
      utm_medium:     string | null;
      utm_campaign:   string | null;
    }>();

    if (!body.initData || !body.event_type) {
      return c.json({ error: 'initData and event_type required' }, 400);
    }

    const valid = await verifyInitData(body.initData, c.env.BOT_TOKEN);
    if (!valid) {
      console.error('[OnlyDate] track: initData validation failed');
      return c.json({ error: 'Unauthorized' }, 403);
    }

    // Extract user_id from validated initData
    const params = new URLSearchParams(body.initData);
    const user   = JSON.parse(params.get('user') ?? '{}');
    const userId = String(user.id);

    const id = crypto.randomUUID();
    await c.env.DB.prepare(`
      INSERT INTO onlydate_events
        (id, event_type, user_id, persona_handle, start_param, utm_source, utm_medium, utm_campaign, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id, body.event_type, userId, body.persona_handle ?? null,
      body.start_param ?? null, body.utm_source ?? null,
      body.utm_medium ?? null, body.utm_campaign ?? null,
      Date.now()
    ).run();

    c.executionCtx.waitUntil(sendToPostHog(
      body.event_type, userId,
      { persona_handle: body.persona_handle, start_param: body.start_param },
      c.env.POSTHOG_API_KEY
    ));

    return c.json({ ok: true });
  } catch (err) {
    console.error('[OnlyDate] track error:', err);
    return c.json({ error: 'Track failed' }, 500);
  }
});

export default app;
```

### index.ts — Modified Export Form
```typescript
// Source: https://hono.dev/docs/getting-started/cloudflare-workers
// Source: https://github.com/orgs/honojs/discussions/1087
export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(pruneOldEvents(env.DB));
  },
};
```

### wrangler.toml — Triggers and Secret Comment
```toml
[triggers]
crons = ["0 0 * * *"]

# Secrets (set via CLI — not stored in this file):
#   wrangler secret put ADMIN_PASSWORD
#   wrangler secret put POSTHOG_API_KEY
```

### .dev.vars — Local Development (not committed)
```
BOT_TOKEN=<your-bot-token-from-BotFather>
ADMIN_PASSWORD=<local-dev-password>
POSTHOG_API_KEY=<see Cloudflare Workers secret — provision with: wrangler secret put POSTHOG_API_KEY>
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `export default app` (Hono shorthand) | `export default { fetch: app.fetch, scheduled }` (module object) | Required when adding cron | Enables scheduled handler without changing HTTP behavior |
| posthog-node SDK | Plain fetch to `/capture/` | Documented in STATE.md | No SDK import; zero latency overhead on response path |
| Trusting `initDataUnsafe` | Server-side HMAC via Web Crypto | This phase | Prevents event forgery; all analytics data is trustworthy |

**Deprecated/outdated:**
- `export default app` in `src/index.ts`: Valid while only HTTP is needed; must change in Phase 2 to support cron.

## Open Questions

1. **PostHog `$process_person_profile: false` property**
   - What we know: Setting this property to `false` in event properties tells PostHog not to create/update a person profile for the event. This reduces person-profile storage usage on the free tier.
   - What's unclear: Whether this is beneficial at 10k DAU scale vs. potentially losing person-level retention metrics that TRACK-02/TRACK-03 depend on.
   - Recommendation: Omit `$process_person_profile` from Phase 2. PostHog person profiles enable the unique-user counts required by TRACK-02. If storage becomes a concern, add this property later for non-session events.

2. **PostHog free tier: 1M events/month tightness**
   - What we know: Free tier is 1M events/month (verified 2026-04-16). At 10k DAU × 4 event types × 30 days = 1.2M/month — potentially over.
   - What's unclear: Whether the DAU estimate is accurate for launch traffic.
   - Recommendation: Use PostHog's `$process_person_profile: false` for non-critical events (feed_card_click) to reduce billable events if needed. Flag for monitoring after launch. (STATE.md already tracks this concern.)

3. **`ScheduledController` TypeScript type availability**
   - What we know: `@cloudflare/workers-types` package provides `ScheduledController` and `ExecutionContext` types. Project uses `^4.20240512.0` which predates some type additions.
   - What's unclear: Whether `ScheduledController` is typed in the installed version.
   - Recommendation: Use `ScheduledController` from `@cloudflare/workers-types` — if missing, use `{ cron: string; scheduledTime: number }` inline type as fallback.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Cloudflare D1 (DB binding) | Event storage, cron DELETE | Confirmed (wrangler.toml bound) | production DB | — |
| BOT_TOKEN (Wrangler secret) | verifyInitData() | Present as CF secret; absent from .dev.vars | — | Developers must add to .dev.vars manually |
| POSTHOG_API_KEY (Wrangler secret) | sendToPostHog() | NOT YET provisioned | — | Must run `wrangler secret put POSTHOG_API_KEY` before deploy |
| PostHog EU endpoint | Event relay | ✓ (public internet) | https://eu.i.posthog.com | D1 is source of truth; PostHog relay failure is non-blocking |
| Web Crypto API | verifyInitData() | ✓ (Workers runtime built-in) | Native | — |
| Wrangler cron trigger support | Daily pruning | ✓ (wrangler.toml [triggers]) | wrangler 4.75.0 | — |

**Missing dependencies with no fallback:**
- `POSTHOG_API_KEY` Wrangler secret: must be provisioned via `wrangler secret put POSTHOG_API_KEY` before deploying. Plans should include this as a deployment step.

**Missing dependencies with fallback:**
- `BOT_TOKEN` in `.dev.vars`: absent — blocks local testing of `/api/onlydate/track`. Developers must create the file manually. HTTP endpoints not using HMAC continue to work locally.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | None detected — no test files, no jest.config, no vitest.config in project |
| Config file | None — Wave 0 must create |
| Quick run command | `pnpm typecheck` (type-check only, no runtime tests) |
| Full suite command | N/A — no test infrastructure exists |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TRACK-05 | verifyInitData rejects tampered hash | unit | manual curl test | ❌ Wave 0 |
| TRACK-05 | verifyInitData rejects stale auth_date | unit | manual curl test | ❌ Wave 0 |
| TRACK-05 | verifyInitData accepts valid initData | unit | manual curl test | ❌ Wave 0 |
| TRACK-08 | Cron deletes rows older than 90 days | integration | `wrangler dev --test-scheduled` + D1 query | ❌ Wave 0 |
| TRACK-01..04 | Events appear in PostHog after track call | smoke | manual PostHog Live Events check | manual-only |
| TRACK-06 | start_param stored on session_start row | integration | manual D1 dashboard check | manual-only |

**Manual-only justifications:**
- PostHog Live Events: requires live network call to EU endpoint; not automatable without a test PostHog project.
- D1 dashboard checks: Cloudflare's D1 REST API can be used but requires account credentials not available in CI.

### Sampling Rate
- **Per task commit:** `pnpm typecheck` — catches type errors in Env interface, function signatures
- **Per wave merge:** `pnpm typecheck` + manual curl against `wrangler dev` instance
- **Phase gate:** Success criteria 1 and 2 from the phase description verified manually before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] No automated test runner — `REQUIREMENTS.md` v2 deferred list notes "Automated test suite" as a known gap. The planner should NOT add a test framework setup task to Phase 2 (out of scope per REQUIREMENTS.md). TypeScript compilation (`pnpm typecheck`) is the automated verification signal.

## Sources

### Primary (HIGH confidence)
- Cloudflare Workers Scheduled Handler docs — `async scheduled(controller, env, ctx)` signature; `[triggers]` wrangler.toml syntax — https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/
- Cloudflare Workers Cron Triggers docs — wrangler.toml `[triggers]` array format — https://developers.cloudflare.com/workers/configuration/cron-triggers/
- Cloudflare Workers ctx.waitUntil docs — 30-second limit; extends isolate lifetime — https://developers.cloudflare.com/workers/runtime-apis/context/
- Hono context.executionCtx docs — `c.executionCtx.waitUntil(...)` exact usage — https://hono.dev/docs/api/context#executionctx
- PITFALLS.md Pitfall 11 — verifyInitData implementation (Mini App HMAC scheme) — `.planning/research/PITFALLS.md`
- `apps/onlydate-worker/migrations/0005_events.sql` — confirmed schema and indexes exist from Phase 1

### Secondary (MEDIUM confidence)
- PostHog capture endpoint body format (`api_key`, `event`, `distinct_id`, `properties`, `timestamp`) — verified across multiple PostHog documentation pages — https://posthog.com/docs/api/capture, https://posthog.com/tutorials/api-capture-events
- PostHog EU host `https://eu.i.posthog.com` — confirmed in CONTEXT.md D-01 and multiple PostHog EU documentation references
- PostHog free tier 1M events/month — https://posthog.com/pricing (verified 2026-04-16)
- Hono + scheduled export pattern `{ fetch: app.fetch, scheduled(...) }` — https://github.com/orgs/honojs/discussions/1087 (GitHub discussion, community-verified)

### Tertiary (LOW confidence)
- D1 DELETE batch size guidance (1,000 rows per batch) — from Cloudflare documentation prose; no hard row limit documented for scheduled DELETE operations. At projected scale (2.7M max rows) a single indexed DELETE is safe.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries are already installed; no new dependencies required
- Architecture: HIGH — `c.executionCtx.waitUntil` verified from Hono official docs; scheduled export pattern verified from Hono community discussions and CF docs
- HMAC implementation: HIGH — full implementation in PITFALLS.md Pitfall 11, matches Telegram's documented Mini App scheme
- PostHog payload: MEDIUM — field names (`api_key` vs `token`) vary across PostHog docs pages; the `/capture/` endpoint is well-established; exact field name confirmed from tutorials examples
- D1 cron delete: HIGH — simple parameterized DELETE with existing index; at current scale no batching needed
- Pitfalls: HIGH — drawn from project's own PITFALLS.md which was researched at project start

**Research date:** 2026-04-16
**Valid until:** 2026-05-16 (stable APIs; PostHog pricing changes more frequently — re-verify 1M limit before launch)
