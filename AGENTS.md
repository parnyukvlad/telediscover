# AGENTS.md — OnlyDate Project

Complete context for any AI agent working on this codebase.

---

## What Is This

**OnlyDate** is a Telegram Mini App — a public discovery directory for AI persona "models". Users browse personas, view their free photos, and tap through to chat with them on Telegram.

There are three moving parts:

| Part | What it is | Deployed at |
|---|---|---|
| `apps/onlydate/` | Public Mini App frontend (Cloudflare Pages) | https://onlydate.pages.dev |
| `apps/onlydate/photochoose/` | Admin photo moderation panel (same Pages deploy) | https://onlydate.pages.dev/photochoose |
| `apps/onlydate-worker/` | Cloudflare Worker — REST API + Telegram webhook | https://onlydate-api.tg-saas.workers.dev |

The Telegram bot is **@onlydatebot** (token stored as Cloudflare Worker secret `BOT_TOKEN`).

---

## Hard Rules

- **No frameworks** — frontend is vanilla JS, single HTML files, zero build step.
- **No npm** — always use `pnpm`. Lock file is `pnpm-lock.yaml` at repo root.
- **Mobile-first** — designed for 390px width.
- **No shared packages** — `apps/onlydate-worker` has zero workspace dependencies. It is fully self-contained.
- **No schema changes** to the shared D1 database (`personas`, `media_library`, `media_files`, `message_history`) — these tables are owned by another application. The only table you own is `onlydate_photo_config`.
- **Do not break the existing D1 database** — the worker has read-write access; `onlydate_photo_config` is the only table you should write to.

---

## Repository Layout

```
onlydate/                        ← repo root
├── apps/
│   ├── onlydate/
│   │   ├── index.html           ← Public Mini App (grid + profile + lightbox)
│   │   └── photochoose/
│   │       └── index.html       ← Admin moderation panel
│   └── onlydate-worker/
│       ├── src/
│       │   └── index.ts         ← Hono worker: all API routes + Telegram webhook
│       ├── package.json
│       ├── tsconfig.json
│       └── wrangler.toml
├── package.json                 ← Root: deploy scripts
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
├── .gitignore                   ← .env.cloudflare is gitignored
├── .env.cloudflare              ← Cloudflare credentials (NOT in git)
└── AGENTS.md                    ← this file
```

---

## Infrastructure

### Cloudflare Account
- Credentials: `.env.cloudflare` (gitignored)
  ```
  CLOUDFLARE_API_TOKEN=...
  CLOUDFLARE_ACCOUNT_ID=...
  ```
- Account subdomain: `tg-saas` → Workers are at `*.tg-saas.workers.dev`

### Cloudflare Pages — `onlydate`
- Project name: `onlydate`
- Deploys from: `apps/onlydate/` directory
- Branch: `main`
- No build step — static HTML files only

### Cloudflare Worker — `onlydate-api`
- Entry: `apps/onlydate-worker/src/index.ts`
- D1 binding: `DB` → `telegram-saas-db` (id `a5ecae6f-2448-4770-b134-2ce77fa987b4`)
- Secrets: `BOT_TOKEN` (Telegram bot token — stored as Cloudflare secret, not in wrangler.toml)
- Env vars: `ENVIRONMENT = "production"` (in wrangler.toml)

### Telegram Bot
- Username: `@onlydatebot`
- Token: stored ONLY as Cloudflare Worker secret `BOT_TOKEN`
- Webhook: registered at `https://onlydate-api.tg-saas.workers.dev/webhook/onlydate`

---

## Deploy Commands

Always source credentials first:

```bash
# Source credentials (required before any deploy)
export CLOUDFLARE_API_TOKEN=$(grep "^CLOUDFLARE_API_TOKEN=" .env.cloudflare | cut -d= -f2-)
export CLOUDFLARE_ACCOUNT_ID=$(grep "^CLOUDFLARE_ACCOUNT_ID=" .env.cloudflare | cut -d= -f2-)

# Deploy Worker
pnpm --filter onlydate-worker run deploy

# Deploy Pages (frontend)
npx wrangler pages deploy apps/onlydate --project-name onlydate --branch main --commit-dirty=true

# Deploy both (root shortcut)
pnpm run deploy
```

