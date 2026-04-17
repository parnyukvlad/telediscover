# Phase 5: Admin — Profile and Image Management - Research

**Researched:** 2026-04-17
**Domain:** Cloudflare Workers admin API, D1 SQLite, browser Canvas API (WebP resize), vanilla JS admin UI, HTML minification
**Confidence:** HIGH (all findings verified against project source code; web research used only for Canvas/WebP gotchas and minification tooling)

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ADMIN-01 | Admin can edit display_name, handle, cover_url on existing feed entries | Needs new PATCH endpoint + edit UI in photochoose; no new DB columns required |
| ADMIN-02 | Admin can hide/unhide profile from public feed (feed_visible toggle) | Endpoint already exists (set-feed-visibility); UI already works; requirement is to confirm no page refresh needed — already satisfied by in-memory update pattern |
| ADMIN-03 | Admin can soft-delete a profile — marked inactive; R2 errors logged not swallowed | toggle-active endpoint exists but only sets is_active=0, doesn't log; existing hard-delete must be augmented; R2 .catch(() => {}) pattern must be changed to log |
| ADMIN-04 | Admin can choose any gallery photo as profile cover | Endpoint set-cover exists; UI exists for feed_entries; requirement already mostly met — need to verify cover_url is updated correctly and reflected on public feed |
| ADMIN-05 | Admin can add gallery photos (extended with client-side resize) | Upload + photo/add endpoints exist; resize is the new work (client-side canvas → WebP before FormData POST) |
| ADMIN-06 | Admin can delete gallery photos with R2 errors surfaced in logs | Endpoint exists but uses .catch(() => {}) silently; fix required: log R2 errors |
| ADMIN-07 | Admin can hide individual gallery photos without deleting | Exists for personas table photos (photo/toggle); NOT implemented for onlydate_feed_photos — needs new column + endpoint + UI |
| PERF-03 | Admin uploads resized client-side to WebP at ≤800px before hitting R2 | Canvas resize pattern in browser; verified feasible; gotchas documented below |
| PERF-04 | Production HTML bundle minified (JS + CSS + HTML) before deploy | html-minifier-terser@7.2.0 available via npx; deploy:pages script needs a pre-minify step |
</phase_requirements>

---

## Summary

Phase 5 extends the existing admin panel with profile metadata editing, soft-delete, gallery photo visibility toggling for feed_entry photos, client-side WebP resize, and HTML minification. The backend router is already modular (Phase 1 complete). The admin credential is already rotated to Wrangler secret.

The biggest gaps are: (1) no endpoint to edit feed entry metadata (display_name, handle, cover_url) — needs a new route; (2) `onlydate_feed_photos` has no `is_hidden` column — needs a D1 migration; (3) R2 deletion errors are silently swallowed in three places — needs logging; (4) client-side canvas resize doesn't exist yet; (5) no HTML minification step in the deploy pipeline.

The existing `toggle-active` endpoint implements soft-delete semantics (`is_active = 0`) but doesn't touch R2 or log errors. The distinction between ADMIN-02 (feed_visible hide/unhide) and ADMIN-03 (soft-delete / is_active) must be preserved — they are different actions with different UX consequences.

**Primary recommendation:** Four units of work — (A) D1 migration for `onlydate_feed_photos.is_hidden`, (B) new backend endpoints (edit metadata, toggle feed_entry photo hidden, fix R2 logging), (C) admin UI additions (edit modal, hide button on feed_entry photos), (D) client-side canvas resize + HTML minification. Plan as 3 waves: Wave 1 = backend + migration, Wave 2 = UI + resize, Wave 3 = minification.

---

## Project Constraints (from CLAUDE.md)

- Stay on Cloudflare Workers + D1 + R2 + vanilla JS frontend. No frontend framework.
- Do not write to the `personas` table — it is read-only.
- Admin password is already rotated to `c.env.ADMIN_PASSWORD` (Wrangler secret) — do not revert.
- No paid external services (Cloudflare Image Resizing is paid — use canvas resize instead).
- Existing Mini App URL structure must not change.
- TypeScript strict mode on the worker. Vanilla JS `'use strict'` on frontend.
- SQL: always parameterized queries via `.bind()`. No string interpolation into SQL.
- Error log prefix: `[OnlyDate]`. Response shapes: `{ ok: true }` or `{ error: string }`.
- R2 key pattern: `feed-entries/{entry_id}/{context}-{uuid}.{ext}`.
- Migration naming: `NNNN_description.sql`, zero-padded, forward-only.

