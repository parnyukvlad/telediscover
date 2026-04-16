<!-- GSD:project-start source:PROJECT.md -->
## Project

**OnlyDate — Telegram Mini App**

OnlyDate is a Telegram Mini App that showcases a curated feed of model profiles and funnels visitors into one-on-one Telegram chats. Users land from ads, scroll or open a profile, and tap a message icon that deeplinks directly into a DM with the model (`t.me/<handle>`). An admin panel lets the operator control who appears, in what order, and with which photos — without a developer in the loop.

**Core Value:** **Turn an ad click into a Telegram chat in as few taps as possible — and prove it happened, per user, so traffic spend can be optimized.**

### Constraints

- **Budget:** Zero paid external services. PostHog must be self-hosted or on its free tier. — stated constraint.
- **Compatibility:** Existing Mini App URL must keep working. New query params allowed; removing/renaming existing ones is not. — live bot links depend on current URL.
- **Identity:** Telegram `initData` must be validated server-side with the bot token secret before any user-scoped analytics event is trusted. — prevents event forgery.
- **Tech stack:** Stay on Cloudflare Workers + D1 + R2 + vanilla JS frontend. Don't introduce a frontend framework this milestone. — matches existing code and keeps the app tiny.
- **Privacy / content:** Admin password stored in source (`apps/onlydate-worker/src/index.ts:13-14`) and sessionStorage are known security debts — do not make them worse. Ideally rotate out of source during this milestone if a phase touches auth.
- **Persona sources:** `personas` stays read-only. Do not write to it. Do not migrate its rows out. — external app owns its lifecycle.
<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->
## Technology Stack

## Languages
- TypeScript 5.9.3 - Backend worker code and type definitions
- JavaScript - Frontend HTML/JS in `apps/onlydate/`
## Runtime
- Cloudflare Workers (Node.js compatibility enabled via `compatibility_flags = ["nodejs_compat"]`)
- Targets ES2021 (compilation target)
- pnpm 9.0.0 - Workspace and dependency management
- Lockfile: `pnpm-lock.yaml` (present and tracked)
## Frameworks
- Hono 4.12.8 - Lightweight HTTP framework for Cloudflare Workers
- Vanilla JavaScript with Telegram Web App SDK
- Wrangler 4.75.0 - Cloudflare Workers CLI
- TypeScript compiler 5.4.0+ - For type checking
## Key Dependencies
- Hono 4.12.8 - Handles all HTTP routing, middleware (CORS), request/response parsing
- @cloudflare/workers-types 4.20260317.1 - Type definitions for Cloudflare Workers APIs
- wrangler 4.75.0 - Cloudflare deployment and local development
- typescript 5.9.3 - Type safety and development tooling
## Configuration
- Single environment variable: `ENVIRONMENT = "production"` (set in wrangler.toml)
- Bindings configured in `wrangler.toml` (database, storage, secrets injected at runtime)
- Admin password hardcoded in `src/index.ts` (line 14): validated via `X-Admin-Password` header
- No `.env` file in repository; secrets managed via Cloudflare dashboard
- `apps/onlydate-worker/tsconfig.json` - TypeScript configuration
- `apps/onlydate-worker/wrangler.toml` - Cloudflare Workers configuration
## Platform Requirements
- Node.js 18+ (per wrangler requirements)
- pnpm 9.0.0
- Cloudflare account with API token for deployment
- Cloudflare Workers platform
- Cloudflare D1 (SQLite database)
- Cloudflare R2 (object storage for media)
- Cloudflare Pages (frontend hosting)
- Telegram Bot API (external dependency for webhook integration)
## Deployment
- Method: `wrangler deploy` via CLI
- Target: Cloudflare Workers (serverless)
- Root script: `src/index.ts`
- Method: `wrangler pages deploy apps/onlydate --project-name onlydate`
- Target: Cloudflare Pages (static site + SPAs)
- Entrypoint: `apps/onlydate/index.html`
- Manual deployment via npm scripts in root `package.json`
- Scripts parse Cloudflare credentials from `.env.cloudflare` and pass to wrangler
- No GitHub Actions or external CI detected
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

