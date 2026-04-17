---
type: quick
task_id: 260417-ijz
autonomous: true
files_modified:
  - apps/onlydate-worker/migrations/0008_persona_cover_url.sql
  - apps/onlydate-worker/src/routes/admin.ts
  - apps/onlydate-worker/src/routes/public.ts
  - apps/onlydate/photochoose/index.html
---

<objective>
Add cover_url override for regular personas (source='personas') in the admin panel.

Purpose: Show the pencil edit button for ALL personas, not just feed_entry ones. For personas from the personas table, allow setting a custom cover_url via a new UPSERT endpoint that writes to onlydate_persona_config. Public feed and profile queries prefer this cover_url over the COVER_PHOTO SQL fragment.

Output: Migration 0008, new POST endpoint, updated admin/public queries, updated frontend modal.
</objective>

<context>
@apps/onlydate-worker/src/routes/admin.ts
@apps/onlydate-worker/src/routes/public.ts
@apps/onlydate-worker/src/shared/db.ts
@apps/onlydate/photochoose/index.html
</context>

<tasks>

<task type="auto">
  <name>Task 1: Migration — add cover_url column to onlydate_persona_config</name>
  <files>apps/onlydate-worker/migrations/0008_persona_cover_url.sql</files>
  <action>
Create migration file with:
```sql
ALTER TABLE onlydate_persona_config ADD COLUMN cover_url TEXT;
```

Then apply it remotely:
```
cd apps/onlydate-worker && npx wrangler d1 execute telegram-saas-db --remote --file=migrations/0008_persona_cover_url.sql
```
  </action>
  <verify>
    <automated>cd /C/CodeProjects/onlydate/apps/onlydate-worker && npx wrangler d1 execute telegram-saas-db --remote --command="SELECT cover_url FROM onlydate_persona_config LIMIT 1" 2>&1 | grep -v "error\|Error" || echo "column exists"</automated>
  </verify>
  <done>Migration file exists and column is present in the remote D1 table.</done>
</task>

<task type="auto">
  <name>Task 2: Backend — add set-cover endpoint and update admin/public queries</name>
  <files>apps/onlydate-worker/src/routes/admin.ts, apps/onlydate-worker/src/routes/public.ts</files>
  <action>
**admin.ts — new endpoint (add after the existing promote endpoint, before the persona/create endpoint around line 490):**

Add `POST /api/onlydate/admin/persona/set-cover`:
- Auth guard: `if (!isAdmin(c)) return c.json({ error: 'Unauthorized' }, 401);`
- Parse body: `{ persona_id: string, cover_url: string | null }`
- Validate: if `!body.persona_id` return 400
- UPSERT:
```sql
INSERT INTO onlydate_persona_config (persona_id, cover_url, updated_at)
VALUES (?, ?, ?)
ON CONFLICT(persona_id) DO UPDATE SET cover_url = excluded.cover_url, updated_at = excluded.updated_at
```
  bind: `(body.persona_id, body.cover_url ?? null, Date.now())`
- Return `{ ok: true }`
- Error pattern: `console.error('[OnlyDate] admin/persona/set-cover error:', err)` → `{ error: 'Failed' }` 500

**admin.ts — GET /api/onlydate/admin/personas SQL update:**

In the `personas` UNION branch (around line 310), replace:
```sql
NULL AS cover_url,
```
with:
```sql
COALESCE(opc2.cover_url, NULL) AS cover_url,
```
The `opc2` alias is already joined as `LEFT JOIN onlydate_persona_config opc2 ON opc2.persona_id = p.id` — no new join needed.

**public.ts — GET /api/onlydate/models query:**

In the `personas` branch of the UNION (around line 43-53), the cover is currently `${COVER_PHOTO} AS cover_photo`. Change it to prefer `opc2.cover_url` first:

Replace:
```sql
${COVER_PHOTO}  AS cover_photo,
```
with:
```sql
COALESCE(opc2.cover_url, ${COVER_PHOTO}) AS cover_photo,
```

The `opc2` alias is already joined: `LEFT JOIN onlydate_persona_config opc2 ON opc2.persona_id = p.id` — no new join needed.

**public.ts — GET /api/onlydate/models/:username query:**

In `personaSql` personas branch (around line 96), replace:
```sql
${COVER_PHOTO} AS cover_photo,
```
with:
```sql
COALESCE(pc.cover_url, ${COVER_PHOTO}) AS cover_photo,
```

Add join after `FROM personas p`:
```sql
LEFT JOIN onlydate_persona_config pc ON pc.persona_id = p.id
```
  </action>
  <verify>
    <automated>cd /C/CodeProjects/onlydate/apps/onlydate-worker && npx tsc --noEmit 2>&1; echo "tsc exit: $?"</automated>
  </verify>
  <done>TypeScript compiles without errors. New endpoint exists at POST /api/onlydate/admin/persona/set-cover. Admin personas query returns cover_url from onlydate_persona_config. Public models queries prefer pc.cover_url over COVER_PHOTO subquery.</done>
</task>

<task type="auto">
  <name>Task 3: Frontend — show pencil for all personas, fork modal behavior by source</name>
  <files>apps/onlydate/photochoose/index.html</files>
  <action>
**Step 1 — Show pencil button for ALL personas (line ~1054):**