---

## What Already Exists (audit of current code)

### Backend endpoints in `routes/admin.ts` — confirmed by reading source

| Endpoint | Method | Status for Phase 5 |
|----------|--------|--------------------|
| POST /api/onlydate/admin/upload | upload file to R2 | EXISTS — needs resize to happen before this call (client-side) |
| POST /api/onlydate/admin/feed-entry/photo/add | insert into onlydate_feed_photos | EXISTS — no changes needed |
| POST /api/onlydate/admin/feed-entry/photo/delete | delete photo from DB + R2 | EXISTS — R2 .catch(() => {}) must be changed to log |
| POST /api/onlydate/admin/feed-entry/delete | delete entry + all photos | EXISTS — R2 .catch(() => {}) must be changed to log; also satisfies ADMIN-03 partial requirement |
| POST /api/onlydate/admin/feed-entry/set-cover | update cover_url on entry | EXISTS — satisfies ADMIN-04 |
| POST /api/onlydate/admin/persona/set-feed-visibility | feed_visible toggle | EXISTS — satisfies ADMIN-02 |
| POST /api/onlydate/admin/persona/toggle-active | is_active toggle | EXISTS — soft-delete; needs R2 cleanup for photos on deactivation? No — ADMIN-03 says "marks inactive", not "deletes R2". Soft-delete = is_active=0 only. |
| POST /api/onlydate/admin/photo/toggle | toggle is_hidden on onlydate_photo_config | EXISTS — for personas table photos only; NOT for onlydate_feed_photos |
| POST /api/onlydate/admin/photo/cover | set is_cover_for_persona | EXISTS — for personas table photos |
| GET /api/onlydate/admin/personas | fetch all personas | EXISTS |
| POST /api/onlydate/admin/persona/create | create feed entry | EXISTS |
| **MISSING** | edit feed entry metadata | DOES NOT EXIST — needed for ADMIN-01 |
| **MISSING** | toggle is_hidden on onlydate_feed_photos | DOES NOT EXIST — needed for ADMIN-07 |

### Admin UI in `photochoose/index.html` — confirmed by reading source

| Feature | Status |
|---------|--------|
| Persona list with drag-reorder, promote, feed_visible toggle | EXISTS (Phase 4) |
| Delete persona (feed_entry only) | EXISTS |
| Photo grid for feed_entry: upload, set-cover, delete | EXISTS |
| Photo grid for personas: hide/unhide (photo/toggle), set cover | EXISTS |
| **MISSING** | Edit modal for display_name, handle, cover_url (ADMIN-01) |
| **MISSING** | Hide/unhide button on feed_entry gallery photos (ADMIN-07) |
| **MISSING** | Canvas resize before upload (PERF-03) |

### Database schema — confirmed by reading migrations

**`onlydate_feed_entries`** columns: id, display_name, handle, cover_url, is_active, feed_visible, created_at, sort_order, is_promoted
- ADMIN-01: `display_name`, `handle`, `cover_url` are updatable with a PATCH endpoint — no new columns needed.
- ADMIN-02: `feed_visible` — existing endpoint handles this.
- ADMIN-03: `is_active` — soft-delete via existing endpoint; just needs R2 logging fix.

**`onlydate_feed_photos`** columns: id, feed_entry_id, file_key, file_url, sort_order, created_at
- **GAP for ADMIN-07**: No `is_hidden` column exists. Requires a D1 migration: `ALTER TABLE onlydate_feed_photos ADD COLUMN is_hidden INTEGER NOT NULL DEFAULT 0`.

**`onlydate_photo_config`** — used for personas table photos; has `is_hidden`. Not used for feed_entry photos. The feed_photos table needs its own `is_hidden` column.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Hono | 4.12.8 (in use) | HTTP routing for Worker | Already in use |
| @cloudflare/workers-types | 4.20260317.1 (in use) | D1, R2 types | Already in use |
| wrangler | 4.75.0 (in use) | Deploy + migrations | Already in use |