## Overview
## TypeScript / Backend (`apps/onlydate-worker/src/index.ts`)
### Compiler Configuration
- `strict: true` — all strict mode flags enabled
- `target: ES2021`
- `moduleResolution: bundler`
- `@cloudflare/workers-types` in lib
### Module Style
- ES modules, named imports only: `import { Hono } from 'hono';`
- No default exports for framework code
- Single-file worker — all routes live in one `apps/onlydate-worker/src/index.ts` (733 lines)
### Naming
- **Functions:** `camelCase` — `isAdmin(c)`, `getFeedEntries(...)`
- **Constants:** `UPPER_SNAKE_CASE` — `ADMIN_PASSWORD`, `MEDIA_BASE`
- **Types/interfaces:** `PascalCase` — `interface Env { ... }`
- **SQL columns:** `snake_case` — `feed_entry_id`, `file_url`, `created_at`, `sort_order`
- **URL paths:** kebab-case — `/api/onlydate/admin/feed-entry/photo/add`
### Type Patterns
- **Inline anonymous types** for request bodies rather than named interfaces:
- **`Env` interface** at top of file declares all Worker bindings (`DB`, `BOT_TOKEN`, `MEDIA`)
- `Hono<{ Bindings: Env }>()` makes bindings type-safe in handlers
### Route Handler Pattern
### Response Shapes
- **Success:** `{ ok: true, ...fields }` or `{ items: [...] }`
- **Error:** `{ error: string }` with HTTP status code
### Error Handling
- Every route body wrapped in `try/catch`
- Catch block pattern: `console.error('[OnlyDate] <route> error:', err);` then `return c.json({ error: 'Generic' }, 500);`
- `[OnlyDate]` log prefix is the convention for server logs
- Failures to R2 during delete are **swallowed** with `.catch(() => {})` — see `apps/onlydate-worker/src/index.ts:116` (noted as a concern in `CONCERNS.md`)
### Database Patterns
- Always use parameterized queries via `c.env.DB.prepare('SQL WHERE x = ?').bind(val)`
- No string interpolation into SQL
- Template literal SQL with multiline formatting:
- IDs generated server-side with `crypto.randomUUID()`
- Timestamps use `Date.now()` (Unix milliseconds)
### Section Dividers
## Frontend JavaScript (`apps/onlydate/**/*.html`)
### Runtime
- Vanilla JavaScript (no framework, no bundler)
- Scripts inline in `<script>` tags inside `apps/onlydate/index.html` (943 lines) and `apps/onlydate/photochoose/index.html` (1411 lines)
- `'use strict'` at top of script blocks
### Naming
- **DOM refs:** `$` prefix — e.g., `const $list = document.getElementById('list')`
- **Private/internal state:** `_` prefix — `_loading`, `_currentEntry`
- **Constants:** `UPPER_SNAKE_CASE` when truly constant
- **Functions:** `camelCase`
### API Calls
- `fetch()` with `X-Admin-Password` header pulled from `localStorage` (admin UI only)
- Responses always assumed JSON; `await res.json()` then branch on `data.ok` vs `data.error`
### Styling
- CSS inline in `<style>` blocks at top of HTML files
- No CSS framework, no utility classes like Tailwind
- Manual column-alignment style visible in source (spaces used to line up assignments)
## SQL Migrations (`apps/onlydate-worker/migrations/`)
- Numbered prefix: `NNNN_description.sql` (zero-padded, 4 digits)
- Example: `0001_feed_visibility.sql`, `0002_feed_entries.sql`, `0003_feed_photos.sql`
- Forward-only (no down migrations)
- Each migration is idempotent where possible (uses `IF NOT EXISTS`)
## File Organization
- **One route per logical operation**, with section comment and URL docstring:
- Related operations grouped (all admin endpoints together, all public endpoints together)
- No per-route file splitting — monolithic by design
## Absent Conventions (notable gaps)
- No lint config (ESLint, Biome)
- No formatter (Prettier, dprint)
- No pre-commit hooks (no `.husky/`, no lint-staged)
- No shared types package between frontend and backend — response shapes duplicated mentally
- No JSDoc / TypeDoc comments on functions
- No API versioning (`/api/v1/...` not used)
## What To Follow When Adding Code
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

