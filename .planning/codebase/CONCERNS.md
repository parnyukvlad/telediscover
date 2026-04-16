# Codebase Concerns

**Analysis Date:** 2026-04-16

---

## Security

**[CRITICAL] Hardcoded admin password in source code:**
- Risk: The admin password is committed verbatim as a `const` string in source. Anyone with repo access has the production admin credential. It cannot be rotated without a code deploy. (Exact value redacted from this document — see the file itself at the line below.)
- Files: `apps/onlydate-worker/src/index.ts` lines 13–14
- Current mitigation: None — it is a plain string constant.
- Fix approach: Replace `ADMIN_PASSWORD` constant with `c.env.ADMIN_PASSWORD` (a Cloudflare Worker secret), add `ADMIN_PASSWORD: string` to the `Env` interface, and provision it via `wrangler secret put ADMIN_PASSWORD`. Remove the hardcoded value from source entirely.

**[HIGH] Admin password stored in browser sessionStorage:**
- Risk: The plaintext password is written to `sessionStorage` under key `od_admin_pw` after a successful login. Any JavaScript running on the same origin (XSS, browser extension, devtools) can read it. `sessionStorage` is visible in devtools Application tab — any person with physical access to the browser can retrieve the credential.
- Files: `apps/onlydate/photochoose/index.html` lines 727, 767, 792
- Current mitigation: `sessionStorage` clears on tab close, which limits persistence. The admin panel is deployed under a non-obvious path.
- Fix approach: Store a short-lived session token returned by a login endpoint rather than the raw password. Alternatively, use `httpOnly` cookies via a login exchange, though this requires a stateful session endpoint on the Worker.

**[HIGH] No Telegram webhook signature verification:**
- Risk: The `/webhook/onlydate` endpoint accepts any POST request as a valid Telegram update. A malicious actor can craft arbitrary bot commands, spam the bot, or enumerate chat IDs.
- Files: `apps/onlydate-worker/src/index.ts` lines 704–728
- Current mitigation: None. The endpoint only processes `/start` commands today, limiting immediate impact.
- Fix approach: Validate the `X-Telegram-Bot-Api-Secret-Token` header (set when registering the webhook via `secret_token` parameter) or compute and compare the HMAC-SHA256 of the request body using the bot token. The `BOT_TOKEN` secret is already available as `c.env.BOT_TOKEN`.

**[HIGH] CORS wildcard allows any origin to call admin endpoints:**
- Risk: `Access-Control-Allow-Origin: *` is set globally at line 22. Admin endpoints that require `X-Admin-Password` are accessible from any origin. While the password is still required, this makes CSRF-style attacks from malicious sites easier and eliminates origin-based defense-in-depth.
- Files: `apps/onlydate-worker/src/index.ts` lines 21–27
- Current mitigation: Admin endpoints require the password header.
- Fix approach: Restrict the CORS origin to `https://onlydate.pages.dev` for admin routes; keep wildcard only for the public `/api/onlydate/models*` and `/media/*` endpoints.

**[MEDIUM] No input length or format validation on handle/display_name:**
- Risk: The persona create endpoint accepts arbitrary `display_name` and `handle` values with no length cap, no character allowlist, and no length checks beyond trimming. An oversized payload could stress the D1 index. A handle like `../../etc` could cause unexpected behavior if URLs are constructed from it.
- Files: `apps/onlydate-worker/src/index.ts` lines 574–579
- Current mitigation: D1 prepared statements prevent SQL injection. The UNIQUE constraint on `handle` prevents duplicate handles.
- Fix approach: Add `if (handle.length > 64 || !/^[a-z0-9_]+$/i.test(handle))` guard. Add a `display_name` max-length check (e.g., 128 chars).

**[MEDIUM] No rate limiting on the admin password endpoint:**
- Risk: `POST /api/onlydate/admin/personas` is used as the unlock check. There is no rate limiting, lockout, or delay on incorrect attempts — a brute-force attack against the password is possible.
- Files: `apps/onlydate-worker/src/index.ts` lines 16–18; `apps/onlydate/photochoose/index.html` lines 776–799
- Current mitigation: Cloudflare's WAF may apply basic protection at the edge, but it is not configured in this codebase.
- Fix approach: Move to a Wrangler secret + short-lived token scheme, which reduces the value of repeated attempts. As an interim measure, add exponential backoff on failed auth in the admin frontend.

---

## Tech Debt

**[HIGH] Dual-table architecture with UNION queries throughout:**
- Issue: Active personas come from two entirely separate tables — `personas` (owned by another application, read-only schema) and `onlydate_feed_entries` (owned by this app). Every public query and every admin query uses `UNION ALL` to merge them. The `set-feed-visibility` endpoint must blindly UPDATE both tables because it cannot know which table a given ID lives in.
- Files: `apps/onlydate-worker/src/index.ts` lines 272–296, 319–339, 392–428, 654–659
- Impact: Adding any new field or behavior requires changes to both branches of every UNION. The `toggle-active` endpoint only updates `onlydate_feed_entries` (line 681), silently ignoring `personas` table entries — this asymmetry is a latent bug.
- Fix approach: No clean fix without schema ownership. As mitigation, add an explicit source-type check before any mutation so the wrong table is never silently no-op'd. Document the split in code with explicit `// personas table: read-only` comments.