### Build Tooling (new for PERF-04)
| Tool | Version | Purpose | Why Standard |
|------|---------|---------|--------------|
| html-minifier-terser | 7.2.0 (verified via npm view) | Minify HTML/JS/CSS in one pass | Most actively maintained HTML+JS minifier; no build framework needed; runs via npx |

**Verified:** `npm view html-minifier-terser version` → `7.2.0` (2024-01-17 publish date). Replacement for deprecated `html-minifier`.

**Installation (for build step only — not a runtime dep):**
```bash
# Added to root package.json scripts; npx pulls it at build time
# Or install once: pnpm add -D html-minifier-terser --filter onlydate-worker (or root)
```

### No new runtime dependencies
Everything needed is: the browser Canvas API (built-in), D1 (existing binding), R2 (existing binding), Hono (existing). Do not introduce new npm packages in the worker.

---

## Architecture Patterns

### Pattern 1: New Edit Endpoint for Feed Entry Metadata (ADMIN-01)

**What:** `POST /api/onlydate/admin/feed-entry/update` — accepts `{ feed_entry_id, display_name?, handle?, cover_url? }`, updates only the provided fields.

**Why PATCH semantics via POST:** The codebase uses POST everywhere (no PUT/PATCH routes). Consistent with existing patterns.

**Endpoint structure:**
```typescript
// Source: consistent with existing admin.ts patterns
app.post('/api/onlydate/admin/feed-entry/update', async (c) => {
  if (!isAdmin(c)) return c.json({ error: 'Unauthorized' }, 401);
  let body: { feed_entry_id?: string; display_name?: string; handle?: string; cover_url?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Bad JSON' }, 400); }
  if (!body.feed_entry_id) return c.json({ error: 'feed_entry_id required' }, 400);

  const fields: string[] = [];
  const values: unknown[] = [];
  if (body.display_name !== undefined) { fields.push('display_name = ?'); values.push(body.display_name.trim()); }
  if (body.handle      !== undefined) { fields.push('handle = ?');       values.push(body.handle.trim().replace(/^@/, '')); }
  if (body.cover_url   !== undefined) { fields.push('cover_url = ?');    values.push(body.cover_url.trim() || null); }
  if (fields.length === 0) return c.json({ error: 'No fields to update' }, 400);
  values.push(body.feed_entry_id);

  try {
    await c.env.DB.prepare(`UPDATE onlydate_feed_entries SET ${fields.join(', ')} WHERE id = ?`)
      .bind(...values).run();
    return c.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.toLowerCase().includes('unique')) return c.json({ error: 'Handle already exists' }, 409);
    console.error('[OnlyDate] feed-entry/update error:', err);
    return c.json({ error: 'Failed' }, 500);
  }
});
```

**Note on SQL injection safety:** `fields` array is constructed from a string allowlist, not from user input. Only the `values` go through `.bind()`. This is safe.

### Pattern 2: Feed Photo Hidden Toggle (ADMIN-07)

**Requires D1 migration first:**
```sql
-- 0007_feed_photo_hidden.sql
ALTER TABLE onlydate_feed_photos ADD COLUMN is_hidden INTEGER NOT NULL DEFAULT 0;
```

**Endpoint:**
```typescript
// POST /api/onlydate/admin/feed-entry/photo/toggle-hidden
// Body: { photo_id: string, is_hidden: boolean }
app.post('/api/onlydate/admin/feed-entry/photo/toggle-hidden', async (c) => {
  if (!isAdmin(c)) return c.json({ error: 'Unauthorized' }, 401);
  let body: { photo_id?: string; is_hidden?: boolean };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Bad JSON' }, 400); }
  if (!body.photo_id) return c.json({ error: 'photo_id required' }, 400);
  const val = body.is_hidden ? 1 : 0;
  try {
    await c.env.DB.prepare('UPDATE onlydate_feed_photos SET is_hidden = ? WHERE id = ?')
      .bind(val, body.photo_id).run();
    return c.json({ ok: true });
  } catch (err) {
    console.error('[OnlyDate] feed-entry/photo/toggle-hidden error:', err);
    return c.json({ error: 'Failed' }, 500);
  }
});
```