## Pattern Overview
- **Multi-app monorepo** — managed with pnpm workspace
- **Serverless backend** — Cloudflare Worker with D1 SQLite database and R2 object storage
- **Static frontend** — vanilla JavaScript, no build step, deployed as static HTML files
- **Decoupled data sources** — Worker reads from shared legacy database (`personas`, `media_library`) while owning its own tables (`onlydate_feed_entries`, `onlydate_feed_photos`, `onlydate_photo_config`)
- **Telegram integration** — Mini App entry point via @onlydatebot, webhook-based messaging
## Layers
- Purpose: Display browsable grid of AI persona models, render individual profiles, serve Telegram Mini App experience
- Location: `apps/onlydate/index.html`
- Contains: HTML, CSS, vanilla JavaScript (event handlers, grid/profile view management, API calls)
- Depends on: Worker API (`/api/onlydate/models*`), Telegram Web App SDK
- Used by: End users via Telegram client
- Purpose: Manage feed entries, upload/delete photos, control visibility and cover images
- Location: `apps/onlydate/photochoose/index.html`
- Contains: HTML, CSS, vanilla JavaScript (authentication, photo grid, upload handling, visibility toggling)
- Depends on: Worker API (`/api/onlydate/admin/*`), password-based auth header
- Used by: Admin users (password-protected via header `X-Admin-Password`)
- Purpose: Route all HTTP requests, serve media files from R2, manage database state, handle Telegram webhooks
- Location: `apps/onlydate-worker/src/index.ts`
- Contains: Hono middleware, route handlers (REST endpoints + webhook), D1 queries, R2 operations
- Depends on: Cloudflare Bindings (D1, R2, BOT_TOKEN secret), Hono framework
- Used by: Frontend (public), Admin Panel, Telegram bot (webhooks), R2 file serving
- Purpose: Store persona metadata, feed entries, photos, visibility config, app settings
- Binding name: `DB` (D1 SQLite in wrangler.toml)
- Database: `telegram-saas-db` (shared with other applications)
- Owns tables:
- Reads from (shared tables):
- Purpose: Serve uploaded feed entry photos and gallery images
- Binding name: `MEDIA` (R2 bucket in wrangler.toml)
- Bucket: `onlydate`
- Serves via: GET `/media/*` route (publicly readable, 1-year cache)
- Used by: Admin upload, feed entry gallery management
## Data Flow
- **Frontend state:** Minimal — current view (grid/profile), selected tab (trending/popular/new), cached model data in DOM
- **Admin state:** Current password auth (session-less, validates header on each request), lock screen vs. app view
- **Backend state:** All persistent state in D1 (personas, feed entries, photos, visibility config, global settings)
- **Visibility logic:** Feed filter applied at query time, not cached
## Key Abstractions
- Purpose: Display a single representative image per persona/feed_entry
- Pattern: SQL COALESCE with two subqueries
- For personas: Prefers admin-marked cover (onlydate_photo_config.is_cover_for_persona), falls back to oldest visible free photo
- For feed entries: Uses cover_url column directly
- Implementation: `COVER_PHOTO` SQL fragment in `apps/onlydate-worker/src/index.ts` lines 201-228
- Purpose: Control which personas appear in public discovery feed
- Pattern: Dynamic SQL WHERE clause based on feed_mode setting
- Function: `feedFilter(alias, mode)` in `apps/onlydate-worker/src/index.ts` lines 190-194
- Returns: SQL fragment like `fe.feed_visible = 1` or `(fe.feed_visible IS NULL OR fe.feed_visible = 1)`
- Purpose: Serve R2 files via worker with cache headers
- Pattern: Route handler extracts key from path `/media/{key}`, fetches from R2, sets 1-year immutable cache
- Implementation: `app.get('/media/*')` in `apps/onlydate-worker/src/index.ts` lines 34-43
- Purpose: Find visible, price-free photos with optional cover override
- Pattern: Multi-table join (media_library → media_files, with optional onlydate_photo_config)
- Filters: category='casual', price_stars IS NULL OR 0, type='photo', is_hidden IS NULL OR 0
- Used in: `GET /api/onlydate/models/:username` profile endpoint
## Entry Points
- Location: `https://onlydate.pages.dev` (deployed from `apps/onlydate/index.html`)
- Triggers: User opens Mini App via /start command in @onlydatebot
- Responsibilities: 
- Location: `https://onlydate.pages.dev/photochoose` (deployed from `apps/onlydate/photochoose/index.html`)
- Triggers: Manual navigation or direct link
- Responsibilities:
- Location: `POST https://onlydate-api.tg-saas.workers.dev/webhook/onlydate`
- Triggers: Telegram bot forwards user messages
- Responsibilities:
- Entry: `apps/onlydate-worker/src/index.ts` (index.ts is compiled to worker by wrangler)
- Registered routes:
## Error Handling
- **Authorization failures** (401): Return `{ error: 'Unauthorized' }` if X-Admin-Password header missing or invalid
- **Validation errors** (400): Return `{ error: '[field] required' }` or descriptive message if request body invalid
- **Not found** (404): Return `{ error: 'Not found' }` for missing personas, missing R2 files, or unknown routes
- **Server errors** (500): Catch exceptions, log to console (visible in Cloudflare logs), return `{ error: '[operation] failed' }`
- **Best-effort cleanup**: R2 deletion failures caught and ignored (`.catch(() => {})`) when deleting feed entries to avoid cascading failures
## Cross-Cutting Concerns
- Request body: Try-catch on `c.req.json()` and `c.req.formData()`, explicit null checks on required fields
- Image upload: Check file type (`image/*`), size limit (10 MB)
- Form data: Extract and trim strings, validate presence
<!-- GSD:architecture-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd:quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd:debug` for investigation and bug fixing
- `/gsd:execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd:profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
