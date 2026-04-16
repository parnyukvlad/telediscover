# Architecture Patterns

**Domain:** Telegram Mini App — analytics ingestion, admin tooling, feed ordering
**Researched:** 2026-04-16
**Confidence:** HIGH (grounded in existing codebase + Cloudflare/D1/PostHog well-documented behaviour)

---

## Existing Architecture Baseline

The current system is a three-tier deployment on Cloudflare:

```
[Telegram client]
      |
      | opens Mini App
      v
[Cloudflare Pages]          apps/onlydate/index.html          (static, no build)
[Cloudflare Pages]          apps/onlydate/photochoose/index.html
      |
      | HTTP (JSON REST)
      v
[Cloudflare Worker]         apps/onlydate-worker/src/index.ts  (Hono, single file, 733 lines)
      |             \
      | D1 queries   \ R2 object fetches
      v               v
[D1 SQLite]         [R2 bucket: onlydate]
telegram-saas-db
```

This milestone adds analytics, drag-drop ordering, promotion toggle, desktop layout, and chat CTA. No new deployment targets — all additions land inside the existing three tiers.

---

## Recommended Architecture

### Component Boundaries (post-milestone)

```
┌─────────────────────────────────────────────────────────────────┐
│  FRONTEND  (Cloudflare Pages — static HTML + vanilla JS)        │
│                                                                 │
│  ┌──────────────────────┐   ┌──────────────────────────────┐   │
│  │  index.html          │   │  photochoose/index.html      │   │
│  │  (public Mini App)   │   │  (admin panel)               │   │
│  │                      │   │                              │   │
│  │  - CSS 9:16 layout   │   │  - drag-drop reorder         │   │
│  │  - feed grid         │   │  - promotion toggle          │   │
│  │  - profile view      │   │  - edit name/handle/cover    │   │
│  │  - chat CTA buttons  │   │  - hide / soft-delete        │   │
│  │  - track() helper    │   │  - existing photo mgmt       │   │
│  └──────────┬───────────┘   └──────────────┬───────────────┘   │
│             │ /api/onlydate/*               │ /api/onlydate/    │
│             │                               │ admin/*           │
└─────────────┼───────────────────────────────┼───────────────────┘
              │                               │
              ▼                               ▼
┌─────────────────────────────────────────────────────────────────┐
│  WORKER  (Hono — apps/onlydate-worker/src/index.ts)             │
│                                                                 │
│  routes/                                                        │
│  ├── feed.ts      GET /api/onlydate/models (UNION query)        │
│  ├── profile.ts   GET /api/onlydate/models/:username            │
│  ├── tracking.ts  POST /api/onlydate/track  ◄── NEW             │
│  ├── admin/                                                     │
│  │   ├── personas.ts  (existing: CRUD, visibility)             │
│  │   ├── photos.ts    (existing: upload, toggle, cover)        │
│  │   ├── ordering.ts  POST /api/onlydate/admin/reorder  ◄─ NEW │
│  │   └── promotion.ts POST /api/onlydate/admin/promote  ◄─ NEW │
│  ├── media.ts     GET /media/*                                  │
│  └── webhook.ts   POST /webhook/onlydate                        │
│                                                                 │
│  shared/                                                        │
│  ├── auth.ts      isAdmin()                                     │
│  ├── feed.ts      feedFilter(), getFeedMode()                   │
│  └── posthog.ts   forwardToPostHog()  ◄── NEW                  │
└──────────────────────┬──────────────────────────────────────────┘
                       │
           ┌───────────┴────────────┐
           ▼                        ▼
┌──────────────────┐    ┌───────────────────────┐
│  D1 (SQLite)     │    │  R2 (onlydate bucket) │
│                  │    │                       │
│  existing tables │    │  feed-entries/**      │
│  + NEW:          │    │  (unchanged)          │
│  onlydate_events │    └───────────────────────┘
│                  │
│  + schema changes│
│  to feed_entries:│
│  sort_order INT  │
│  is_promoted INT │
└──────────────────┘
           |
           | ctx.waitUntil (fire-and-forget)
           ▼
┌──────────────────────┐
│  PostHog (external)  │
│  POST /capture       │
│  (self-hosted or     │
│   cloud free tier)   │
└──────────────────────┘
```