**Public profile endpoint must respect is_hidden:** The `GET /api/onlydate/models/:username` endpoint in `routes/public.ts` currently queries `media_library`/`media_files` for personas table photos but does NOT query `onlydate_feed_photos` at all (CONCERNS.md [MEDIUM] "Feed entry photos have no public profile page exposure"). Phase 5 should fix this: when the resolved persona comes from `onlydate_feed_entries`, query `onlydate_feed_photos WHERE is_hidden = 0` instead of `media_library`.

**Admin list response must include `is_hidden` for feed photos:** The `GET /api/onlydate/admin/personas` endpoint builds `feedPhotos` from `onlydate_feed_photos` but does NOT include `is_hidden`. The fetch query and the in-memory push must both be updated to include `is_hidden`.

### Pattern 3: R2 Deletion Logging (ADMIN-03, ADMIN-06)

**Current (broken) pattern:**
```typescript
await c.env.MEDIA.delete(p.file_key).catch(() => {});  // silent
```

**Fixed pattern:**
```typescript
await c.env.MEDIA.delete(p.file_key).catch((err) =>
  console.error('[OnlyDate] R2 delete failed:', p.file_key, err)
);
```

**Locations to fix in `routes/admin.ts`:**
1. `feed-entry/photo/delete` (line 96) — single photo delete
2. `feed-entry/delete` (line 123 — the `Promise.all` map) — bulk photo delete during entry delete

**Do not change the behavior on the soft-delete path (`toggle-active`)** — that endpoint only sets `is_active = 0` and does not touch R2. This is correct per ADMIN-03: "marks inactive". R2 photos remain available if the entry is reactivated.

### Pattern 4: Client-Side Canvas Resize to WebP (PERF-03)

**How the browser Canvas resize works:**

```javascript
// Source: MDN Canvas API + HTMLCanvasElement.toBlob (HIGH confidence)
async function resizeToWebP(file, maxPx, quality) {
  return new Promise(function (resolve, reject) {
    var img = new Image();
    var url = URL.createObjectURL(file);
    img.onload = function () {
      URL.revokeObjectURL(url);
      var w = img.naturalWidth;
      var h = img.naturalHeight;
      var scale = Math.min(1, maxPx / Math.max(w, h));
      var canvas = document.createElement('canvas');
      canvas.width  = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      var ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(function (blob) {
        if (!blob) { reject(new Error('toBlob failed')); return; }
        resolve(new File([blob], file.name.replace(/\.[^.]+$/, '.webp'), { type: 'image/webp' }));
      }, 'image/webp', quality);
    };
    img.onerror = reject;
    img.src = url;
  });
}
```

**Call site:** Replace the raw `file` passed to `uploadFile()` with `await resizeToWebP(file, 800, 0.85)`.

**Integration points:**
1. `uploadGalleryPhotos()` — called when admin uploads to a feed_entry gallery
2. `submitNewPersona()` — called when admin creates a new persona with a cover photo

**Server-side:** The upload endpoint currently sets `ext` from `file.type`. After client-side resize, the file type will be `image/webp` and the extension will be `webp`. No server changes required — the existing extension detection already handles `image/webp → 'webp'`.

### Pattern 5: HTML Minification (PERF-04)

**Tool:** `html-minifier-terser@7.2.0` (confirmed current via npm registry).

**Recommended approach:** A script that minifies `apps/onlydate/index.html` and `apps/onlydate/photochoose/index.html` to `apps/onlydate-dist/` (or in-place with a pre-deploy script), then deploys from the minified output.

**Minimal script (`scripts/minify.sh`):**
```bash
#!/bin/bash
npx html-minifier-terser \
  --collapse-whitespace \
  --remove-comments \
  --minify-js true \
  --minify-css true \
  --input-dir apps/onlydate \
  --output-dir apps/onlydate-dist \
  --file-ext html
```

