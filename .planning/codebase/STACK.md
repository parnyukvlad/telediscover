# Technology Stack

**Analysis Date:** 2026-04-16

## Languages

**Primary:**
- TypeScript 5.9.3 - Backend worker code and type definitions
- JavaScript - Frontend HTML/JS in `apps/onlydate/`

## Runtime

**Environment:**
- Cloudflare Workers (Node.js compatibility enabled via `compatibility_flags = ["nodejs_compat"]`)
- Targets ES2021 (compilation target)

**Package Manager:**
- pnpm 9.0.0 - Workspace and dependency management
- Lockfile: `pnpm-lock.yaml` (present and tracked)

## Frameworks

**Core Backend:**
- Hono 4.12.8 - Lightweight HTTP framework for Cloudflare Workers
  - Used for routing, middleware, CORS handling in `apps/onlydate-worker/src/index.ts`
  - API endpoints for models, admin operations, Telegram webhooks

**Frontend:**
- Vanilla JavaScript with Telegram Web App SDK
  - No build tool/bundler (static HTML served directly)
  - Hosted on Cloudflare Pages

**Build/Dev:**
- Wrangler 4.75.0 - Cloudflare Workers CLI
  - Local dev: `wrangler dev`
  - Deployment: `wrangler deploy`
  - Config: `apps/onlydate-worker/wrangler.toml`

- TypeScript compiler 5.4.0+ - For type checking
  - Command: `tsc --noEmit` (no emit, type checking only)

## Key Dependencies

**Critical:**
- Hono 4.12.8 - Handles all HTTP routing, middleware (CORS), request/response parsing
- @cloudflare/workers-types 4.20260317.1 - Type definitions for Cloudflare Workers APIs
  - Includes D1Database, R2Bucket types used throughout `src/index.ts`

**Infrastructure:**
- wrangler 4.75.0 - Cloudflare deployment and local development
- typescript 5.9.3 - Type safety and development tooling

## Configuration

**Environment:**
- Single environment variable: `ENVIRONMENT = "production"` (set in wrangler.toml)
- Bindings configured in `wrangler.toml` (database, storage, secrets injected at runtime)
- Admin password hardcoded in `src/index.ts` (line 14): validated via `X-Admin-Password` header
- No `.env` file in repository; secrets managed via Cloudflare dashboard

**Build:**
- `apps/onlydate-worker/tsconfig.json` - TypeScript configuration
  - `target: ES2021`
  - `moduleResolution: bundler`
  - `strict: true` for type safety
  - Includes `@cloudflare/workers-types`

- `apps/onlydate-worker/wrangler.toml` - Cloudflare Workers configuration
  - Compatibility date: 2024-05-01
  - Bindings for D1 (read-only prod database), R2 (media storage)

## Platform Requirements

**Development:**
- Node.js 18+ (per wrangler requirements)
- pnpm 9.0.0
- Cloudflare account with API token for deployment

**Production:**
- Cloudflare Workers platform
- Cloudflare D1 (SQLite database)
- Cloudflare R2 (object storage for media)
- Cloudflare Pages (frontend hosting)
- Telegram Bot API (external dependency for webhook integration)

## Deployment

**Worker Deployment:**
- Method: `wrangler deploy` via CLI
- Target: Cloudflare Workers (serverless)
- Root script: `src/index.ts`

**Pages Deployment:**
- Method: `wrangler pages deploy apps/onlydate --project-name onlydate`
- Target: Cloudflare Pages (static site + SPAs)
- Entrypoint: `apps/onlydate/index.html`

**CI/CD:**
- Manual deployment via npm scripts in root `package.json`
- Scripts parse Cloudflare credentials from `.env.cloudflare` and pass to wrangler
- No GitHub Actions or external CI detected

---

*Stack analysis: 2026-04-16*