---

## Data Flow: Analytics Ingestion

### Decision: Worker-proxied tracking (recommended)

```
[Client]
   |
   | 1. POST /api/onlydate/track
   |    { event, distinct_id, properties }
   v
[Worker — tracking.ts]
   |
   | 2a. D1 insert (synchronous, in-request)
   |     INSERT INTO onlydate_events ...
   |
   | 2b. ctx.waitUntil(forwardToPostHog(...))
   |     (async, does NOT block response)
   v
[Client receives { ok: true }]   ← response returned immediately after D1 write

(background)
   v
[PostHog /capture endpoint]
   POST with API key + event payload
```

**Why proxy, not direct client-to-PostHog:**

| Concern | Direct client | Worker proxy |
|---------|--------------|--------------|
| Adblock resistance | Blocked by most adblockers | Blocked if worker domain is blocked; very unlikely since it serves the Mini App itself |
| initData validation | Cannot validate on client | Worker validates Telegram initData before trusting distinct_id |
| Attribution capture | Client reads params, sends to PostHog | Worker extracts from headers / body, canonical attribution |
| Data ownership | PostHog is source of truth | D1 is source of truth; PostHog is a view |
| Cost | Zero (but data leaves your control) | One D1 write per event (~$0 at 10k DAU) |

**Key rule:** The Worker validates `initData` before accepting any event. The client sends the raw `window.Telegram.WebApp.initData` string as a request header or body field; the Worker verifies HMAC against `BOT_TOKEN` before inserting.

If initData validation fails (e.g., web preview without Telegram), still insert the event with `telegram_user_id = NULL` but mark `source = 'web'`. Do not reject — attribution data is still useful.

### PostHog forwarding via plain fetch, not @posthog/node

`@posthog/node` is a Node.js SDK that relies on Node's HTTP client and a persistent flush queue. In a Cloudflare Worker:

- There is no persistent process between requests — the flush queue would evaporate.
- The SDK's `shutdown()` / `flush()` pattern does not map to the Worker lifecycle.
- `nodejs_compat` is enabled in wrangler.toml, but the PostHog SDK bundles a network layer that conflicts with the Workers fetch API in practice.

**Recommended approach:** A thin `forwardToPostHog()` function using the global `fetch`:

```typescript
// shared/posthog.ts
export async function forwardToPostHog(
  apiKey: string,
  host: string,
  event: string,
  distinctId: string,
  properties: Record<string, unknown>
): Promise<void> {
  await fetch(`${host}/capture/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      event,
      distinct_id: distinctId,
      properties,
      timestamp: new Date().toISOString(),
    }),
  });
}
```

Called inside the route handler with `ctx.waitUntil()`:

```typescript
ctx.waitUntil(forwardToPostHog(env.POSTHOG_API_KEY, env.POSTHOG_HOST, ...));
```

`ctx.waitUntil()` lets the Worker return a response to the client immediately and keeps the background fetch alive until it resolves. The Worker billing period extends to cover it, but the user sees zero added latency. This is the canonical Cloudflare Workers pattern for fire-and-forget side effects.

No batching is needed at 10k DAU. PostHog's `/capture/` accepts one event per call efficiently. If volume grows, switch to `/batch/` with an array — same approach, no library needed.

**Env bindings to add to wrangler.toml:**
- `POSTHOG_API_KEY` (secret)
- `POSTHOG_HOST` (var: `https://app.posthog.com` or self-hosted URL)

---

## Data Flow: D1 Events Table

### Schema

