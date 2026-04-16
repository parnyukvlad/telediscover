# Architecture

**Analysis Date:** 2026-04-16

## Pattern Overview

**Overall:** Monorepo with three decoupled deployment units — a public Telegram Mini App frontend, an admin panel, and a serverless REST API backend. The system follows a client-server architecture deployed on Cloudflare (Pages + Workers + D1).

**Key Characteristics:**
- **Multi-app monorepo** — managed with pnpm workspace
- **Serverless backend** — Cloudflare Worker with D1 SQLite database and R2 object storage
- **Static frontend** — vanilla JavaScript, no build step, deployed as static HTML files
- **Decoupled data sources** — Worker reads from shared legacy database (`personas`, `media_library`) while owning its own tables (`onlydate_feed_entries`, `onlydate_feed_photos`, `onlydate_photo_config`)
- **Telegram integration** — Mini App entry point via @onlydatebot, webhook-based messaging

## Layers

**Frontend (Public Discovery):**
- Purpose: Display browsable grid of AI persona models, render individual profiles, serve Telegram Mini App experience
- Location: `apps/onlydate/index.html`
- Contains: HTML, CSS, vanilla JavaScript (event handlers, grid/profile view management, API calls)
- Depends on: Worker API (`/api/onlydate/models*`), Telegram Web App SDK
- Used by: End users via Telegram client

**Admin Panel (Photo Moderation):**
- Purpose: Manage feed entries, upload/delete photos, control visibility and cover images
- Location: `apps/onlydate/photochoose/index.html`
- Contains: HTML, CSS, vanilla JavaScript (authentication, photo grid, upload handling, visibility toggling)
- Depends on: Worker API (`/api/onlydate/admin/*`), password-based auth header
- Used by: Admin users (password-protected via header `X-Admin-Password`)

**Backend API (Hono):**
- Purpose: Route all HTTP requests, serve media files from R2, manage database state, handle Telegram webhooks
- Location: `apps/onlydate-worker/src/index.ts`
- Contains: Hono middleware, route handlers (REST endpoints + webhook), D1 queries, R2 operations
- Depends on: Cloudflare Bindings (D1, R2, BOT_TOKEN secret), Hono framework
- Used by: Frontend (public), Admin Panel, Telegram bot (webhooks), R2 file serving

**Database Layer:**
- Purpose: Store persona metadata, feed entries, photos, visibility config, app settings
- Binding name: `DB` (D1 SQLite in wrangler.toml)
- Database: `telegram-saas-db` (shared with other applications)
- Owns tables:
  - `onlydate_feed_entries` — manually created feed entries (display_name, handle, cover_url, is_active, feed_visible)
  - `onlydate_feed_photos` — gallery photos for feed entries (file_key, file_url, sort_order)
  - `onlydate_photo_config` — visibility/cover flags for media_library items (is_hidden, is_cover_for_persona)
  - `app_settings` — global configuration (feed_mode: 'all' or 'selected')
- Reads from (shared tables):
  - `personas` — AI model profiles (managed externally)
  - `media_library` — photo/video collections with pricing metadata
  - `media_files` — individual files per media item
  - `message_history` — user message counts per persona

**Object Storage:**
- Purpose: Serve uploaded feed entry photos and gallery images
- Binding name: `MEDIA` (R2 bucket in wrangler.toml)
- Bucket: `onlydate`
- Serves via: GET `/media/*` route (publicly readable, 1-year cache)
- Used by: Admin upload, feed entry gallery management

## Data Flow

**Public Discovery (Browse → View Profile):**

