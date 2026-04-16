# Testing

**Analysis Date:** 2026-04-16

## Current State: **No tests exist**

This codebase has **zero automated test coverage** as of the analysis date.

### Evidence

- **No test files** — glob search for `*.test.*`, `*.spec.*`, `__tests__/`, `tests/` returns nothing under `apps/` or at repo root
- **No test framework dependencies** — `apps/onlydate-worker/package.json` only declares `hono`, `typescript`, `@cloudflare/workers-types`, `wrangler`
- **No test scripts** — root `package.json` has `deploy:worker`, `deploy:pages`, `deploy`, `typecheck` and nothing else
- **No test runner config** — no `vitest.config.ts`, `jest.config.js`, or equivalent
- **No CI** — no `.github/workflows/`, no test-on-push

## What Serves as Quality Gate Today

- **`tsc --noEmit`** (`pnpm typecheck`) — only automated check. Catches type errors but nothing about runtime behavior.
- **Manual testing** — deploy to prod (or wrangler dev) and click through the Telegram Web App and admin UI.
- **`wrangler dev`** — local Workers simulator at `apps/onlydate-worker/`, useful for smoke-testing but no assertions.

## Risks This Creates

- **Feed visibility logic** has non-trivial UNION queries over `personas` and `onlydate_feed_entries` (see `CONCERNS.md`) — one of the most bug-prone areas, entirely untested.
- **Admin authorization** (`isAdmin` check in `apps/onlydate-worker/src/index.ts:16-18`) relies on exact header match. No test guarantees this works for all routes.
- **R2 upload / delete** paths swallow failures silently (`apps/onlydate-worker/src/index.ts:116`). No test confirms cleanup happens under normal conditions.
- **SQL migrations** — no test that post-migration schema matches application expectations.
- **Regression risk** — with 733 lines of route code in one file and recent active refactoring (persona tables, R2 uploads, feed entries), the lack of tests makes safe change impossible to verify without manual repro.

## What Would Need to Be Added

### Worker Unit / Integration Tests

Recommended framework: **`@cloudflare/vitest-pool-workers`**
- Runs Vitest tests inside a real Workers runtime (Miniflare under the hood)
- Provides D1 and R2 binding mocks/fakes
- Supports seeding test DB from migration SQL

Add to `apps/onlydate-worker/package.json`:
```json
{
  "scripts": {
    "test": "vitest"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "...",
    "vitest": "..."
  }
}
```

Create `apps/onlydate-worker/vitest.config.ts` wired to `wrangler.toml` for bindings.

Test targets (priority order):
1. `isAdmin()` — header validation, timing-safe equality (see security concerns)
2. Feed visibility queries — UNION behavior, empty states, pagination
3. Photo upload flow — R2 write + DB insert, failure handling (R2 OK / DB fails, DB OK / R2 fails)
4. Migration idempotency — run migrations twice, schema unchanged
5. Route authorization — every admin route returns 401 without header

### Frontend Tests

Static HTML + inline vanilla JS is hard to unit-test. Options:
- **Playwright** against `wrangler dev` + local static server for end-to-end user flows
- Extract frontend JS into a module if unit tests become valuable — currently not worth it for the project size

### Contract Tests

Shared request/response shapes are undocumented. If a `shared/` package gets introduced for types, add type-level tests (e.g., `expectType<...>()`) to enforce contracts.

## Recommendations

Given the project is actively mutating data models (recent commits refactor personas → feed entries) and has security-sensitive endpoints, **adding at minimum an integration test per admin route** would be the highest-leverage testing investment. Deferring tests until the codebase stabilizes is reasonable, but shipping code changes without any regression safety net is currently the default mode.

---

*Testing analysis: 2026-04-16*