```sql
-- migration: 0004_analytics_events.sql
CREATE TABLE IF NOT EXISTS onlydate_events (
  id             TEXT    PRIMARY KEY,  -- crypto.randomUUID()
  event          TEXT    NOT NULL,     -- 'feed_card_click_chat' | 'profile_click_chat' | 'profile_open' | 'session_start'
  telegram_user_id INTEGER,            -- NULL if not in Telegram context
  distinct_id    TEXT    NOT NULL,     -- telegram_user_id::text, or a client-generated anon uuid
  session_id     TEXT,                 -- client-generated per-tab uuid, optional
  persona_handle TEXT,                 -- which profile triggered the event (nullable for session_start)
  source         TEXT,                 -- 'telegram' | 'web'
  utm_source     TEXT,
  utm_medium     TEXT,
  utm_campaign   TEXT,
  start_param    TEXT,                 -- Telegram tgWebAppStartParam
  created_at     INTEGER NOT NULL      -- Date.now() (ms since epoch)
);

CREATE INDEX IF NOT EXISTS idx_events_user      ON onlydate_events(telegram_user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_events_event     ON onlydate_events(event, created_at);
CREATE INDEX IF NOT EXISTS idx_events_created   ON onlydate_events(created_at);
```

### Index rationale

- `(telegram_user_id, created_at)` — "show me this user's funnel over time" — the primary admin query pattern.
- `(event, created_at)` — "how many profile_open events in the last 7 days" — dashboard aggregation.
- `created_at` alone — for TTL-based deletion by scheduled Worker (see below).
- No index on `distinct_id` separately — it duplicates the telegram_user_id index for most queries.

### Partitioning and retention

D1 has no native partitioning. Strategy: **append-only writes + scheduled Worker cleanup**.

At 10k DAU with ~5 events per session and 1 session per day = 50k events/day = 1.8M events/month. D1 row limit is 10GB per database; with ~200 bytes per row that is ~50M rows before hitting practical limits — well beyond 90-day retention needs at this scale.

Retention policy: **keep 90 days of raw events**.

```typescript
// Scheduled Worker (cron trigger in wrangler.toml)
// [triggers] crons = ["0 3 * * *"]  (daily at 03:00 UTC)
export async function scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
  const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
  await env.DB.prepare(
    `DELETE FROM onlydate_events WHERE created_at < ? LIMIT 5000`
  ).bind(cutoff).run();
}
```

The `LIMIT 5000` on the DELETE prevents the scheduled Worker from timing out on large purges. If more than 5000 rows are past the cutoff, the next daily run cleans more. This is safe — days-old rows are already in PostHog.

Add to `wrangler.toml`:
```toml
[triggers]
crons = ["0 3 * * *"]
```

And extend the `Env` interface and export default to handle `scheduled`.

---

## Data Flow: Frontend Event Dispatch

### Single `track()` helper — inline in both HTML files

Both `index.html` and `photochoose/index.html` are single-file no-build apps. The tracking helper lives as an inline `<script>` block.

```javascript
// Inline in <script> before first use
const _tgUser = window.Telegram?.WebApp?.initDataUnsafe?.user;
const _initData = window.Telegram?.WebApp?.initData ?? '';
const _anonId = sessionStorage.getItem('od_anon') ?? (() => {
  const id = crypto.randomUUID();
  sessionStorage.setItem('od_anon', id);
  return id;
})();

function track(event, props = {}) {
  const payload = {
    event,
    distinct_id: _tgUser?.id?.toString() ?? _anonId,
    init_data: _initData,   // Worker validates this server-side
    properties: {
      ...props,
      telegram_user_id: _tgUser?.id ?? null,
      utm_source:  new URLSearchParams(location.search).get('utm_source'),
      utm_medium:  new URLSearchParams(location.search).get('utm_medium'),
      utm_campaign: new URLSearchParams(location.search).get('utm_campaign'),
      start_param: window.Telegram?.WebApp?.initDataUnsafe?.start_param ?? null,
    },
  };

  // Fire-and-forget. On failure: silently drop — tracking must never break UX.
  fetch('/api/onlydate/track', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    keepalive: true,   // survives page navigation
  }).catch(() => {});
}
```