**Deploy change:** Update `deploy:pages` in root `package.json` to point at `apps/onlydate-dist` instead of `apps/onlydate`.

**Alternative: in-place with backup** — minify files in place, deploy, then restore from git. This avoids a dist directory but is fragile. Prefer a dist approach.

**Key minifier options that are safe here:**
- `--collapse-whitespace` — safe for inline scripts; whitespace-only text nodes removed
- `--remove-comments` — removes HTML comments; script comments are handled by `--minify-js`
- `--minify-js true` — passes inline `<script>` through terser
- `--minify-css true` — passes inline `<style>` through clean-css
- Do NOT use `--remove-optional-tags` — may break some browsers
- Do NOT use `--collapse-boolean-attributes` — the `<input multiple>` attribute is needed

### Pattern 6: Edit Modal UI (ADMIN-01)

**What needs to be added to photochoose HTML:**
1. An "Edit" button per feed_entry row in the persona list (alongside existing Delete button)
2. A modal dialog (reuse existing modal pattern) with inputs for display_name, handle, cover_url
3. On submit: call the new `/api/onlydate/admin/feed-entry/update` endpoint, update in-memory `allPersonas`, re-render list
4. No page refresh needed — same in-memory update pattern as existing actions

**Edit button placement:** Alongside the delete button in `personaRowHtml()`, shown only for `source === 'feed_entry'`.

### Pattern 7: Admin GET /personas — include is_hidden for feed photos

The `GET /api/onlydate/admin/personas` endpoint fetches feed_photos without `is_hidden`:
```sql
-- Current (missing is_hidden):
SELECT fp.id AS photo_id, fp.feed_entry_id, fp.file_url, fp.file_key, fp.sort_order
FROM onlydate_feed_photos fp ...

-- Updated (after migration adds column):
SELECT fp.id AS photo_id, fp.feed_entry_id, fp.file_url, fp.file_key, fp.sort_order, fp.is_hidden
FROM onlydate_feed_photos fp ...
```

The in-memory push in the personas grouping loop must also include `is_hidden`:
```typescript
// Current:
entry.photos.push({ media_id: ph.id, file_url: ph.file_url, is_hidden: false, is_cover: false });
// Updated:
entry.photos.push({ media_id: ph.id, file_url: ph.file_url, file_key: ph.file_key, is_hidden: ph.is_hidden, is_cover: false });
```

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTML + CSS + JS minification | Custom regex stripper | html-minifier-terser | Handles inline script/style, quote optimization, safe whitespace collapse |
| Image resizing in Worker | WASM library in worker | Client-side Canvas API | Free, no WASM bundle size, no CF paid feature; runs in admin desktop browser |
| DB transactions for cascading delete | Manual try-catch sequence | D1 `batch()` API | Already used in reorder endpoint; ensures atomicity; documented in CONCERNS.md as the fix approach |

**Key insight:** The Worker already uses `D1.batch()` for the reorder endpoint. The feed-entry delete should use the same pattern to make the two DELETEs (photos + entry) atomic.

---

## Common Pitfalls

### Pitfall A: `canvas.toBlob('image/webp')` Returns null in Some Browsers

**What goes wrong:** On Safari older than iOS 16 / macOS Ventura, `canvas.toBlob('image/webp', ...)` silently falls back to PNG (returns a PNG blob with `type: 'image/png'`), not null. The file is larger than expected. On even older browsers it may return null.

**Why it happens:** WebP encoding support via Canvas API was added to Safari 16 (2022). The admin panel is used on desktop — likely Chrome or Firefox — so this is LOW risk in practice. But Safari on admin's macOS is possible.

**How to avoid:** After `canvas.toBlob` resolves, check `blob.type`. If it is not `image/webp`, warn in console but still upload (PNG at ≤800px is still an improvement). Do not fail the upload.

**Warning signs:** Photos uploaded from Safari admin have `.webp` extension but are actually PNG.

**Recommended guard:**
```javascript
canvas.toBlob(function(blob) {
  if (!blob) { reject(new Error('toBlob failed')); return; }
  var type = blob.type || 'image/jpeg';
  var ext  = type === 'image/webp' ? 'webp' : type === 'image/png' ? 'png' : 'jpg';
  resolve(new File([blob], file.name.replace(/\.[^.]+$/, '.' + ext), { type: type }));
}, 'image/webp', 0.85);
```