1. User opens Telegram Mini App (https://onlydate.pages.dev)
2. Frontend calls `GET /api/onlydate/models?tab=trending|popular|new`
3. Worker queries database:
   - Merges personas (with `COVER_PHOTO` subquery) with feed_entries
   - Filters by feed visibility settings (global mode + per-persona overrides)
   - Ranks by message_count (trending) or created_at (new)
   - Returns top 100 with id, name, username, cover_photo URL, message_count
4. Frontend renders 2-column grid, loads cover images from R2
5. User taps card → calls `GET /api/onlydate/models/:username`
6. Worker returns full profile:
   - persona details (id, name, username, cover_photo)
   - free_photos array (visible photos, cover first)
   - message_count
7. Frontend renders profile view with photo carousel
8. User taps "Open" button → Telegram client opens chat with the persona bot

**Admin Operations (Upload → Apply → Publish):**

1. Admin unlocks photochoose panel with password
2. Frontend calls `GET /api/onlydate/admin/personas` (auth required)
3. Worker returns:
   - All personas (active + inactive) from personas table
   - All feed_entries with their photos
   - Grouped by persona_id with photo details (is_hidden, is_cover, file_url)
4. Admin uploads new photo:
   - Selects file → frontend calls `POST /api/onlydate/admin/upload`
   - Worker stores in R2 at `feed-entries/{entry_id}/{context}-{uuid}.{ext}`
   - Returns url and key
5. Admin adds photo to feed entry:
   - Frontend calls `POST /api/onlydate/admin/feed-entry/photo/add`
   - Worker inserts into onlydate_feed_photos with file_key, file_url, sort_order
6. Admin toggles visibility:
   - Frontend calls `POST /api/onlydate/admin/photo/toggle`
   - Worker upserts onlydate_photo_config.is_hidden
7. Admin sets cover image:
   - Frontend calls `POST /api/onlydate/admin/feed-entry/set-cover` (for feed entries)
   - OR `POST /api/onlydate/admin/photo/cover` (for personas)
   - Worker updates database accordingly
8. Admin changes feed mode:
   - Frontend calls `POST /api/onlydate/admin/feed-settings`
   - Worker updates app_settings.feed_mode ('all' or 'selected')
   - Changes visibility filter logic globally

**State Management:**

- **Frontend state:** Minimal — current view (grid/profile), selected tab (trending/popular/new), cached model data in DOM
- **Admin state:** Current password auth (session-less, validates header on each request), lock screen vs. app view
- **Backend state:** All persistent state in D1 (personas, feed entries, photos, visibility config, global settings)
- **Visibility logic:** Feed filter applied at query time, not cached
  - Global mode (`feed_mode='all'`): show if `feed_visible IS NULL OR feed_visible = 1`
  - Selected mode (`feed_mode='selected'`): show only if `feed_visible = 1`

## Key Abstractions

**Cover Photo Selection:**
- Purpose: Display a single representative image per persona/feed_entry
- Pattern: SQL COALESCE with two subqueries
- For personas: Prefers admin-marked cover (onlydate_photo_config.is_cover_for_persona), falls back to oldest visible free photo
- For feed entries: Uses cover_url column directly
- Implementation: `COVER_PHOTO` SQL fragment in `apps/onlydate-worker/src/index.ts` lines 201-228

**Visibility Filtering:**
- Purpose: Control which personas appear in public discovery feed
- Pattern: Dynamic SQL WHERE clause based on feed_mode setting
- Function: `feedFilter(alias, mode)` in `apps/onlydate-worker/src/index.ts` lines 190-194
- Returns: SQL fragment like `fe.feed_visible = 1` or `(fe.feed_visible IS NULL OR fe.feed_visible = 1)`

**Media URL Routing:**
- Purpose: Serve R2 files via worker with cache headers
- Pattern: Route handler extracts key from path `/media/{key}`, fetches from R2, sets 1-year immutable cache
- Implementation: `app.get('/media/*')` in `apps/onlydate-worker/src/index.ts` lines 34-43

**Photo Search Within Personas:**
- Purpose: Find visible, price-free photos with optional cover override
- Pattern: Multi-table join (media_library → media_files, with optional onlydate_photo_config)
- Filters: category='casual', price_stars IS NULL OR 0, type='photo', is_hidden IS NULL OR 0
- Used in: `GET /api/onlydate/models/:username` profile endpoint

## Entry Points

**Telegram Mini App:**
- Location: `https://onlydate.pages.dev` (deployed from `apps/onlydate/index.html`)
- Triggers: User opens Mini App via /start command in @onlydatebot
- Responsibilities: 
  - Initialize Telegram Web App SDK
  - Fetch and display grid of models (tab-switchable: trending/popular/new)
  - Handle model card clicks → fetch profile → render profile view
  - Serve photo lightbox with navigation

**Admin Panel:**
- Location: `https://onlydate.pages.dev/photochoose` (deployed from `apps/onlydate/photochoose/index.html`)
- Triggers: Manual navigation or direct link
- Responsibilities:
  - Lock screen (password entry via X-Admin-Password header)
  - Fetch all personas and feed entries from admin API
  - Render persona grid with photo galleries
  - Handle uploads, visibility toggles, cover selection, feed mode management

**Telegram Webhook:**
- Location: `POST https://onlydate-api.tg-saas.workers.dev/webhook/onlydate`
- Triggers: Telegram bot forwards user messages
- Responsibilities:
  - Parse incoming message update
  - Detect /start command
  - Send welcome message with Mini App deep link button

**Worker REST API:**
- Entry: `apps/onlydate-worker/src/index.ts` (index.ts is compiled to worker by wrangler)
- Registered routes:
  - Public: `GET /`, `GET /media/*`, `GET /api/onlydate/models`, `GET /api/onlydate/models/:username`
  - Admin-only: `POST /api/onlydate/admin/*`, `GET /api/onlydate/admin/*`
  - Webhook: `POST /webhook/onlydate`

## Error Handling

**Strategy:** API returns JSON error objects with HTTP status codes; frontend/admin gracefully handles failures; database errors are logged server-side.

**Patterns:**

- **Authorization failures** (401): Return `{ error: 'Unauthorized' }` if X-Admin-Password header missing or invalid
- **Validation errors** (400): Return `{ error: '[field] required' }` or descriptive message if request body invalid
- **Not found** (404): Return `{ error: 'Not found' }` for missing personas, missing R2 files, or unknown routes
- **Server errors** (500): Catch exceptions, log to console (visible in Cloudflare logs), return `{ error: '[operation] failed' }`
- **Best-effort cleanup**: R2 deletion failures caught and ignored (`.catch(() => {})`) when deleting feed entries to avoid cascading failures

## Cross-Cutting Concerns

**Logging:** Server-side only (no frontend logging). Uses console.error() with `[OnlyDate]` prefix for errors in `apps/onlydate-worker/src/index.ts`. Visible in Cloudflare Worker logs dashboard.

**Validation:** 
- Request body: Try-catch on `c.req.json()` and `c.req.formData()`, explicit null checks on required fields
- Image upload: Check file type (`image/*`), size limit (10 MB)
- Form data: Extract and trim strings, validate presence

**Authentication:** Single shared password in code (`ADMIN_PASSWORD` constant in `apps/onlydate-worker/src/index.ts` line 14). Checked via `isAdmin()` function for all `/admin/*` routes. Header: `X-Admin-Password`.

**CORS:** Permissive wildcard CORS middleware allows all origins, methods (GET, POST, OPTIONS), headers (Content-Type, X-Admin-Password) — set in `app.use('*', ...)` lines 21-27.

---

*Architecture analysis: 2026-04-16*