### Typecheck (before deploying worker)
```bash
pnpm --filter onlydate-worker run typecheck
```

### Add/rotate a secret
```bash
export CLOUDFLARE_API_TOKEN=$(grep "^CLOUDFLARE_API_TOKEN=" .env.cloudflare | cut -d= -f2-)
export CLOUDFLARE_ACCOUNT_ID=$(grep "^CLOUDFLARE_ACCOUNT_ID=" .env.cloudflare | cut -d= -f2-)
echo "new-value" | pnpm --filter onlydate-worker exec wrangler secret put SECRET_NAME
```

### Register Telegram webhook (only needed if URL changes)
```bash
curl -s "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -d "url=https://onlydate-api.tg-saas.workers.dev/webhook/onlydate"
```

---

## Database

### Shared D1 — `telegram-saas-db`

Tables you READ (do not modify schema):

```sql
-- Personas (AI models)
personas (
  id          TEXT PRIMARY KEY,   -- NanoID string e.g. "sWUUDbPqGtR2IAYWxjcQg"
  display_name TEXT,
  handle      TEXT,               -- Telegram username; sometimes includes leading "@"
  is_active   INTEGER,            -- 1 = active, 0 = inactive
  created_at  INTEGER             -- JS milliseconds
)

-- Photo library entries (one per photo set)
media_library (
  id          TEXT PRIMARY KEY,   -- NanoID; this is what onlydate_photo_config.media_id references
  persona_id  TEXT,               -- FK → personas.id
  category    TEXT,               -- 'casual' = free photos
  price_stars INTEGER,            -- NULL or 0 = free
  type        TEXT,               -- 'photo'
  created_at  INTEGER
)

-- Actual file URLs (one media_library entry → one or more files)
media_files (
  media_id    TEXT,               -- FK → media_library.id
  file_url    TEXT,
  file_order  INTEGER
)

-- Chat history (used for trending/popular rankings)
message_history (
  persona_id  TEXT,
  created_at  INTEGER
)
```

**"Free photo" definition:**
```sql
category = 'casual' AND (price_stars IS NULL OR price_stars = 0) AND type = 'photo'
```

**Handle quirk:** The `handle` field sometimes already has a leading `@`. Always strip it before prepending in frontend: `.replace(/^@/, '')`.

---

### Owned table — `onlydate_photo_config`

Created in production D1. This is the ONLY table you write to.

```sql
CREATE TABLE IF NOT EXISTS onlydate_photo_config (
  media_id             TEXT PRIMARY KEY,  -- FK → media_library.id
  is_hidden            INTEGER NOT NULL DEFAULT 0,    -- 1 = hidden from public
  is_cover_for_persona TEXT,             -- persona.id if this is the cover photo, else NULL
  updated_at           INTEGER NOT NULL DEFAULT 0     -- JS milliseconds
);
```

**Semantics:**
- **No row** = photo is visible by default (new photos auto-visible ✅)
- `is_hidden = 1` = excluded from public app and counts
- `is_cover_for_persona = <persona_id>` = this is the cover photo for that persona
- A photo can be both a cover AND hidden — avoid this in the UI (always un-hide before setting as cover)

---

## Critical D1 SQLite Gotcha

**D1 does NOT allow outer-query aliases in subquery `ORDER BY` clauses.**

```sql
-- ❌ FAILS in D1 — "no such column: p.id"
SELECT p.id, (
  SELECT mf.file_url FROM media_library ml
  JOIN media_files mf ON mf.media_id = ml.id
  WHERE ml.persona_id = p.id
  ORDER BY CASE WHEN some_col = p.id THEN 0 ELSE 1 END ASC  -- p.id here = ERROR
  LIMIT 1
) AS cover FROM personas p

-- ✅ WORKS — p.id in WHERE is fine, just not in ORDER BY
SELECT p.id, COALESCE(
  (SELECT mf.file_url FROM ... WHERE ... AND some_col = p.id LIMIT 1),   -- explicit, no ORDER BY
  (SELECT mf.file_url FROM ... WHERE ml.persona_id = p.id ORDER BY ml.created_at ASC LIMIT 1)
) AS cover FROM personas p
```