### Pitfall B: Minifier Breaks SortableJS CDN Script Tag

**What goes wrong:** `html-minifier-terser` with aggressive options can strip `<script src="...">` attributes or mangle the CDN URL if `processScripts` is mis-configured.

**How to avoid:** Use only the flags listed above. Do not use `--process-scripts` or `--remove-script-type-attributes`. The CDN script tag is `<script src="...">` with no `type` attribute — safe.

### Pitfall C: Edit Endpoint Allows Duplicate Handle on UPDATE

**What goes wrong:** `UPDATE onlydate_feed_entries SET handle = ?` where the new handle already belongs to another row. D1 will throw a UNIQUE constraint error.

**How to avoid:** The `feed-entry/update` endpoint already handles this in the Pattern 1 snippet above — catch the UNIQUE error and return 409. The UI should show a toast "Handle already exists" (same as create flow).

### Pitfall D: feed_entry Profile Page Shows No Photos

**What goes wrong:** After ADMIN-07 (hide/unhide gallery photos), the public profile endpoint `GET /api/onlydate/models/:username` still queries `media_library`/`media_files` for all personas — it does not query `onlydate_feed_photos`. So feed_entry personas always show "No photos" even after an admin uploads gallery images.

**This is a pre-existing CONCERNS.md [MEDIUM] issue.** Phase 5 should fix it as part of ADMIN-07 — the profile endpoint must detect whether the persona is from `onlydate_feed_entries` and if so, query `onlydate_feed_photos WHERE is_hidden = 0`.

**Implementation:** After the UNION query resolves a persona, check if its `id` exists in `onlydate_feed_entries`. If yes, run `SELECT file_url FROM onlydate_feed_photos WHERE feed_entry_id = ? AND is_hidden = 0 ORDER BY sort_order ASC, created_at ASC` instead of the `media_library` query.

### Pitfall E: Minification Dist Directory Not Gitignored

**What goes wrong:** The `apps/onlydate-dist/` directory (generated build output) gets committed to git, causing diff noise.

**How to avoid:** Add `apps/onlydate-dist/` to `.gitignore` before creating it. The minified output is a build artifact.

### Pitfall F: R2 Logging Fix Changes Response Semantics

**What goes wrong:** Changing `.catch(() => {})` to `.catch((err) => console.error(...))` is safe — the promise still resolves (logging is not re-throwing). But if someone mistakenly changes it to `.catch((err) => { throw err; })` the delete endpoint would return 500 even after successfully deleting the DB row.

**How to avoid:** Only log in the catch — do not re-throw. The documented fix in CONCERNS.md is explicit: "at minimum, log the error." Keep best-effort semantics, just with visibility.

---

## D1 Migration Required

```sql
-- 0007_feed_photo_hidden.sql
-- Add is_hidden column to onlydate_feed_photos (ADMIN-07)
ALTER TABLE onlydate_feed_photos ADD COLUMN is_hidden INTEGER NOT NULL DEFAULT 0;
```

**Apply:** `wrangler d1 migrations apply telegram-saas-db --remote`

**No other schema changes needed for this phase.** All other requirements are met by existing columns or new endpoints.

---

## Code Examples

### Resize function (frontend, PERF-03)

```javascript
// Source: MDN HTMLCanvasElement.toBlob (HIGH confidence, built-in Web API)
function resizeToWebP(file, maxPx, quality) {
  return new Promise(function (resolve, reject) {
    var img = new Image();
    var url = URL.createObjectURL(file);
    img.onload = function () {
      URL.revokeObjectURL(url);
      var w = img.naturalWidth;
      var h = img.naturalHeight;
      var scale = Math.min(1, maxPx / Math.max(w, h));
      var canvas = document.createElement('canvas');
      canvas.width  = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(function (blob) {
        if (!blob) { reject(new Error('toBlob returned null')); return; }
        var ext = blob.type === 'image/webp' ? 'webp' : blob.type === 'image/png' ? 'png' : 'jpg';
        resolve(new File([blob], file.name.replace(/\.[^.]+$/, '.' + ext), { type: blob.type }));
      }, 'image/webp', quality || 0.85);
    };
    img.onerror = reject;
    img.src = url;
  });
}
```

