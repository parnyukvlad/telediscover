# Code Conventions

**Analysis Date:** 2026-04-16

## Overview

Conventions are **informal** — no ESLint, Prettier, Biome, or `.editorconfig` detected. Style is enforced by hand and is consistent within each file but varies between backend (`index.ts`) and frontend (`index.html`). TypeScript strict mode is the only formal quality gate.

## TypeScript / Backend (`apps/onlydate-worker/src/index.ts`)

### Compiler Configuration

From `apps/onlydate-worker/tsconfig.json`:
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
  ```ts
  let body: { feed_entry_id?: string; file_url?: string; file_key?: string; sort_order?: number };
  ```
- **`Env` interface** at top of file declares all Worker bindings (`DB`, `BOT_TOKEN`, `MEDIA`)
- `Hono<{ Bindings: Env }>()` makes bindings type-safe in handlers

### Route Handler Pattern

Every handler in `apps/onlydate-worker/src/index.ts` follows the same shape:

```ts
app.post('/api/onlydate/admin/<resource>', async (c) => {
  if (!isAdmin(c)) return c.json({ error: 'Unauthorized' }, 401);

  let body: { ... };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Bad JSON' }, 400); }
  if (!body.required) return c.json({ error: 'required fields' }, 400);

  try {
    await c.env.DB.prepare(`SQL`).bind(...).run();
    return c.json({ ok: true });
  } catch (err) {
    console.error('[OnlyDate] <op> error:', err);
    return c.json({ error: 'Failed' }, 500);
  }
});
```

Consistent across all ~20+ routes. Noted deviations (none significant so far).

### Response Shapes

- **Success:** `{ ok: true, ...fields }` or `{ items: [...] }`
- **Error:** `{ error: string }` with HTTP status code

Shapes are **not** centralized into helper functions — returned inline as object literals.

### Error Handling

- Every route body wrapped in `try/catch`
- Catch block pattern: `console.error('[OnlyDate] <route> error:', err);` then `return c.json({ error: 'Generic' }, 500);`
- `[OnlyDate]` log prefix is the convention for server logs
- Failures to R2 during delete are **swallowed** with `.catch(() => {})` — see `apps/onlydate-worker/src/index.ts:116` (noted as a concern in `CONCERNS.md`)

### Database Patterns

- Always use parameterized queries via `c.env.DB.prepare('SQL WHERE x = ?').bind(val)`
- No string interpolation into SQL
- Template literal SQL with multiline formatting:
  ```ts
  await c.env.DB.prepare(`
    INSERT INTO onlydate_feed_photos (id, feed_entry_id, file_key, file_url, sort_order, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(id, body.feed_entry_id, body.file_key, body.file_url, order, now).run();
  ```
- IDs generated server-side with `crypto.randomUUID()`
- Timestamps use `Date.now()` (Unix milliseconds)

### Section Dividers

Code organized with emoji-free box-drawing comments:

```ts
// ─── Admin: upload image to R2 ────────────────────────────────────────────────
```

Widely used — makes large single-file worker navigable.

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
  ```ts
  // ─── Admin: upload image to R2 ──────────
  // POST /api/onlydate/admin/upload
  // multipart/form-data: file (image/*), context? ('cover'|'gallery'), entry_id?
  app.post(...)
  ```
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

1. **Backend route:** match the existing `try/catch` + `isAdmin` + `{ ok: true }` / `{ error }` pattern
2. **Log prefix:** always `[OnlyDate]` in `console.error`
3. **SQL:** parameterized, `prepare().bind().run()`, snake_case columns
4. **IDs / timestamps:** `crypto.randomUUID()`, `Date.now()`
5. **Section comment:** add `// ─── Name ───` divider before each new route
6. **No external helpers:** inline small validations rather than extracting shared helpers (codebase strongly prefers inline code)

---

*Conventions analysis: 2026-04-16*