Replace:
```js
(p.source === 'feed_entry'
  ? '<button class="btn-edit-persona" data-action="edit-persona" data-persona-id="' + escHtml(p.id) + '" title="Edit">&#9998;</button>' +
    '<button class="btn-delete-persona" data-action="delete-persona" data-persona-id="' + escHtml(p.id) + '" title="Delete">&#128465;</button>'
  : '') +
```
with:
```js
'<button class="btn-edit-persona" data-action="edit-persona" data-persona-id="' + escHtml(p.id) + '" title="Edit">&#9998;</button>' +
(p.source === 'feed_entry'
  ? '<button class="btn-delete-persona" data-action="delete-persona" data-persona-id="' + escHtml(p.id) + '" title="Delete">&#128465;</button>'
  : '') +
```

**Step 2 — openEditModal: hide name/handle for personas-type (around line 1605):**

Replace the existing `openEditModal` function with:
```js
function openEditModal(personaId) {
  var persona = allPersonas.find(function (p) { return p.id === personaId; });
  if (!persona) return;
  editingPersonaId         = personaId;
  $editModalName.value     = persona.name || '';
  $editModalHandle.value   = (persona.username || '').replace(/^@/, '');
  $editModalCover.value    = persona.cover_url || '';

  var isFeedEntry = (persona.source === 'feed_entry');
  document.getElementById('edit-modal-name-field').style.display   = isFeedEntry ? '' : 'none';
  document.getElementById('edit-modal-handle-field').style.display = isFeedEntry ? '' : 'none';

  $editModalOverlay.classList.add('open');
  if (isFeedEntry) $editModalName.focus(); else $editModalCover.focus();
}
```

In the HTML edit modal (around line 813), wrap the name and handle fields in divs with the required IDs:
- Wrap `<div class="modal-field">...(Display Name)...</div>` in `<div id="edit-modal-name-field">...</div>`
- Wrap `<div class="modal-field">...(Handle)...</div>` in `<div id="edit-modal-handle-field">...</div>`

**Step 3 — submitEditPersona: fork by source (around line 1633):**

Replace the existing `submitEditPersona` function with:
```js
async function submitEditPersona() {
  if (!editingPersonaId) return;
  var persona = allPersonas.find(function (p) { return p.id === editingPersonaId; });
  if (!persona) return;

  var isFeedEntry = (persona.source === 'feed_entry');
  var cover = $editModalCover.value.trim();

  if (isFeedEntry) {
    var name   = $editModalName.value.trim();
    var handle = $editModalHandle.value.trim().replace(/^@/, '');
    if (!name)   { $editModalName.focus();   showToast('Enter display name'); return; }
    if (!handle) { $editModalHandle.focus(); showToast('Enter handle'); return; }
  }

  $editModalSubmit.disabled    = true;
  $editModalSubmit.textContent = 'Saving\u2026';
  try {
    var res, data;
    if (isFeedEntry) {
      res  = await fetch(API_BASE + '/api/onlydate/admin/feed-entry/update', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Password': password },
        body:    JSON.stringify({ feed_entry_id: editingPersonaId, display_name: $editModalName.value.trim(), handle: $editModalHandle.value.trim().replace(/^@/, ''), cover_url: cover }),
      });
    } else {
      res  = await fetch(API_BASE + '/api/onlydate/admin/persona/set-cover', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Password': password },
        body:    JSON.stringify({ persona_id: editingPersonaId, cover_url: cover || null }),
      });
    }
    data = await res.json();
    if (!res.ok) { showToast(data.error || 'Error saving'); return; }

    // Update in-memory
    if (isFeedEntry) {
      persona.name      = $editModalName.value.trim();
      persona.username  = $editModalHandle.value.trim().replace(/^@/, '');
    }
    persona.cover_url = cover || undefined;

    $editModalOverlay.classList.remove('open');
    editingPersonaId = null;
    renderPersonaList(currentList());
    showToast('Profile updated \u2713');
  } catch {
    showToast('Connection error');
  } finally {
    $editModalSubmit.disabled    = false;
    $editModalSubmit.textContent = 'Save';
  }
}
```

**Step 4 — Rebuild dist:**
```
cd /C/CodeProjects/onlydate && pnpm run minify
```
  </action>
  <verify>
    <automated>grep -n "persona/set-cover" /C/CodeProjects/onlydate/apps/onlydate/photochoose/index.html | head -5</automated>
  </verify>
  <done>Pencil button renders for all personas. openEditModal hides name/handle fields for source='personas'. submitEditPersona calls /api/onlydate/admin/persona/set-cover for personas-type. pnpm run minify completes without error.</done>
</task>

</tasks>

<verification>
1. TypeScript compiles: `cd apps/onlydate-worker && npx tsc --noEmit`
2. Pencil visible for a personas-type row in admin panel (not just feed_entry rows)
3. Clicking pencil on a personas-type row shows only the Cover URL field (name/handle hidden)
4. Saving updates cover_url in onlydate_persona_config — verify via D1: `SELECT * FROM onlydate_persona_config WHERE cover_url IS NOT NULL LIMIT 5`
5. Public /api/onlydate/models returns the custom cover_url for that persona
</verification>

<success_criteria>
- Migration 0008 applied; cover_url column exists in onlydate_persona_config
- POST /api/onlydate/admin/persona/set-cover UPSERTs correctly
- Admin personas list returns cover_url from onlydate_persona_config for personas-type rows
- Public feed query uses COALESCE(opc2.cover_url, COVER_PHOTO subquery)
- Pencil button visible for ALL persona rows in admin panel
- Edit modal shows only Cover URL field for personas-type; name+handle hidden
- Feed entry edit flow unchanged
- pnpm run minify succeeds
</success_criteria>

<output>
After completion, update .planning/STATE.md Quick Tasks Completed table with this task entry.
</output>