The current `COVER_PHOTO` SQL fragment in `index.ts` already uses the COALESCE workaround. Do not regress this.

---

## Worker API Reference

Base URL: `https://onlydate-api.tg-saas.workers.dev`

### Public Endpoints

#### `GET /`
Health check.
```json
{ "name": "OnlyDate API", "status": "ok" }
```

---

#### `GET /api/onlydate/models?tab=trending|popular|new`
Returns list of active personas with at least one visible free photo.

| Tab | Sort | Notes |
|---|---|---|
| `trending` | `message_count DESC` | Counts messages from last 7 days |
| `popular` | `message_count DESC` | All-time message count |
| `new` | `created_at DESC` | Persona creation date |

**Response:**
```json
{
  "models": [
    {
      "id": "sWUUDbPqGtR2IAYWxjcQg",
      "name": "Kim Jang",
      "username": "@kimsteria",
      "cover_photo": "https://...r2.dev/images/kim/photo.jpg",
      "message_count": 42
    }
  ]
}
```

**Filter:** Only personas with `is_active = 1`, non-null `handle`, and at least one visible free photo. Personas where all free photos are hidden disappear from the list. JS post-filter also excludes rows where `cover_photo` is null.

---

#### `GET /api/onlydate/models/:username`
Full persona profile. `:username` is the raw `handle` value from the database (may include `@`).

**Response:**
```json
{
  "id": "sWUUDbPqGtR2IAYWxjcQg",
  "name": "Kim Jang",
  "username": "@kimsteria",
  "cover_photo": "https://...jpg",
  "free_photos": ["https://...jpg", "https://...jpg"],
  "message_count": 42
}
```

`free_photos` is ordered: cover photo first, then by `created_at ASC`, `file_order ASC`. Only visible photos are included.

---

### Admin Endpoints

All admin endpoints require the header:
```
X-Admin-Password: PhotoAdmin#9Kz$M2pVL8xR5nQ!2025
```
Returns `401` if missing or wrong.

#### `GET /api/onlydate/admin/personas`
Returns all active personas with ALL their free photos (visible and hidden) plus config state.

**Response:**
```json
{
  "personas": [
    {
      "id": "sWUUDbPqGtR2IAYWxjcQg",
      "name": "Kim Jang",
      "username": "@kimsteria",
      "photos": [
        {
          "media_id": "ohQZtDQd4M3i7q4YgxTYS",
          "file_url": "https://...jpg",
          "is_hidden": false,
          "is_cover": true
        }
      ]
    }
  ]
}
```

---

#### `POST /api/onlydate/admin/photo/toggle`
Hide or show a photo.

**Body:**
```json
{ "media_id": "ohQZtDQd4M3i7q4YgxTYS", "is_hidden": true }
```

**Response:** `{ "ok": true }`

Uses `INSERT ... ON CONFLICT DO UPDATE` — safe to call multiple times.

---

#### `POST /api/onlydate/admin/photo/cover`
Set a photo as the cover for its persona.

**Body:**
```json
{ "media_id": "ohQZtDQd4M3i7q4YgxTYS", "persona_id": "sWUUDbPqGtR2IAYWxjcQg" }
```

**Response:** `{ "ok": true }`

Atomically: clears `is_cover_for_persona` for ALL photos of that persona, then sets this one. Only one cover per persona is enforced.

---

### Telegram Webhook

#### `POST /webhook/onlydate`
Receives Telegram Bot API updates for `@onlydatebot`. Always returns `{ "ok": true }` (Telegram requires 200 even on errors).

**Handled commands:**
- `/start` → sends welcome message with HTML formatting + "Open" Web App inline button pointing to `https://onlydate.pages.dev`

**Message format:**
```
🎉 <b>Welcome to OnlyDate!</b>

💘 OnlyDate is a discovery app for AI companions on Telegram. Browse unique personalities and start chatting.
[Open]  ← Web App button
```