**[MEDIUM] Hardcoded production URLs in source:**
- Issue: `MEDIA_BASE`, `API_BASE`, and `MINIAPP_URL` are hardcoded strings with no environment-based switching.
- Files: `apps/onlydate-worker/src/index.ts` lines 9, 694; `apps/onlydate/index.html` line 549; `apps/onlydate/photochoose/index.html` line 726
- Impact: Running or testing against a local `wrangler dev` instance requires manually changing these constants. The `wrangler.toml` has `ENVIRONMENT = "production"` set but it is never used.
- Fix approach: Read `MEDIA_BASE` and `MINIAPP_URL` from `c.env` bindings (Cloudflare Worker vars). For the frontend, inject via a build-step variable or a small config block at the top of each HTML file.

**[MEDIUM] Cover upload uses orphaned temp entry_id:**
- Issue: When creating a new persona with an optional cover photo, the admin frontend uploads the cover image to R2 using `entry_id = 'new-' + Date.now()` (a temporary ID) before the persona record is created. The resulting R2 key is `feed-entries/new-{timestamp}/cover-{uuid}.jpg`. If persona creation subsequently fails (e.g., duplicate handle), the uploaded file remains in R2 with no database reference and is never cleaned up.
- Files: `apps/onlydate/photochoose/index.html` lines 1340–1345
- Impact: Orphaned R2 objects accumulate on creation failures. Not immediately harmful but creates storage waste and a cleanup burden.
- Fix approach: Create the `onlydate_feed_entries` record first (without cover), obtain the real UUID, then upload the cover using that UUID as `entry_id`, and finally call `set-cover`. This ensures R2 keys always belong to an existing DB record.

**[LOW] `toggle-active` only operates on `onlydate_feed_entries`, not `personas`:**
- Issue: `POST /api/onlydate/admin/persona/toggle-active` only updates `onlydate_feed_entries.is_active`. If a persona from the `personas` table is passed, the update silently succeeds (0 rows affected) with no error.
- Files: `apps/onlydate-worker/src/index.ts` lines 671–688
- Impact: Admin may believe they toggled a real persona active/inactive with no visible feedback that nothing changed.
- Fix approach: Check the `source` field (which the frontend already tracks) and return a 400/409 if a `personas`-table ID is passed to this endpoint.

---

## Performance

**[HIGH] Complex correlated subqueries execute per-row in the models feed:**
- Issue: `COVER_PHOTO` (lines 201–228) and `HAS_FREE_PHOTO` (lines 231–241) are correlated subqueries that run once per persona row in the `personas` half of the UNION. On a large `personas` table these are effectively N+1 queries inside D1.
- Files: `apps/onlydate-worker/src/index.ts` lines 201–241, 272–296
- Impact: Latency on the `/api/onlydate/models` endpoint scales with the number of active personas. D1 has limited query optimization.
- Fix approach: Materialize a `cover_photo` denormalized column on `onlydate_photo_config` or a separate view. Alternatively, join rather than subquery, and add a composite index on `(media_library.persona_id, media_library.category, media_library.type)`.

**[MEDIUM] `GET /api/onlydate/admin/personas` fetches everything with a hard LIMIT 5000:**
- Issue: The admin endpoint loads all personas and all feed entries in a single query with `LIMIT 5000`, then fetches all feed photos in a second unbounded query. All data is returned in one JSON payload.
- Files: `apps/onlydate-worker/src/index.ts` lines 389–501, especially lines 428–439
- Impact: As the number of personas and photos grows, the response payload and D1 query time will grow unbounded until the hard limit is hit. Cloudflare Workers have a 128 MB memory limit and D1 queries have a 1000 ms CPU time limit.
- Fix approach: Add cursor-based pagination to the admin endpoint. The frontend already performs client-side search filtering, so pagination would require a search API endpoint or pre-loading in pages.

**[LOW] Three parallel fetch calls on mini-app load (trending + popular + new):**
- Issue: `apps/onlydate/index.html` fires three concurrent `fetchModels()` calls at startup (lines 584–593), each hitting `/api/onlydate/models?tab=…`. Each call executes the full UNION query with correlated subqueries.
- Files: `apps/onlydate/index.html` lines 584–593
- Impact: The initial page load triggers three expensive D1 queries simultaneously. Only the `trending` tab is visible initially.
- Fix approach: Lazy-load `popular` and `new` on first tab click rather than eagerly fetching all three on mount.

---

## Fragile Areas