### D1 batch() for atomic delete (ADMIN-03)

```typescript
// Source: D1 batch() — already used in reorder endpoint (admin.ts line 198)
// Two DELETEs in one atomic operation
await c.env.DB.batch([
  c.env.DB.prepare('DELETE FROM onlydate_feed_photos WHERE feed_entry_id = ?').bind(entryId),
  c.env.DB.prepare('DELETE FROM onlydate_feed_entries WHERE id = ?').bind(entryId),
]);
```

### Minify build script (PERF-04)

```bash
# scripts/minify-html.sh
#!/bin/bash
set -e
mkdir -p apps/onlydate-dist/photochoose
npx html-minifier-terser \
  --collapse-whitespace \
  --remove-comments \
  --minify-js true \
  --minify-css true \
  apps/onlydate/index.html \
  -o apps/onlydate-dist/index.html
npx html-minifier-terser \
  --collapse-whitespace \
  --remove-comments \
  --minify-js true \
  --minify-css true \
  apps/onlydate/photochoose/index.html \
  -o apps/onlydate-dist/photochoose/index.html
# Copy any other static assets (none currently)
echo "Minification complete."
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `html-minifier` (unmaintained) | `html-minifier-terser` (forked, active) | 2021 | Use terser fork — original is abandoned |
| CF Image Resizing for WebP | Client-side canvas toBlob | Project constraint from start | Free; runs in browser; admin desktop context |
| R2 delete `.catch(() => {})` | Log errors in catch | This phase | Visibility without breaking flow |

---

## Open Questions

1. **Should the edit endpoint also update cover_url when a new cover photo is uploaded?**
   - What we know: `set-cover` endpoint already exists for updating `cover_url` from an existing gallery photo URL.
   - What's unclear: The edit modal UI could either (a) let admin type a URL, or (b) show a file picker that uploads + sets cover in one action.
   - Recommendation: Keep it simple — text field for `cover_url` in the edit modal. If admin wants to upload a new cover, they can go to the photo grid and use set-cover. Less surface area.

2. **Should `toggle-active` (soft-delete) also set `feed_visible = 0`?**
   - What we know: Currently it only sets `is_active = 0`. The public feed already excludes rows where `is_active != 1` (WHERE clause in public.ts line 64).
   - Recommendation: No — `is_active = 0` already excludes from public feed. Setting `feed_visible = 0` as well would be redundant and make reactivation more complex (would need to reset both fields).

3. **Does the minified dist directory need any other static files copied?**
   - What we know: The pages deployment currently deploys the entire `apps/onlydate/` directory. There are only two `.html` files; no `.css` or `.js` files separate from the HTML.
   - Recommendation: The minify script just needs to handle the two HTML files. No other assets to copy.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Build scripts, npx | Yes | v24.11.1 | — |
| npx | html-minifier-terser | Yes | 11.6.2 | — |
| html-minifier-terser | PERF-04 | Via npx (no global install needed) | 7.2.0 | — |
| Canvas API | PERF-03 | In admin desktop browser (Chrome/Firefox/Safari 16+) | Built-in | Fallback: upload original at capped 10MB |
| wrangler | D1 migrations | Yes (in devDependencies) | 4.75.0 | — |
| D1 `telegram-saas-db` | All DB ops | Assumed live (Phase 1-4 used it) | — | — |
| R2 `onlydate` bucket | Photo storage | Assumed live | — | — |

**Missing dependencies with no fallback:** None.

**Canvas WebP support caveat:** Safari 16+ supports WebP export from canvas. Safari 15 and below falls back to PNG silently. The admin panel is a desktop tool; if admin uses Chrome or Firefox, WebP encoding is guaranteed. If admin uses Safari < 16, the upload still works (PNG at ≤800px), just not WebP. This is acceptable — Pitfall A handles the graceful fallback.

---

## Validation Architecture

Nyquist validation is enabled per config.json. No existing test infrastructure found (CONCERNS.md [CRITICAL] zero automated tests). The worker has no test runner configured.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | None — zero tests exist (CONCERNS.md [CRITICAL]). Manual smoke tests only for this phase. |
| Config file | None |
| Quick run command | Manual: `wrangler dev` + curl/fetch to test endpoints |
| Full suite command | Manual only |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ADMIN-01 | Update display_name/handle/cover_url | manual smoke | curl POST /api/onlydate/admin/feed-entry/update | No — Wave 0 |
| ADMIN-02 | Hide/unhide from feed (existing) | manual smoke | verify public /models excludes hidden | Existing endpoint |
| ADMIN-03 | Soft-delete marks is_active=0; R2 errors in logs | manual smoke | Check Cloudflare logs after delete | No — Wave 0 |
| ADMIN-04 | Set cover from gallery (existing) | manual smoke | verify cover_url updates on public feed | Existing endpoint |
| ADMIN-05 | Upload resized WebP | manual smoke | Check R2 object metadata shows image/webp | No — Wave 0 |
| ADMIN-06 | Delete photo logs R2 errors | manual smoke | Simulate R2 error, check Cloudflare logs | No — Wave 0 |
| ADMIN-07 | Hide gallery photo; hidden not shown in public profile | manual smoke | Toggle hidden, verify /models/:username excludes it | No — Wave 0 + migration |
| PERF-03 | Uploaded file is WebP ≤800px | manual smoke | Inspect R2 object dimensions/type | No — Wave 0 |
| PERF-04 | HTML bundle minified | manual smoke | `wc -c` before/after; diff character count | No — Wave 0 |

### Sampling Rate
- **Per task commit:** Manual: wrangler dev + curl the affected endpoint
- **Per wave merge:** Manual: exercise full admin UI flow in photochoose + verify public feed
- **Phase gate:** Full manual smoke: create/edit/hide/delete persona, upload photo, verify public feed, check minified bundle size

### Wave 0 Gaps
- [ ] D1 migration `0007_feed_photo_hidden.sql` applied to remote before any feed_photo is_hidden feature is tested
- [ ] `apps/onlydate-dist/` directory created and gitignored before minification script runs
- [ ] No automated test framework — all validation is manual. This is a known gap (CONCERNS.md [CRITICAL]).

*(Automated test infrastructure is out of scope for this phase per REQUIREMENTS.md v2 deferred items.)*

---

## Sources

### Primary (HIGH confidence)
- `apps/onlydate-worker/src/routes/admin.ts` — full source audit, all existing endpoints enumerated
- `apps/onlydate-worker/src/routes/public.ts` — confirmed feed_entry profile photo gap
- `apps/onlydate-worker/migrations/` — all 6 migrations read; schema confirmed
- `apps/onlydate/photochoose/index.html` — full source audit, all existing UI features enumerated
- `.planning/codebase/CONCERNS.md` — R2 silent failures, no transaction, feed_entry photo gap all confirmed
- MDN Canvas API / HTMLCanvasElement.toBlob — HIGH confidence (stable Web API, W3C standard)

### Secondary (MEDIUM confidence)
- `npm view html-minifier-terser version` → 7.2.0 confirmed live
- html-minifier-terser README (documented flags above) — MEDIUM (read from training; verify --input-dir flag syntax before implementing)

### Tertiary (LOW confidence)
- Safari WebP canvas export support floor (iOS 16 / macOS Ventura) — based on training data; MDN compatibility table should be checked before finalizing the fallback decision

---

## Metadata

**Confidence breakdown:**
- Existing endpoint audit: HIGH — read source directly
- Schema gap (is_hidden on feed_photos): HIGH — confirmed column missing from migration
- Canvas WebP resize pattern: HIGH — standard Web API, well-documented
- html-minifier-terser flags: MEDIUM — version confirmed via npm; flag behavior from training data
- Safari WebP support floor: LOW — training data, should verify on MDN before documenting as hard cutoff

**Research date:** 2026-04-17
**Valid until:** 2026-05-17 (stable APIs; html-minifier-terser version check should be re-confirmed before minification task executes)