**Important:** Use `parse_mode: 'HTML'` not `MarkdownV2`. MarkdownV2 requires escaping `!`, `.`, `(`, `)` and many other characters — easy to get wrong silently (Telegram returns 400, webhook returns 200, message never sends).

---

## Frontend — Public Mini App (`apps/onlydate/index.html`)

Single-page vanilla JS app. No build step.

### Views
- **Grid view** (`#grid-view`) — default. 2-column card grid with tab bar (Trending / Popular / New).
- **Profile view** (`#profile-view`) — shown on card tap. Avatar, name, handle, Message + Share buttons, 2-column photo grid.
- **Lightbox** (`#lightbox`) — fullscreen photo viewer with touch swipe, dot indicators (≤10 photos) or counter (>10), "Message" button.

### Key constants
```js
const API_BASE = 'https://onlydate-api.tg-saas.workers.dev';
```

### Telegram Mini App integration
```js
const tg = window.Telegram && window.Telegram.WebApp;
tg.ready();
tg.expand();
tg.setHeaderColor('#0a0a0a');
tg.setBackgroundColor('#0a0a0a');
tg.BackButton.show() / .hide() / .onClick(fn)
tg.openTelegramLink(url)   // for Message button
```

### Data flow
1. On init: fetch all 3 tabs in parallel → cache → render current tab
2. Tab switch: renders from cache (no re-fetch)
3. Card click: fetch `/api/onlydate/models/:username` → render profile
4. Photo tap: open lightbox with that persona's `free_photos` array

### Design tokens
```css
--bg: #0a0a0a;        /* page background */
--surface: #141414;
--surface2: #1e1e1e;
--accent: #a855f7;    /* purple */
--text-muted: #888888;
--radius-card: 16px;
```

---

## Admin Panel (`apps/onlydate/photochoose/index.html`)

Password-protected, vanilla JS, no build step. URL: `/photochoose`.

### Auth flow
- Password checked server-side via `GET /api/onlydate/admin/personas` with `X-Admin-Password` header
- On success: stored in `sessionStorage` under key `od_admin_pw`
- On page reload: re-uses stored password → skips lock screen
- Logout: clears sessionStorage, shows lock screen

### Password
```
PhotoAdmin#9Kz$M2pVL8xR5nQ!2025
```
Hardcoded in `apps/onlydate-worker/src/index.ts` as `ADMIN_PASSWORD` constant.

### UI flow
1. **Lock screen** → enter password → unlock
2. **Personas list** → searchable list with avatar + "X visible / Y total" counts
3. **Photos grid** (3-column, 3:4 ratio) per persona:
   - `👁` / `🚫` button → toggle visibility (optimistic update)
   - `☆` / `⭐` button → set/indicate cover photo (gold border + "Cover" badge)
4. Back button → return to personas list (re-renders counts)

### State management
- `allPersonas` array holds full state including current `is_hidden` / `is_cover` per photo
- Photo actions mutate `allPersonas` in-place (optimistic) then API call
- Cover change re-renders entire photo grid

---

## SQL Patterns

### Visibility-aware photo query
Always use this pattern when querying photos for the public app:
```sql
LEFT JOIN onlydate_photo_config opc ON opc.media_id = ml.id
WHERE ... AND (opc.is_hidden IS NULL OR opc.is_hidden = 0)
-- NULL means no row → visible by default
```

### Cover photo (COALESCE pattern — required due to D1 limitation)
```sql
COALESCE(
  -- 1. Explicit cover (uses p.id in WHERE — OK in D1)
  (SELECT mf.file_url
   FROM media_library ml JOIN media_files mf ON mf.media_id = ml.id
   JOIN onlydate_photo_config opc ON opc.media_id = ml.id
   WHERE ml.persona_id = p.id
     AND ml.category = 'casual' AND (ml.price_stars IS NULL OR ml.price_stars = 0)
     AND ml.type = 'photo'
     AND opc.is_cover_for_persona = p.id
     AND (opc.is_hidden IS NULL OR opc.is_hidden = 0)
   LIMIT 1),
  -- 2. Fallback: oldest visible photo (no p.id in ORDER BY — required)
  (SELECT mf.file_url
   FROM media_library ml JOIN media_files mf ON mf.media_id = ml.id
   LEFT JOIN onlydate_photo_config opc ON opc.media_id = ml.id
   WHERE ml.persona_id = p.id
     AND ml.category = 'casual' AND (ml.price_stars IS NULL OR ml.price_stars = 0)
     AND ml.type = 'photo'
     AND (opc.is_hidden IS NULL OR opc.is_hidden = 0)
   ORDER BY ml.created_at ASC, mf.file_order ASC
   LIMIT 1)
)
```