**Design choices:**
- **Immediate fire, no queue.** At this scale (few events per session) there is no benefit to buffering. A queue adds state complexity and offline complexity. If the user is offline, the event is lost — acceptable.
- **`keepalive: true`** on the fetch. Cloudflare Workers support this flag. It ensures the POST survives if the user immediately navigates (e.g., taps chat CTA and Telegram takes over).
- **Never throw.** The `.catch(() => {})` is intentional. Analytics failure must be invisible to the user.
- **initData forwarded, not just the user id.** The Worker validates the HMAC and extracts the user id server-side. This prevents event forgery.
- **No service worker / offline queue.** Telegram Mini App runs inside Telegram's WebView — service workers have limited support across Telegram's embedded browser on all platforms. Offline resilience is not worth the complexity here.

### Events to instrument

| Event | Where fired | Key properties |
|-------|-------------|----------------|
| `session_start` | On Mini App load | `start_param`, `utm_*` |
| `profile_open` | When profile view opens | `persona_handle` |
| `feed_card_click_chat` | Chat icon tap on feed card | `persona_handle` |
| `profile_click_chat` | Chat icon tap on profile view | `persona_handle` |

---

## Data Flow: Drag-Drop Reorder Persistence

### sort_order column addition

`onlydate_feed_entries` needs a `sort_order` column:

```sql
-- migration: 0005_feed_order_promotion.sql
ALTER TABLE onlydate_feed_entries ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE onlydate_feed_entries ADD COLUMN is_promoted INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_feed_entries_order ON onlydate_feed_entries(sort_order);
```

The `personas` table (read-only, external) does not get `sort_order`. Promoted/ordering is only meaningful for admin-managed entries. The UNION query sorts by: `is_promoted DESC, sort_order ASC` — personas from the legacy table always float to their natural position (sort_order effectively 9999 or last).

Alternatively: give each legacy persona a synthetic high sort_order value in the UNION projection so they appear at the end by default. Only promoted feed entries surface to the top.

### Bulk update pattern for drag-drop

When the admin finishes dragging and drops an item, send the new full ordering in one request:

```
POST /api/onlydate/admin/reorder
Body: { order: ["id-1", "id-2", "id-3", ...] }  // array of all feed_entry ids in desired sequence
```

Worker implementation using D1 batch:

```typescript
const stmts = order.map((id, idx) =>
  env.DB.prepare(`UPDATE onlydate_feed_entries SET sort_order = ? WHERE id = ?`)
    .bind(idx, id)
);
await env.DB.batch(stmts);
```

D1 `batch()` executes all statements in a single HTTP round-trip to the D1 API, wrapped in an implicit transaction. At 20–100 items this is one network call. D1 batch is documented to support up to 100 statements per call — safe at this scale.

**Why not individual updates:** N separate round-trips from a Workers context means N sequential D1 HTTP calls, each ~10ms. 100 items = ~1 second. Batch: one call.

**Why not a single `CASE WHEN` SQL:** Constructing `UPDATE SET sort_order = CASE WHEN id='x' THEN 0 WHEN id='y' THEN 1 ... END` with 100 items hits SQLite's variable binding limit and makes parameter binding complex. D1 batch is simpler and just as efficient.

**Frontend: debounce on drop, not drag.** Only call the reorder endpoint when the drag operation completes (`dragend` / `pointerup` on the drop target), not on every intermediate `dragover`. The admin UI should show optimistic reorder immediately and confirm silently.

---

## Data Flow: Promotion + Feed Query

### Promotion is a boolean flag, not a separate sort_order tier

`is_promoted` is `0` or `1`. The feed query sorts:

```sql
ORDER BY is_promoted DESC, sort_order ASC
```

This means:
- All promoted entries float above all non-promoted entries.
- Within promoted entries, their relative `sort_order` is respected.
- Within non-promoted entries, their relative `sort_order` is respected.
- Legacy `personas` (from the read-only table, always unpromoted) appear after all `onlydate_feed_entries` with explicit sort_order.

To handle the legacy persona sort position, project `9999999` as their `sort_order` in the UNION:

