# Directory Structure

**Analysis Date:** 2026-04-16

## High-Level Layout

```
onlydate/
├── apps/                         # pnpm workspace packages
│   ├── onlydate/                 # Static frontend (Cloudflare Pages)
│   │   ├── index.html            # Main Telegram Web App entry point
│   │   └── photochoose/
│   │       └── index.html        # Admin UI (password-gated)
│   └── onlydate-worker/          # Cloudflare Worker (backend API)
│       ├── src/
│       │   └── index.ts          # All API routes (Hono monolith)
│       ├── migrations/
│       │   ├── 0001_feed_visibility.sql
│       │   ├── 0002_feed_entries.sql
│       │   └── 0003_feed_photos.sql
│       ├── package.json
│       ├── tsconfig.json
│       └── wrangler.toml         # Worker config, bindings (D1, R2)
├── models/                       # Media assets, one dir per Instagram-style handle
│   ├── @denisirks/               # Photos (.jpg/.png/.mp4)
│   ├── @maxtozik/
│   ├── @mayseedsoficial/
│   ├── @missmiatorres/
│   └── @rosieriderofficial/
├── AGENTS.md                     # Project-specific AI agent notes
├── package.json                  # Root scripts (deploy:worker, deploy:pages, typecheck)
├── pnpm-workspace.yaml           # `packages: ['apps/*']`
├── pnpm-lock.yaml
└── screen.jpg                    # Miscellaneous image at repo root
```

## Workspace Composition

pnpm workspace with two packages under `apps/*`:

| Package | Type | Deploy Target | Entry Point |
|---------|------|---------------|-------------|
| `onlydate` | Static site | Cloudflare Pages | `apps/onlydate/index.html` |
| `onlydate-worker` | CF Worker | Cloudflare Workers | `apps/onlydate-worker/src/index.ts` |

Note: `models/` is NOT a workspace package — it's raw asset storage, likely intended to be migrated to R2 (evidence: R2 photo upload feature added in recent commits).

## Key Locations

### Backend (onlydate-worker)

- **All HTTP routes:** `apps/onlydate-worker/src/index.ts` (single file, Hono app)
- **Database migrations:** `apps/onlydate-worker/migrations/` (numbered SQL files)
- **Worker config:** `apps/onlydate-worker/wrangler.toml` (bindings: D1 database, R2 bucket)
- **TypeScript config:** `apps/onlydate-worker/tsconfig.json` (strict, ES2021, bundler module resolution)

### Frontend

- **Telegram Web App (user-facing):** `apps/onlydate/index.html`
- **Admin UI (photochoose):** `apps/onlydate/photochoose/index.html`
  - Password-gated (password stored in browser localStorage after entry)
  - Sends `X-Admin-Password` header to backend admin endpoints

### Assets

- **Per-persona media folders:** `models/@<handle>/` containing `.jpg`, `.png`, `.mp4`
- **Handle naming:** Prefixed with `@`, lowercase (matches Instagram/Telegram handle style)

## Naming Conventions

### Files
- TypeScript: `.ts` (backend only, no `.tsx`)
- HTML entry points: `index.html`
- SQL migrations: `NNNN_description.sql` (4-digit zero-padded prefix)
- Media: free-form (handled as opaque blobs)

### Directories
- App packages: kebab-case (`onlydate-worker`)
- Media handles: `@handle-lowercase`
- Feature subdirs inside apps: lowercase, no separators (`photochoose/`)

### Database Tables (inferred from recent commits)
- `personas` — original table (legacy)
- `onlydate_feed_entries` — newer feed table (current source of truth for persona creation)
- Dual-table design is acknowledged tech debt (see `CONCERNS.md`)

## Entry Points Summary

| Role | File | Trigger |
|------|------|---------|
| User-facing mini-app | `apps/onlydate/index.html` | Opened from Telegram bot |
| Admin dashboard | `apps/onlydate/photochoose/index.html` | Direct URL + password |
| Backend API | `apps/onlydate-worker/src/index.ts` | HTTP requests (Hono routing) |
| Telegram webhook | Same file, `/webhook` route (assumed from INTEGRATIONS.md) | Telegram bot events |

## Build Artifacts

- **No build output checked in** — TypeScript compiles to Workers runtime via wrangler
- **`node_modules/`** present (pnpm-managed, gitignored)
- **No `dist/` or `build/` dir** — wrangler handles bundling at deploy time

## Notable Absences

- No `src/` at repo root — all source lives under `apps/*`
- No `shared/` or `packages/` for code reuse between apps (frontend and backend share nothing)
- No TypeScript in `apps/onlydate/` (frontend is vanilla JS inlined in HTML)
- No `tests/` directory anywhere (see `TESTING.md`)
- No `.github/` workflows (no CI)

---

*Structure analysis: 2026-04-16*
