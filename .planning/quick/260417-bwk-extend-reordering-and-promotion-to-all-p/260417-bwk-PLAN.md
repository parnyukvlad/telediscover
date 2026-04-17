---
phase: quick
plan: 260417-bwk
type: execute
wave: 1
depends_on: []
files_modified:
  - apps/onlydate-worker/migrations/0006_persona_config.sql
  - apps/onlydate-worker/src/routes/admin.ts
  - apps/onlydate-worker/src/routes/public.ts
  - apps/onlydate/photochoose/index.html
autonomous: true
requirements: []
must_haves:
  truths:
    - "Dragging a persona (source='personas') in the admin list saves a new sort_order for it"
    - "Clicking Promote on a persona (source='personas') saves is_promoted=1 for it"
    - "Public feed orders all items (personas + feed_entries) by their effective sort_order and is_promoted"
    - "No 'Legacy Personas (read-only)' divider appears; all rows have a drag handle and Promote button"
  artifacts:
    - path: "apps/onlydate-worker/migrations/0006_persona_config.sql"
      provides: "onlydate_persona_config table (persona_id PK, sort_order, is_promoted)"
    - path: "apps/onlydate-worker/src/routes/admin.ts"
      provides: "Updated reorder + toggle-promoted to UPSERT into onlydate_persona_config for personas; updated GET /admin/personas to JOIN onlydate_persona_config"
    - path: "apps/onlydate-worker/src/routes/public.ts"
      provides: "Updated personas subquery LEFT JOINs onlydate_persona_config for real sort_order and is_promoted"
    - path: "apps/onlydate/photochoose/index.html"
      provides: "All rows get drag handle and Promote button; divider and filter removed"
  key_links:
    - from: "photochoose/index.html reorder call"
      to: "POST /api/onlydate/admin/feed-entries/reorder"
      via: "fetch with full id array (personas + feed_entries mixed)"
    - from: "admin.ts reorder handler"
      to: "onlydate_persona_config"
      via: "UPSERT when id not found in onlydate_feed_entries"
    - from: "public.ts personas subquery"
      to: "onlydate_persona_config"
      via: "LEFT JOIN on persona_id"
---

<objective>
Extend drag-drop reordering and Promote toggle to ALL personas (source='personas') by persisting their state in a new `onlydate_persona_config` table, without touching the read-only `personas` table.

Purpose: Currently ordering and promotion only work for feed_entries. All live profiles are personas — so the feature is effectively disabled.
Output: Migration, updated backend endpoints, updated public feed query, updated admin UI.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/STATE.md
@apps/onlydate-worker/src/routes/admin.ts
@apps/onlydate-worker/src/routes/public.ts
@apps/onlydate/photochoose/index.html
</context>

<tasks>

<task type="auto">
  <name>Task 1: Migration — create onlydate_persona_config table</name>
  <files>apps/onlydate-worker/migrations/0006_persona_config.sql</files>
  <action>
Create file `apps/onlydate-worker/migrations/0006_persona_config.sql`:

```sql
CREATE TABLE IF NOT EXISTS onlydate_persona_config (
  persona_id  TEXT    PRIMARY KEY,
  sort_order  INTEGER NOT NULL DEFAULT 9999999,
  is_promoted INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL DEFAULT 0
);
```

No other changes. Forward-only, idempotent (`IF NOT EXISTS`).
  </action>
  <verify>File exists and contains the CREATE TABLE statement. Run: `cat apps/onlydate-worker/migrations/0006_persona_config.sql`</verify>
  <done>Migration file present with correct schema.</done>
</task>

<task type="auto">
  <name>Task 2: Backend — wire onlydate_persona_config into admin and public routes</name>
  <files>
    apps/onlydate-worker/src/routes/admin.ts
    apps/onlydate-worker/src/routes/public.ts
  </files>
  <action>
Make three targeted edits. Do NOT restructure or reformat unrelated code.

### admin.ts — edit 1: GET /api/onlydate/admin/personas

In the UNION ALL SQL inside `app.get('/api/onlydate/admin/personas', ...)`, replace the personas branch columns:

```sql
-- BEFORE (lines ~224-226):
      NULL           AS cover_url,
      NULL           AS sort_order,
      0              AS is_promoted
    FROM personas p
    LEFT JOIN media_library ml
```

Replace with:

```sql
      NULL                                                    AS cover_url,
      COALESCE(opc2.sort_order, 9999999)                     AS sort_order,
      COALESCE(opc2.is_promoted, 0)                          AS is_promoted
    FROM personas p
    LEFT JOIN onlydate_persona_config opc2 ON opc2.persona_id = p.id
    LEFT JOIN media_library ml
```

(The alias `opc` is already taken by `onlydate_photo_config`; use `opc2` for `onlydate_persona_config`.)

### admin.ts — edit 2: POST /api/onlydate/admin/feed-entries/reorder

Replace the handler body (inside the `try` block) so it detects which table each ID belongs to:

```typescript
  try {
    // Split ids: fetch which belong to feed_entries vs personas
    const placeholders = body.order.map(() => '?').join(',');
    const existing = await c.env.DB.prepare(
      `SELECT id FROM onlydate_feed_entries WHERE id IN (${placeholders})`
    ).bind(...body.order).all();
    const feedEntryIds = new Set((existing.results as { id: string }[]).map((r) => r.id));

    const feedStmts    = body.order
      .filter((id) => feedEntryIds.has(id))
      .map((id, _i, arr) => {
        const pos = body.order.indexOf(id) + 1;
        return c.env.DB.prepare('UPDATE onlydate_feed_entries SET sort_order = ? WHERE id = ?').bind(pos, id);
      });

    const personaStmts = body.order
      .filter((id) => !feedEntryIds.has(id))
      .map((id) => {
        const pos = body.order.indexOf(id) + 1;
        return c.env.DB.prepare(`
          INSERT INTO onlydate_persona_config (persona_id, sort_order, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT(persona_id) DO UPDATE SET sort_order = excluded.sort_order, updated_at = excluded.updated_at
        `).bind(id, pos, Date.now());
      });

    if (feedStmts.length + personaStmts.length > 0) {
      await c.env.DB.batch([...feedStmts, ...personaStmts]);
    }
    return c.json({ ok: true });
  } catch (err) {
    console.error('[OnlyDate] reorder error:', err);
    return c.json({ error: 'Failed' }, 500);
  }
```

### admin.ts — edit 3: POST /api/onlydate/admin/feed-entry/toggle-promoted

Replace the handler body so it detects which table to update:

```typescript
  try {
    const inFeed = await c.env.DB.prepare(
      'SELECT id FROM onlydate_feed_entries WHERE id = ?'
    ).bind(body.feed_entry_id).first();

    if (inFeed) {
      await c.env.DB.prepare('UPDATE onlydate_feed_entries SET is_promoted = ? WHERE id = ?')
        .bind(val, body.feed_entry_id).run();
    } else {
      await c.env.DB.prepare(`
        INSERT INTO onlydate_persona_config (persona_id, is_promoted, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(persona_id) DO UPDATE SET is_promoted = excluded.is_promoted, updated_at = excluded.updated_at
      `).bind(body.feed_entry_id, val, Date.now()).run();
    }
    return c.json({ ok: true });
  } catch (err) {
    console.error('[OnlyDate] toggle-promoted error:', err);
    return c.json({ error: 'Failed' }, 500);
  }
```

### public.ts — edit 4: GET /api/onlydate/models personas subquery

Replace the personas branch inside the UNION ALL:

```sql
-- BEFORE:
        0               AS is_promoted,
        9999999         AS sort_order
      FROM personas p
      WHERE ${baseWhere}
```

Replace with:

```sql
        COALESCE(opc2.is_promoted, 0) AS is_promoted,
        COALESCE(opc2.sort_order, 9999999) AS sort_order
      FROM personas p
      LEFT JOIN onlydate_persona_config opc2 ON opc2.persona_id = p.id
      WHERE ${baseWhere}
```

After all edits, run TypeScript check:
`cd apps/onlydate-worker && npx tsc --noEmit`
  </action>
  <verify>
    `cd /c/CodeProjects/onlydate/apps/onlydate-worker && npx tsc --noEmit` exits 0 with no errors.
  </verify>
  <done>TypeScript compiles cleanly. All four SQL/TS edits are in place.</done>
</task>

<task type="auto">
  <name>Task 3: Admin UI — enable drag and Promote for all rows</name>
  <files>apps/onlydate/photochoose/index.html</files>
  <action>
Make four targeted edits to `apps/onlydate/photochoose/index.html`. Do NOT change unrelated code.

### Edit 1: renderPersonaRow — show drag handle and Promote for ALL sources

Find the `renderPersonaRow` function. Locate:

```javascript
  var isFeedEntry = p.source === 'feed_entry';
  var dragHandle  = isFeedEntry
    ? '<div class="drag-handle' + (isSearching ? ' hidden' : '') + '">&#9776;</div>'
    : '';
  var promoBtn = '';
  if (isFeedEntry) {
    var promoCls = p.is_promoted ? 'btn-promo active' : 'btn-promo';
    var promoLabel = p.is_promoted ? 'Promoted' : 'Promote';
    promoBtn = '<button class="' + promoCls + '" data-action="toggle-promoted" ' +
      'data-persona-id="' + escHtml(p.id) + '">' + promoLabel + '</button>';
  }
```

Replace with:

```javascript
  var dragHandle = '<div class="drag-handle' + (isSearching ? ' hidden' : '') + '">&#9776;</div>';
  var promoCls   = p.is_promoted ? 'btn-promo active' : 'btn-promo';
  var promoLabel = p.is_promoted ? 'Promoted' : 'Promote';
  var promoBtn   = '<button class="' + promoCls + '" data-action="toggle-promoted" ' +
    'data-persona-id="' + escHtml(p.id) + '">' + promoLabel + '</button>';
```

### Edit 2: renderPersonaList — merge both groups into one flat sorted list

Find the block that separates feedEntries and legacyPersonas:

```javascript
  // Separate and sort: feed_entries by sort_order, personas by name
  var feedEntries = personas.filter(function (p) { return p.source === 'feed_entry'; })
    .sort(function (a, b) { return (a.sort_order != null ? a.sort_order : 9999) - (b.sort_order != null ? b.sort_order : 9999); });
  var legacyPersonas = personas.filter(function (p) { return p.source !== 'feed_entry'; })
    .sort(function (a, b) { return (a.name || '').localeCompare(b.name || ''); });
```

Replace with:

```javascript
  // Sort all by sort_order ascending (personas now have sort_order from onlydate_persona_config)
  var sorted = personas.slice().sort(function (a, b) {
    var ao = a.sort_order != null ? a.sort_order : 9999999;
    var bo = b.sort_order != null ? b.sort_order : 9999999;
    if (ao !== bo) return ao - bo;
    return (a.name || '').localeCompare(b.name || '');
  });
```

### Edit 3: renderPersonaList — render single flat list, remove divider logic

Find the section that renders feedEntries, then the divider, then legacyPersonas. This block looks like:

```javascript
  var html = '';
  feedEntries.forEach(function (p) { html += renderPersonaRow(p, isSearching); });

  // Divider if both groups exist
  if (feedEntries.length > 0 && legacyPersonas.length > 0) {
    html += '<div class="persona-divider">Legacy Personas (read-only)</div>';
  }

  // Render legacy personas
  legacyPersonas.forEach(function (p) { html += renderPersonaRow(p, isSearching); });
```

Replace with:

```javascript
  var html = '';
  sorted.forEach(function (p) { html += renderPersonaRow(p, isSearching); });
```

### Edit 4: initSortable — remove filter that blocks persona rows

Find in `initSortable()`:

```javascript
    filter: '[data-source="personas"], .persona-divider',
```

Replace with:

```javascript
    filter: '',
```

(Keep the rest of the Sortable config unchanged.)

### Edit 5: initSortable — collect ALL draggable row IDs, not just feed_entry

Find the `onEnd` callback that builds the `ids` array:

```javascript
    onEnd: async function () {
      var ids = [];
      $personaList.querySelectorAll('[data-persona-id]').forEach(function (el) {
```

Look for the filter that selects only feed_entry rows (it may filter by `data-source="feed_entry"`). If such a filter exists, remove it so ALL rows contribute to the reorder array. If the query already collects all `[data-persona-id]` without filtering by source, no change is needed here — verify and leave as-is.
  </action>
  <verify>
    Open `apps/onlydate/photochoose/index.html` in a browser (or inspect source) and confirm:
    1. The string `Legacy Personas (read-only)` does not appear in the file.
    2. `isFeedEntry` variable is gone from `renderPersonaRow`.
    3. `filter: ''` is set in the Sortable config.
    Run: `grep -n "Legacy Personas\|isFeedEntry\|data-source=\"personas\"" apps/onlydate/photochoose/index.html` — should return no matches.
  </verify>
  <done>
    All persona rows in the admin list have a drag handle and Promote button. No "Legacy Personas" divider. Dragging any row (persona or feed_entry) collects a mixed ID array and POSTs to reorder endpoint.
  </done>
</task>

</tasks>

<verification>
After all three tasks:

1. TypeScript compiles: `cd apps/onlydate-worker && npx tsc --noEmit` — exits 0
2. Migration exists: `cat apps/onlydate-worker/migrations/0006_persona_config.sql`
3. No divider string: `grep -n "Legacy Personas" apps/onlydate/photochoose/index.html` — no matches
4. No `isFeedEntry` gating: `grep -n "isFeedEntry" apps/onlydate/photochoose/index.html` — no matches
5. Sortable filter cleared: `grep -n "data-source" apps/onlydate/photochoose/index.html` — only the `data-source` attribute on row elements, not in the filter string
</verification>

<success_criteria>
- Migration `0006_persona_config.sql` exists with correct schema
- `GET /api/onlydate/admin/personas` returns real `sort_order` and `is_promoted` for personas (not NULL/0)
- `POST /api/onlydate/admin/feed-entries/reorder` UPSERTs into `onlydate_persona_config` for persona IDs
- `POST /api/onlydate/admin/feed-entry/toggle-promoted` UPSERTs into `onlydate_persona_config` for persona IDs
- `GET /api/onlydate/models` public feed uses `onlydate_persona_config` sort_order and is_promoted for personas
- Admin UI shows drag handle and Promote button on every row; no read-only divider
- TypeScript compiles with no errors
</success_criteria>

<output>
After completion, create `.planning/quick/260417-bwk-extend-reordering-and-promotion-to-all-p/260417-bwk-SUMMARY.md`
</output>