**[HIGH] No database transactions for cascading deletes:**
- Issue: `POST /api/onlydate/admin/feed-entry/delete` deletes photos from R2, then executes two sequential D1 DELETEs — one for `onlydate_feed_photos` and one for `onlydate_feed_entries`. These are not wrapped in a transaction. A failure between the two DELETEs leaves orphaned photo rows in `onlydate_feed_photos` pointing to a deleted feed entry.
- Files: `apps/onlydate-worker/src/index.ts` lines 125–155, specifically 147–148
- Impact: Orphaned rows in `onlydate_feed_photos` accumulate silently. Re-running the delete will attempt to delete non-existent R2 objects (caught by `.catch(() => {})`) but the photo rows remain.
- Fix approach: Use D1's `batch()` API to run both DELETEs atomically, or issue a single `DELETE ... WHERE feed_entry_id = ?` followed by the entry delete within a `try/catch` that logs partial failures explicitly.

**[MEDIUM] Silent R2 deletion failures swallowed everywhere:**
- Issue: Every R2 delete call uses `.catch(() => {})` (lines 116, 143), silently discarding errors. If R2 is unavailable or a key is malformed, the error is invisible in both the response and logs.
- Files: `apps/onlydate-worker/src/index.ts` lines 115–116, 141–144
- Impact: Files accumulate in R2 without any alerting mechanism. There is no reconciliation path to identify stale R2 objects.
- Fix approach: At minimum, log the error: `.catch((err) => console.error('[OnlyDate] R2 delete failed:', key, err))`. For the delete-entry flow, consider returning a partial-success response so the admin knows the DB record was deleted but R2 cleanup may be incomplete.

**[MEDIUM] No foreign key constraint on `onlydate_feed_photos.feed_entry_id`:**
- Issue: The migration at `migrations/0003_feed_photos.sql` does not define a `FOREIGN KEY (feed_entry_id) REFERENCES onlydate_feed_entries(id)`. D1 SQLite supports foreign keys, but they are opt-in per connection (`PRAGMA foreign_keys = ON`) and not enforced here.
- Files: `apps/onlydate-worker/migrations/0003_feed_photos.sql`
- Impact: Photo rows can exist for non-existent feed entries, and deleting a feed entry does not cascade to its photos at the DB level (only the application handles this).
- Fix approach: Add the FK constraint in a new migration (D1 requires `PRAGMA foreign_keys = ON` to enforce it, which requires setting it in each D1 request context — currently not done).

**[LOW] `feedFilter()` constructs SQL fragment from an unchecked string argument:**
- Issue: The `alias` parameter to `feedFilter(alias, mode)` is interpolated directly into a SQL fragment (`${alias}.feed_visible`). All call sites use string literals (`'p'`, `'fe'`) so there is no immediate injection risk, but the pattern is unsafe if call sites change.
- Files: `apps/onlydate-worker/src/index.ts` lines 190–194
- Impact: Low risk today; becomes a concern if the function is reused with dynamic alias values.
- Fix approach: Accept an allowlist enum (`'p' | 'fe'`) for the alias parameter in TypeScript, enforced by the type system.

---

## Test Coverage

**[CRITICAL] Zero automated tests exist:**
- What's not tested: Every API endpoint, every SQL query, every admin operation, authentication logic, webhook handling, R2 upload/delete flows, CORS behavior, and all frontend interaction logic.
- Files: No `*.test.*` or `*.spec.*` files anywhere in the repository. No test runner (`jest`, `vitest`, `@cloudflare/vitest-pool-workers`) is listed in any `package.json`.
- Risk: Any change to `apps/onlydate-worker/src/index.ts` or either HTML file can silently break production behavior. The dual-table UNION logic, cover photo fallback subqueries, and cascading delete sequence are all complex enough to have subtle edge-case bugs that only tests would catch.
- Priority: High
- Fix approach: Add `vitest` and `@cloudflare/vitest-pool-workers` to `apps/onlydate-worker`. Write unit tests for `isAdmin`, `getFeedMode`, `feedFilter`, and the COVER_PHOTO/HAS_FREE_PHOTO SQL fragments. Add integration tests for the delete cascade, the upload flow, and auth rejection.

---

## Incomplete Features

**[MEDIUM] Feed entry photos have no public profile page exposure:**
- Problem: The `GET /api/onlydate/models/:username` endpoint (lines 342–379) fetches `free_photos` from `media_library`/`media_files` — the legacy table structure — but makes no attempt to fetch `onlydate_feed_photos` for feed-entry personas. A feed entry persona's gallery photos uploaded via the admin panel are never shown to end users on the profile page.
- Files: `apps/onlydate-worker/src/index.ts` lines 342–379
- Blocks: Feed entry personas always show "No photos available" in the public Mini App profile view, even after an admin uploads gallery photos.
- Fix approach: In the profile endpoint, detect whether the resolved persona's ID exists in `onlydate_feed_entries`, and if so, query `onlydate_feed_photos` instead of (or in addition to) `media_library`.

**[LOW] Webhook only handles `/start`, no other commands:**
- Problem: The Telegram webhook at `/webhook/onlydate` handles only the `/start` command (line 714). Any other message or update type (inline queries, callback queries, other commands) is silently ignored with `{ ok: true }`.
- Files: `apps/onlydate-worker/src/index.ts` lines 704–728
- Blocks: No help command, no error response to unexpected messages.
- Fix approach: Either document that the bot is intentionally /start-only, or add a fallback message handler.

---

*Concerns audit: 2026-04-16*