---

## Known Issues & Gotchas

### 1. D1 correlated subquery ORDER BY limitation
**Problem:** D1/SQLite rejects `ORDER BY` clauses in subqueries that reference an outer-query alias (e.g. `p.id`). The error is `no such column: p.id`.
**Status:** Fixed. `COVER_PHOTO` uses COALESCE pattern (see above).
**Do not regress:** Never put outer-query aliases into a subquery's `ORDER BY`.

### 2. MarkdownV2 silent failures in Telegram
**Problem:** `parse_mode: 'MarkdownV2'` requires escaping `!`, `.`, `(`, `)`, `-`, `+`, and more. Unescaped characters cause Telegram to return `400 Bad Request`. The webhook still returns `200 OK` so there's no visible error — the message just never sends.
**Status:** Fixed. Using `parse_mode: 'HTML'` instead.
**Rule:** Always use HTML parse mode. Avoid MarkdownV2.

### 3. handle field has inconsistent `@` prefix
**Problem:** Some personas have `handle = "@kimsteria"`, others have `handle = "kimsteria"`.
**Status:** Frontend always strips with `.replace(/^@/, '')` before display/use.
**Rule:** Whenever you use `handle` as a Telegram link or display it, always strip the leading `@` first.

### 4. Worker secrets not shown in deploy output
**Problem:** `wrangler deploy` output only lists D1 and env vars, not secrets. This is normal — secrets are intentionally hidden.
**Verification:** `pnpm --filter onlydate-worker exec wrangler secret list`

---

## D1 Debugging

```bash
# Source credentials first
export CLOUDFLARE_API_TOKEN=$(grep "^CLOUDFLARE_API_TOKEN=" .env.cloudflare | cut -d= -f2-)
export CLOUDFLARE_ACCOUNT_ID=$(grep "^CLOUDFLARE_ACCOUNT_ID=" .env.cloudflare | cut -d= -f2-)

# Run any SQL query against production D1
pnpm --filter onlydate-worker exec wrangler d1 execute telegram-saas-db --remote \
  --command "SELECT COUNT(*) FROM onlydate_photo_config;"

# Check photo config state
pnpm --filter onlydate-worker exec wrangler d1 execute telegram-saas-db --remote \
  --command "SELECT media_id, is_hidden, is_cover_for_persona FROM onlydate_photo_config LIMIT 20;"

# Check visible photo counts per persona
pnpm --filter onlydate-worker exec wrangler d1 execute telegram-saas-db --remote \
  --command "SELECT p.display_name, COUNT(*) as visible FROM personas p JOIN media_library ml ON ml.persona_id = p.id JOIN media_files mf ON mf.media_id = ml.id LEFT JOIN onlydate_photo_config opc ON opc.media_id = ml.id WHERE ml.category = 'casual' AND ml.type = 'photo' AND (opc.is_hidden IS NULL OR opc.is_hidden = 0) GROUP BY p.id;"
```

---

## Live URLs (Quick Reference)

| Resource | URL |
|---|---|
| Public Mini App | https://onlydate.pages.dev |
| Admin Panel | https://onlydate.pages.dev/photochoose |
| Worker API | https://onlydate-api.tg-saas.workers.dev |
| Health check | https://onlydate-api.tg-saas.workers.dev/ |
| Telegram Bot | @onlydatebot |
| Webhook | https://onlydate-api.tg-saas.workers.dev/webhook/onlydate |