```sql
SELECT
  p.id, p.display_name AS name, p.handle AS username,
  ${COVER_PHOTO} AS cover_photo,
  0 AS is_promoted,
  9999999 AS sort_order,
  ...
FROM personas p WHERE ...

UNION ALL

SELECT
  fe.id, fe.display_name AS name, fe.handle AS username,
  fe.cover_url AS cover_photo,
  fe.is_promoted,
  fe.sort_order,
  ...
FROM onlydate_feed_entries fe WHERE ...

ORDER BY is_promoted DESC, sort_order ASC
LIMIT 100
```

The `is_promoted` animated star frame is a CSS class applied client-side based on the `is_promoted` field returned in the feed response. No separate endpoint is needed.

Admin promotion toggle:

```
POST /api/onlydate/admin/promote
Body: { persona_id: string, is_promoted: boolean }
```

Only operates on `onlydate_feed_entries` (the `personas` table is read-only).

---

## Architecture: Router Modularisation

### Decision: Split now, not later

Current file is 733 lines. This milestone adds ~6 new route handlers (track, reorder, promote, edit, hide, soft-delete) plus a scheduled handler and 2 shared helpers. Estimated post-milestone size: ~1100–1200 lines in a single file.

The tipping point is not strictly line count — it is discoverability and merge conflicts. With admin and tracking routes in the same file, any admin feature work touches the same lines as any analytics work.

**Recommended file structure:**

```
apps/onlydate-worker/src/
├── index.ts                  # Entry point: mounts routers, exports default + scheduled
├── shared/
│   ├── auth.ts               # isAdmin()
│   ├── feed.ts               # getFeedMode(), feedFilter(), COVER_PHOTO, HAS_FREE_PHOTO
│   └── posthog.ts            # forwardToPostHog()
└── routes/
    ├── media.ts              # GET /media/*
    ├── feed.ts               # GET /api/onlydate/models
    ├── profile.ts            # GET /api/onlydate/models/:username
    ├── tracking.ts           # POST /api/onlydate/track  (NEW)
    ├── webhook.ts            # POST /webhook/onlydate
    └── admin/
        ├── index.ts          # Mounts all admin sub-routes
        ├── personas.ts       # GET/POST persona CRUD, visibility, toggle-active
        ├── photos.ts         # upload, photo/add, photo/delete, photo/toggle, photo/cover
        ├── ordering.ts       # POST reorder  (NEW)
        └── promotion.ts      # POST promote  (NEW)
```

`index.ts` becomes thin:

```typescript
import { Hono } from 'hono';
import mediaRoutes    from './routes/media';
import feedRoutes     from './routes/feed';
import profileRoutes  from './routes/profile';
import trackingRoutes from './routes/tracking';
import adminRoutes    from './routes/admin/index';
import webhookRoutes  from './routes/webhook';

const app = new Hono<{ Bindings: Env }>();
app.use('*', corsMiddleware);
app.route('/', mediaRoutes);
app.route('/', feedRoutes);
app.route('/', profileRoutes);
app.route('/', trackingRoutes);
app.route('/', adminRoutes);
app.route('/', webhookRoutes);
app.notFound((c) => c.json({ error: 'Not found' }, 404));

export default { fetch: app.fetch, scheduled };
```

The `Env` interface and `ADMIN_PASSWORD` constant move to `shared/auth.ts`. The split costs one refactor phase but prevents the single file from becoming unworkable.

**Migration path:** Do the split first as its own isolated step (no functional changes, just file rearrangement). Then add new routes into the new structure. This keeps diffs readable.

---

## Architecture: Desktop Layout

### Pure CSS, zero JS

The 9:16 constraint is a layout constraint, not a runtime calculation. JS-driven layout adds a flash-of-unstyled-content (FOUC) risk and CLS (Cumulative Layout Shift) — exactly wrong for a performance-sensitive first screen.

```css
/* Applied to html, body */
html, body {
  height: 100%;
  margin: 0;
  background: #000;  /* letterbox color for desktop */
}

/* The "phone frame" wrapper */
#app {
  /* Fixed 9:16 aspect ratio, max height = 100vh */
  aspect-ratio: 9 / 16;
  height: 100%;
  max-height: 100vh;
  width: auto;
  max-width: 100vw;
  margin: 0 auto;
  position: relative;
  overflow: hidden;
}
```

