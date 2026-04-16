# External Integrations

**Analysis Date:** 2026-04-16

## APIs & External Services

**Telegram Bot API:**
- Service: @onlydatebot Telegram bot
- What it's used for: Sending welcome messages and opening Telegram Mini App
- SDK/Client: Native `fetch()` calls to `https://api.telegram.org/bot{token}/{method}`
- Auth: `BOT_TOKEN` environment variable (injected by Cloudflare Workers secret)
- Endpoint location: `apps/onlydate-worker/src/index.ts` lines 704-728
- Usage: Webhook receiver at `POST /webhook/onlydate` for `/start` command handling
- Message sending: Inline keyboard with web_app link to `https://onlydate.pages.dev`

## Data Storage

**Databases:**
- **Cloudflare D1 (SQLite)**
  - Binding: `DB` in wrangler.toml
  - Database name: `telegram-saas-db`
  - Database ID: `a5ecae6f-2448-4770-b134-2ce77fa987b4`
  - Mode: Read-only access for public discovery endpoints
  - Access: `c.env.DB` in Hono context (type: `D1Database`)
  - Tables accessed:
    - `personas` - Main persona profiles with visibility controls
    - `media_library` - Photo/media records
    - `media_files` - File URLs and metadata
    - `onlydate_photo_config` - Photo visibility and cover photo settings
    - `onlydate_feed_entries` - Manual feed entries (separate from personas)
    - `onlydate_feed_photos` - Gallery photos for feed entries
    - `message_history` - Message counts for trending calculations
    - `app_settings` - Global settings (feed_mode: 'all' or 'selected')

**File Storage:**
- **Cloudflare R2**
  - Binding: `MEDIA` in wrangler.toml
  - Bucket name: `onlydate`
  - Public URL base: `https://onlydate-api.tg-saas.workers.dev/media` (served via worker)
  - Access: `c.env.MEDIA` in Hono context (type: `R2Bucket`)
  - File path pattern: `feed-entries/{entry_id}/{context}-{uuid}.{ext}`
    - Contexts: `cover` (entry cover), `gallery` (entry gallery photos)
    - Extensions: png, webp, gif, jpg (auto-detected)
  - Upload: `POST /api/onlydate/admin/upload` (multipart/form-data)
  - Serving: `GET /media/*` endpoint with cache headers (`max-age=31536000, immutable`)

**Caching:**
- None detected - direct database and R2 queries without intermediate cache layer

## Authentication & Identity

**Auth Provider:**
- Custom hardcoded password (not production-grade)
  - Admin access: `X-Admin-Password` header validation
  - Password: Stored in plaintext in `src/index.ts` line 14
  - Used for admin endpoints: `/api/onlydate/admin/*` routes

**Telegram Integration:**
- Mini App launched from Telegram bot via web_app deep link
- No formal OAuth or token exchange; Mini App receives `tgWebAppData` from Telegram
- Mini App URL: `https://onlydate.pages.dev`

## Monitoring & Observability

**Error Tracking:**
- None detected - no Sentry, Rollbar, or similar integration

**Logs:**
- Console logging via `console.error()` in error handlers
  - Log prefix: `[OnlyDate]` for easy filtering
  - Locations: All error handlers in `src/index.ts` (lines 69, 97, 119, etc.)
  - Logs available in Cloudflare Workers dashboard

## CI/CD & Deployment

**Hosting:**
- **Cloudflare Workers** - Backend API
  - Project name: `onlydate-api`
  - Compatibility date: 2024-05-01
  - Entry point: `apps/onlydate-worker/src/index.ts`

- **Cloudflare Pages** - Frontend
  - Project name: `onlydate`
  - Deployment branch: `main`
  - Source: `apps/onlydate/` directory
  - Entry point: `index.html`

**CI Pipeline:**
- No GitHub Actions or external CI detected
- Manual deployment via npm scripts
- Deploy script: `npm run deploy` (root package.json)
  - Reads credentials from `.env.cloudflare`
  - Calls `pnpm run deploy:worker` and `pnpm run deploy:pages` in sequence

## Environment Configuration

**Required env vars (runtime secrets):**
- `BOT_TOKEN` - Telegram bot token for webhook integration
  - Used in: `src/index.ts` line 715
  - Where set: Cloudflare Workers secrets (dashboard or `wrangler secret put`)

**Required env vars (configuration):**
- `ENVIRONMENT` - Set to "production" in `wrangler.toml`

**Deployment credentials (in `.env.cloudflare`):**
- `CLOUDFLARE_API_TOKEN` - Account API token for deployments
- `CLOUDFLARE_ACCOUNT_ID` - Cloudflare account ID
- `CLOUDFLARE_EMAIL` - Account email
- Note: `.env.cloudflare` is listed in `.gitignore`, not committed

**Secrets location:**
- Runtime secrets: Cloudflare Workers dashboard → Settings → Variables & Secrets
- Deployment credentials: Local `.env.cloudflare` file (not committed)
- Admin password: Hardcoded in source (lines 14, 17) - should be moved to secrets

## Webhooks & Callbacks

**Incoming:**
- `POST /webhook/onlydate` - Telegram webhook receiver
  - Receives Telegram update objects when bot receives `/start` command
  - Triggers: `tgSend()` function to send welcome message with mini app link
  - Implementation: `src/index.ts` lines 704-728

**Outgoing:**
- Telegram Bot API calls via `tgSend()` helper
  - Endpoint: `https://api.telegram.org/bot{BOT_TOKEN}/sendMessage`
  - Method: `POST` with JSON body
  - Triggers: When Telegram webhook receives `/start` command
  - Sends: Formatted welcome message with inline keyboard + web_app link
  - Implementation: `src/index.ts` lines 696-702

## Data Flow Summary

1. **Public Discovery Flow:**
   - User opens Mini App from Telegram
   - Frontend fetches `GET /api/onlydate/models?tab={trending|popular|new}`
   - Worker queries `personas` and `onlydate_feed_entries` tables
   - Filters by visibility settings (`feed_visible`, global feed_mode)
   - Constructs cover photo from `COVER_PHOTO` subquery (prefers admin-set, falls back to oldest)
   - Returns 100 results ordered by message count or creation date

2. **Profile View Flow:**
   - User clicks model card
   - Frontend fetches `GET /api/onlydate/models/{username}`
   - Worker unions `personas` and `onlydate_feed_entries` tables on handle
   - Returns profile + free photo URLs from `media_library` and `onlydate_feed_photos`
   - Frontend loads photos from R2 via `https://onlydate-api.tg-saas.workers.dev/media/*`

3. **Admin Panel Flow:**
   - Admin requests `GET /api/onlydate/admin/personas` with `X-Admin-Password` header
   - Worker returns all personas + photos grouped by ID
   - Includes feed entry photos from `onlydate_feed_photos` table
   - Admin can: toggle visibility, set cover, upload photos, manage feed entries

---

*Integration audit: 2026-04-16*