On mobile (Telegram's WebView, which already fits the viewport), `height: 100%` fills the screen naturally. On desktop (Telegram Desktop), the black letterboxing isolates the 9:16 column in the centre. No media queries needed — `aspect-ratio` + `max-height: 100vh` handles both.

`aspect-ratio` is supported in all Telegram client WebView engines (Chromium 90+, Safari 15+). No fallback needed for this product.

**Impact on first-paint:** CSS resolves before any JS executes. The layout is established in the first render frame. Images inside the constrained container use `object-fit: cover` + `width: 100%; height: 100%` so they fill without distortion. No layout shift from images either if heights are declared.

---

## Component Boundaries (summary)

| Component | Owns | Communicates with | New this milestone |
|-----------|------|-------------------|--------------------|
| `index.html` | Public feed UI, profile view, chat CTA | Worker `/api/onlydate/models*`, Worker `/api/onlydate/track` | track() helper, chat CTA buttons, 9:16 layout |
| `photochoose/index.html` | Admin CRUD UI | Worker `/api/onlydate/admin/*` | drag-drop reorder, promotion toggle, edit/hide/delete |
| `routes/feed.ts` | UNION feed query | D1 | sort_order + is_promoted in ORDER BY |
| `routes/tracking.ts` | Event ingestion | D1 (write), PostHog (async) | Entire new file |
| `routes/admin/ordering.ts` | Reorder bulk update | D1 batch | Entire new file |
| `routes/admin/promotion.ts` | Promote toggle | D1 | Entire new file |
| `shared/posthog.ts` | PostHog forwarding | PostHog HTTP API | Entire new file |
| D1 `onlydate_events` | Raw event log | — | New table |
| D1 `onlydate_feed_entries` | Feed entries | — | New columns: sort_order, is_promoted |
| Scheduled Worker export | TTL cleanup | D1 | New handler |

---

## Build Order (dependency-driven)

Dependencies flow bottom-up. Build lower items before higher items.

```
Phase 1 — Foundation (no user-visible changes, but unblocks everything)
  1a. DB migration 0004: add sort_order + is_promoted to onlydate_feed_entries
  1b. DB migration 0005: create onlydate_events table
  1c. Router modularisation (split index.ts → routes/* + shared/*)
      → No functional change. Required before adding routes in parallel phases.

Phase 2 — Layout + CTA (unblocks performance measurement)
  2a. 9:16 CSS layout in index.html
  2b. Chat CTA buttons (feed card + profile view) using existing handle field
      → Depends on: Phase 1c (clean file to edit into)
      → Unblocks: Analytics events have a surface to attach to

Phase 3 — Analytics backend (required before frontend tracking)
  3a. routes/tracking.ts + shared/posthog.ts + Env bindings
  3b. Scheduled Worker export for TTL cleanup
      → Depends on: Phase 1b (events table), Phase 1c (module structure)
      → Unblocks: Phase 4

Phase 4 — Analytics frontend
  4a. track() helper in index.html
  4b. Wire track() to: session_start, profile_open, feed_card_click_chat, profile_click_chat
      → Depends on: Phase 2b (CTA buttons exist), Phase 3a (endpoint exists)

Phase 5 — Admin: ordering + promotion
  5a. routes/admin/ordering.ts (reorder endpoint)
  5b. routes/admin/promotion.ts (promote toggle endpoint)
  5c. Feed query updated: ORDER BY is_promoted DESC, sort_order ASC
  5d. photochoose/index.html: drag-drop UI + promotion toggle
      → Depends on: Phase 1a (schema), Phase 1c (module structure)
      → 5c depends on 5a schema; 5d depends on 5a+5b endpoints

Phase 6 — Admin: profile management (edit/hide/soft-delete)
  6a. routes/admin/personas.ts: edit name/handle/cover, hide, soft-delete endpoints
  6b. photochoose/index.html: UI for edit + hide + delete
      → Depends on: Phase 1c
      → Can be done in parallel with Phase 5
```

**Critical path:** Phase 1 → Phase 3 → Phase 4.

The layout (Phase 2) and admin features (Phases 5–6) are on separate branches from the analytics work and can be developed in parallel after Phase 1 is complete.

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Client-side distinct_id without server validation
**What:** Trusting `telegram_user_id` from the request body without verifying `initData`.
**Why bad:** Any actor can POST fake events attributed to any user id, inflating funnels or poisoning attribution data.
**Instead:** Always verify `initData` HMAC in the tracking route before storing `telegram_user_id`.

### Anti-Pattern 2: Blocking the response on PostHog forwarding
**What:** `await forwardToPostHog(...)` inside the request handler before `return c.json(...)`.
**Why bad:** PostHog's latency (~50–200ms) is added to every user-facing event track call. At 5 events per session, that is ~1 second of added latency per session.
**Instead:** `ctx.waitUntil(forwardToPostHog(...))` always. PostHog data is best-effort; D1 is the source of truth.

### Anti-Pattern 3: Per-row sort_order updates on drag-drop
**What:** Firing one `UPDATE ... SET sort_order = N WHERE id = X` for each row after reorder.
**Why bad:** 100 rows = 100 sequential D1 HTTP round-trips from the Worker = ~1 second. UI hangs.
**Instead:** D1 `batch()` with all updates in one call. One round-trip regardless of N.

### Anti-Pattern 4: JS-computed 9:16 layout
**What:** Reading `window.innerWidth / window.innerHeight` in JS and setting `width`/`height` styles.
**Why bad:** Layout is invisible until JS executes. Causes visible layout shift (CLS) and perceived slowness on first paint.
**Instead:** Pure CSS `aspect-ratio: 9/16` + `max-height: 100vh`. Resolves before JS.

### Anti-Pattern 5: Monolithic index.ts past 1000 lines
**What:** Continuing to append all new routes to `apps/onlydate-worker/src/index.ts`.
**Why bad:** Merge conflicts between analytics work and admin work increase. Navigating the file by grep becomes the primary way to find things.
**Instead:** Modularise at the start of this milestone (Phase 1c). Cheap to do early, expensive to do later.

---

## Scalability Considerations

| Concern | At current (1k DAU) | At 10k DAU | At 100k DAU |
|---------|--------------------|--------------------|-------------|
| D1 event writes | Trivially fine | ~50k rows/day, well within D1 limits | ~500k rows/day; 90-day retention = 45M rows; monitor D1 storage usage |
| PostHog forwarding | Zero cost | Zero cost (free tier: 1M events/month = headroom) | May hit PostHog free tier (1M/month); switch to self-hosted |
| Feed UNION query | Fine (no index on sort_order yet needed) | Add index on `(is_promoted DESC, sort_order ASC)` | Consider materialised cache in KV for the feed response |
| Admin reorder (D1 batch) | Fine | Fine (admin is one user) | Fine (admin is one user) |

---

## Sources

- Cloudflare Workers `ctx.waitUntil()` documentation: https://developers.cloudflare.com/workers/runtime-apis/context/#waituntil (HIGH confidence — core Workers API)
- D1 `batch()` documentation: https://developers.cloudflare.com/d1/worker-api/d1-database/#batch-statements (HIGH confidence — documented limit: up to 100 statements per batch)
- D1 scheduled Workers / cron triggers: https://developers.cloudflare.com/workers/configuration/cron-triggers/ (HIGH confidence)
- PostHog `/capture/` HTTP API: https://posthog.com/docs/api/capture (HIGH confidence — documented REST endpoint, no SDK required)
- CSS `aspect-ratio` MDN: https://developer.mozilla.org/en-US/docs/Web/CSS/aspect-ratio (HIGH confidence)
- Existing codebase analysis: `apps/onlydate-worker/src/index.ts` (lines 1–733), migration files 0002–0003, `wrangler.toml`
