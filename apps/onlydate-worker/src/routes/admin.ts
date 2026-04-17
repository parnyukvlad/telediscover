import { Hono } from 'hono';
import { isAdmin } from '../shared/auth';
import { MEDIA_BASE } from '../shared/telegram';

interface Env {
  DB: D1Database;
  BOT_TOKEN: string;
  MEDIA: R2Bucket;
  ADMIN_PASSWORD: string;
}

const app = new Hono<{ Bindings: Env }>();

// ─── Feed settings helper ─────────────────────────────────────────────────────
async function getFeedMode(db: D1Database): Promise<'all' | 'selected'> {
  try {
    const row = await db.prepare(`SELECT value FROM app_settings WHERE key = 'feed_mode'`)
      .first() as { value: string } | null;
    return (row?.value === 'selected') ? 'selected' : 'all';
  } catch {
    return 'all';
  }
}

// ─── Admin: upload image to R2 ────────────────────────────────────────────────
// POST /api/onlydate/admin/upload
// multipart/form-data: file (image/*), context? ('cover'|'gallery'), entry_id?
app.post('/api/onlydate/admin/upload', async (c) => {
  if (!isAdmin(c)) return c.json({ error: 'Unauthorized' }, 401);

  let formData: FormData;
  try { formData = await c.req.formData(); } catch { return c.json({ error: 'Bad form data' }, 400); }

  const file = formData.get('file') as File | null;
  if (!file) return c.json({ error: 'file required' }, 400);
  if (!file.type.startsWith('image/')) return c.json({ error: 'Only images allowed' }, 400);
  if (file.size > 10 * 1024 * 1024) return c.json({ error: 'Max 10 MB' }, 400);

  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : file.type === 'image/gif' ? 'gif' : 'jpg';
  const context  = (formData.get('context') as string | null) ?? 'gallery';
  const entryId  = (formData.get('entry_id') as string | null) ?? 'misc';
  const key      = `feed-entries/${entryId}/${context}-${crypto.randomUUID()}.${ext}`;

  try {
    await c.env.MEDIA.put(key, file.stream(), { httpMetadata: { contentType: file.type } });
    const url = `${MEDIA_BASE}/${key}`;
    return c.json({ ok: true, url, key });
  } catch (err) {
    console.error('[OnlyDate] upload error:', err);
    return c.json({ error: 'Upload failed' }, 500);
  }
});

// ─── Admin: add gallery photo to feed entry ──────────────────────────────────
// POST /api/onlydate/admin/feed-entry/photo/add
// Body: { feed_entry_id, file_url, file_key, sort_order? }
app.post('/api/onlydate/admin/feed-entry/photo/add', async (c) => {
  if (!isAdmin(c)) return c.json({ error: 'Unauthorized' }, 401);

  let body: { feed_entry_id?: string; file_url?: string; file_key?: string; sort_order?: number };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Bad JSON' }, 400); }
  if (!body.feed_entry_id || !body.file_url || !body.file_key) {
    return c.json({ error: 'feed_entry_id, file_url, file_key required' }, 400);
  }

  const id    = crypto.randomUUID();
  const order = body.sort_order ?? 0;
  const now   = Date.now();

  try {
    await c.env.DB.prepare(`
      INSERT INTO onlydate_feed_photos (id, feed_entry_id, file_key, file_url, sort_order, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(id, body.feed_entry_id, body.file_key, body.file_url, order, now).run();
    return c.json({ ok: true, photo: { id, file_url: body.file_url, file_key: body.file_key, sort_order: order } });
  } catch (err) {
    console.error('[OnlyDate] feed-entry/photo/add error:', err);
    return c.json({ error: 'Failed' }, 500);
  }
});

// ─── Admin: delete gallery photo from feed entry ─────────────────────────────
// POST /api/onlydate/admin/feed-entry/photo/delete
// Body: { photo_id, file_key }
app.post('/api/onlydate/admin/feed-entry/photo/delete', async (c) => {
  if (!isAdmin(c)) return c.json({ error: 'Unauthorized' }, 401);

  let body: { photo_id?: string; file_key?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Bad JSON' }, 400); }
  if (!body.photo_id) return c.json({ error: 'photo_id required' }, 400);

  try {
    await c.env.DB.prepare(`DELETE FROM onlydate_feed_photos WHERE id = ?`).bind(body.photo_id).run();
    // Also delete from R2 if key provided
    if (body.file_key) {
      await c.env.MEDIA.delete(body.file_key).catch((err) =>
        console.error('[OnlyDate] R2 delete failed:', body.file_key, err)
      );
    }
    return c.json({ ok: true });
  } catch (err) {
    console.error('[OnlyDate] feed-entry/photo/delete error:', err);
    return c.json({ error: 'Failed' }, 500);
  }
});

// ─── Admin: delete feed entry + all its photos ───────────────────────────────
// POST /api/onlydate/admin/feed-entry/delete
// Body: { feed_entry_id }
app.post('/api/onlydate/admin/feed-entry/delete', async (c) => {
  if (!isAdmin(c)) return c.json({ error: 'Unauthorized' }, 401);

  let body: { feed_entry_id?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Bad JSON' }, 400); }
  if (!body.feed_entry_id) return c.json({ error: 'feed_entry_id required' }, 400);

  try {
    // Get all photo keys to delete from R2
    const photos = await c.env.DB.prepare(
      `SELECT file_key FROM onlydate_feed_photos WHERE feed_entry_id = ?`
    ).bind(body.feed_entry_id).all();

    // Delete photos from R2 (best effort — log failures instead of silently swallowing)
    await Promise.all(
      (photos.results as { file_key: string }[]).map((p) =>
        c.env.MEDIA.delete(p.file_key).catch((err) =>
          console.error('[OnlyDate] R2 delete failed:', p.file_key, err)
        )
      )
    );

    // Atomic DB delete: photos first, then entry (D1 batch enforces order)
    await c.env.DB.batch([
      c.env.DB.prepare('DELETE FROM onlydate_feed_photos WHERE feed_entry_id = ?').bind(body.feed_entry_id),
      c.env.DB.prepare('DELETE FROM onlydate_feed_entries WHERE id = ?').bind(body.feed_entry_id),
    ]);

    return c.json({ ok: true });
  } catch (err) {
    console.error('[OnlyDate] feed-entry/delete error:', err);
    return c.json({ error: 'Failed' }, 500);
  }
});

// ─── Admin: update cover for feed entry ──────────────────────────────────────
// POST /api/onlydate/admin/feed-entry/set-cover
// Body: { feed_entry_id, file_url }
app.post('/api/onlydate/admin/feed-entry/set-cover', async (c) => {
  if (!isAdmin(c)) return c.json({ error: 'Unauthorized' }, 401);

  let body: { feed_entry_id?: string; file_url?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Bad JSON' }, 400); }
  if (!body.feed_entry_id || !body.file_url) return c.json({ error: 'feed_entry_id and file_url required' }, 400);

  try {
    await c.env.DB.prepare(`UPDATE onlydate_feed_entries SET cover_url = ? WHERE id = ?`)
      .bind(body.file_url, body.feed_entry_id).run();
    return c.json({ ok: true });
  } catch (err) {
    console.error('[OnlyDate] feed-entry/set-cover error:', err);
    return c.json({ error: 'Failed' }, 500);
  }
});

// ─── Admin: update feed entry metadata ───────────────────────────────────────
// POST /api/onlydate/admin/feed-entry/update
// Body: { feed_entry_id: string, display_name?: string, handle?: string, cover_url?: string }
app.post('/api/onlydate/admin/feed-entry/update', async (c) => {
  if (!isAdmin(c)) return c.json({ error: 'Unauthorized' }, 401);

  let body: { feed_entry_id?: string; display_name?: string; handle?: string; cover_url?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Bad JSON' }, 400); }
  if (!body.feed_entry_id) return c.json({ error: 'feed_entry_id required' }, 400);

  const fields: string[] = [];
  const values: unknown[] = [];
  if (body.display_name !== undefined) { fields.push('display_name = ?'); values.push(body.display_name.trim()); }
  if (body.handle       !== undefined) { fields.push('handle = ?');       values.push(body.handle.trim().replace(/^@/, '')); }
  if (body.cover_url    !== undefined) { fields.push('cover_url = ?');    values.push(body.cover_url.trim() || null); }
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

// ─── Admin: toggle is_hidden on feed entry gallery photo ─────────────────────
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

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/onlydate/admin/feed-entries/reorder
// Body: { order: string[] } — array of feed_entry_id values in desired display order
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/onlydate/admin/feed-entries/reorder', async (c) => {
  if (!isAdmin(c)) return c.json({ error: 'Unauthorized' }, 401);

  let body: { order?: string[] };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Bad JSON' }, 400); }
  if (!Array.isArray(body.order) || body.order.length === 0) {
    return c.json({ error: 'order must be a non-empty array' }, 400);
  }

  try {
    // Split ids: fetch which belong to feed_entries vs personas
    const order = body.order as string[];
    const placeholders = order.map(() => '?').join(',');
    const existing = await c.env.DB.prepare(
      `SELECT id FROM onlydate_feed_entries WHERE id IN (${placeholders})`
    ).bind(...order).all();
    const feedEntryIds = new Set((existing.results as { id: string }[]).map((r) => r.id));

    const feedStmts = order
      .filter((id) => feedEntryIds.has(id))
      .map((id) => {
        const pos = order.indexOf(id) + 1;
        return c.env.DB.prepare('UPDATE onlydate_feed_entries SET sort_order = ? WHERE id = ?').bind(pos, id);
      });

    const personaStmts = order
      .filter((id) => !feedEntryIds.has(id))
      .map((id) => {
        const pos = order.indexOf(id) + 1;
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
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/onlydate/admin/feed-entry/toggle-promoted
// Body: { feed_entry_id: string, is_promoted: boolean }
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/onlydate/admin/feed-entry/toggle-promoted', async (c) => {
  if (!isAdmin(c)) return c.json({ error: 'Unauthorized' }, 401);

  let body: { feed_entry_id?: string; is_promoted?: boolean };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Bad JSON' }, 400); }
  if (!body.feed_entry_id) return c.json({ error: 'feed_entry_id required' }, 400);

  const val = body.is_promoted ? 1 : 0;

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
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/onlydate/admin/personas
// Returns ALL personas (active + inactive, with or without photos)
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/onlydate/admin/personas', async (c) => {
  if (!isAdmin(c)) return c.json({ error: 'Unauthorized' }, 401);

  const sql = `
    SELECT
      p.id           AS persona_id,
      p.display_name AS persona_name,
      p.handle       AS persona_username,
      p.is_active    AS is_active,
      p.feed_visible AS feed_visible,
      'personas'     AS source,
      ml.id          AS media_id,
      mf.file_url,
      COALESCE(opc.is_hidden, 0)                                     AS is_hidden,
      CASE WHEN opc.is_cover_for_persona = p.id THEN 1 ELSE 0 END   AS is_cover,
      COALESCE(opc2.cover_url, NULL)                          AS cover_url,
      COALESCE(opc2.sort_order, 9999999)                     AS sort_order,
      COALESCE(opc2.is_promoted, 0)                          AS is_promoted
    FROM personas p
    LEFT JOIN onlydate_persona_config opc2 ON opc2.persona_id = p.id
    LEFT JOIN media_library ml
      ON ml.persona_id = p.id
     AND ml.category = 'casual'
     AND (ml.price_stars IS NULL OR ml.price_stars = 0)
     AND ml.type = 'photo'
    LEFT JOIN media_files mf ON mf.media_id = ml.id
    LEFT JOIN onlydate_photo_config opc ON opc.media_id = ml.id
    UNION ALL
    SELECT
      fe.id           AS persona_id,
      fe.display_name AS persona_name,
      fe.handle       AS persona_username,
      fe.is_active    AS is_active,
      fe.feed_visible AS feed_visible,
      'feed_entry'    AS source,
      NULL            AS media_id,
      NULL            AS file_url,
      0               AS is_hidden,
      0               AS is_cover,
      fe.cover_url    AS cover_url,
      fe.sort_order   AS sort_order,
      fe.is_promoted  AS is_promoted
    FROM onlydate_feed_entries fe
    ORDER BY sort_order ASC, persona_name ASC
    LIMIT 5000
  `;

  try {
    const [mainResult, feedPhotosResult] = await Promise.all([
      c.env.DB.prepare(sql).all(),
      c.env.DB.prepare(`
        SELECT fp.id AS photo_id, fp.feed_entry_id, fp.file_url, fp.file_key, fp.sort_order, fp.is_hidden
        FROM onlydate_feed_photos fp
        ORDER BY fp.feed_entry_id, fp.sort_order ASC, fp.created_at ASC
      `).all(),
    ]);

    // Index feed photos by entry id
    const feedPhotos = new Map<string, { id: string; file_url: string; file_key: string; sort_order: number; is_hidden: number }[]>();
    for (const row of feedPhotosResult.results as Record<string, unknown>[]) {
      const eid = row.feed_entry_id as string;
      if (!feedPhotos.has(eid)) feedPhotos.set(eid, []);
      feedPhotos.get(eid)!.push({
        id:         row.photo_id as string,
        file_url:   row.file_url as string,
        file_key:   row.file_key as string,
        sort_order: row.sort_order as number,
        is_hidden:  (row.is_hidden as number) ?? 0,
      });
    }

    type PhotoRow = { media_id: string; file_url: string; is_hidden: boolean; is_cover: boolean };
    type PersonaEntry = { id: string; name: string; username: string; is_active: boolean; feed_visible: number | null; source: string; photos: PhotoRow[]; cover_url?: string; sort_order: number | null; is_promoted: number };

    const map = new Map<string, PersonaEntry>();
    for (const row of mainResult.results as Record<string, unknown>[]) {
      const pid = row.persona_id as string;
      if (!map.has(pid)) {
        map.set(pid, {
          id:           pid,
          name:         row.persona_name as string,
          username:     row.persona_username as string,
          is_active:    (row.is_active as number) === 1,
          feed_visible: row.feed_visible as number | null,
          source:       row.source as string,
          cover_url:    (row.cover_url as string | null) ?? undefined,
          sort_order:   row.sort_order as number | null,
          is_promoted:  (row.is_promoted as number) ?? 0,
          photos:       [],
        });
      }
      if (row.media_id) {
        map.get(pid)!.photos.push({
          media_id:  row.media_id as string,
          file_url:  row.file_url as string,
          is_hidden: (row.is_hidden as number) === 1,
          is_cover:  (row.is_cover as number) === 1,
        });
      }
    }

    // Attach feed_entry gallery photos as regular photo rows
    for (const [eid, photos] of feedPhotos) {
      const entry = map.get(eid);
      if (!entry) continue;
      for (const ph of photos) {
        entry.photos.push({
          media_id:  ph.id,
          file_url:  ph.file_url,
          is_hidden: ph.is_hidden === 1,
          is_cover:  false,
        });
      }
    }

    return c.json({ personas: Array.from(map.values()) });
  } catch (err) {
    console.error('[OnlyDate] admin/personas error:', err);
    return c.json({ error: 'Failed to load' }, 500);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/onlydate/admin/photo/toggle
// Body: { media_id: string, is_hidden: boolean }
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/onlydate/admin/photo/toggle', async (c) => {
  if (!isAdmin(c)) return c.json({ error: 'Unauthorized' }, 401);

  let body: { media_id?: string; is_hidden?: boolean };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Bad JSON' }, 400); }
  if (!body.media_id) return c.json({ error: 'media_id required' }, 400);

  const isHidden = body.is_hidden ? 1 : 0;

  try {
    await c.env.DB.prepare(`
      INSERT INTO onlydate_photo_config (media_id, is_hidden, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(media_id) DO UPDATE SET
        is_hidden  = excluded.is_hidden,
        updated_at = excluded.updated_at
    `).bind(body.media_id, isHidden, Date.now()).run();
    return c.json({ ok: true });
  } catch (err) {
    console.error('[OnlyDate] admin/photo/toggle error:', err);
    return c.json({ error: 'Failed' }, 500);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/onlydate/admin/photo/cover
// Body: { media_id: string, persona_id: string }
// Clears old cover for the persona then sets the new one
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/onlydate/admin/photo/cover', async (c) => {
  if (!isAdmin(c)) return c.json({ error: 'Unauthorized' }, 401);

  let body: { media_id?: string; persona_id?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Bad JSON' }, 400); }
  if (!body.media_id || !body.persona_id) return c.json({ error: 'media_id and persona_id required' }, 400);

  try {
    // Clear existing cover for this persona
    await c.env.DB.prepare(
      `UPDATE onlydate_photo_config SET is_cover_for_persona = NULL WHERE is_cover_for_persona = ?`
    ).bind(body.persona_id).run();

    // Upsert the new cover (preserves is_hidden if row exists)
    await c.env.DB.prepare(`
      INSERT INTO onlydate_photo_config (media_id, is_cover_for_persona, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(media_id) DO UPDATE SET
        is_cover_for_persona = excluded.is_cover_for_persona,
        updated_at           = excluded.updated_at
    `).bind(body.media_id, body.persona_id, Date.now()).run();

    return c.json({ ok: true });
  } catch (err) {
    console.error('[OnlyDate] admin/photo/cover error:', err);
    return c.json({ error: 'Failed' }, 500);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/onlydate/admin/persona/set-cover
// Body: { persona_id: string, cover_url: string | null }
// UPSERTs cover_url into onlydate_persona_config for regular personas
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/onlydate/admin/persona/set-cover', async (c) => {
  if (!isAdmin(c)) return c.json({ error: 'Unauthorized' }, 401);

  let body: { persona_id?: string; cover_url?: string | null };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Bad JSON' }, 400); }
  if (!body.persona_id) return c.json({ error: 'persona_id required' }, 400);

  try {
    await c.env.DB.prepare(`
      INSERT INTO onlydate_persona_config (persona_id, cover_url, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(persona_id) DO UPDATE SET cover_url = excluded.cover_url, updated_at = excluded.updated_at
    `).bind(body.persona_id, body.cover_url ?? null, Date.now()).run();
    return c.json({ ok: true });
  } catch (err) {
    console.error('[OnlyDate] admin/persona/set-cover error:', err);
    return c.json({ error: 'Failed' }, 500);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/onlydate/admin/persona/create
// Creates entry in onlydate_feed_entries (does NOT touch personas table)
// Body: { display_name: string, handle: string, cover_url?: string }
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/onlydate/admin/persona/create', async (c) => {
  if (!isAdmin(c)) return c.json({ error: 'Unauthorized' }, 401);

  let body: { display_name?: string; handle?: string; cover_url?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Bad JSON' }, 400); }

  const displayName = body.display_name?.trim();
  const handle      = body.handle?.trim().replace(/^@/, '').trim();
  if (!displayName) return c.json({ error: 'display_name required' }, 400);
  if (!handle)      return c.json({ error: 'handle required' }, 400);

  const id       = crypto.randomUUID();
  const now      = Date.now();
  const coverUrl = body.cover_url?.trim() || null;

  try {
    await c.env.DB.prepare(`
      INSERT INTO onlydate_feed_entries (id, display_name, handle, cover_url, is_active, created_at)
      VALUES (?, ?, ?, ?, 1, ?)
    `).bind(id, displayName, handle, coverUrl, now).run();

    return c.json({
      ok: true,
      persona: { id, name: displayName, username: handle, is_active: true, feed_visible: null, source: 'feed_entry', photos: [] },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.toLowerCase().includes('unique')) {
      return c.json({ error: 'Handle already exists' }, 409);
    }
    console.error('[OnlyDate] admin/persona/create error:', err);
    return c.json({ error: 'Failed to create' }, 500);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/onlydate/admin/feed-settings
// Returns current feed mode
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/onlydate/admin/feed-settings', async (c) => {
  if (!isAdmin(c)) return c.json({ error: 'Unauthorized' }, 401);
  const mode = await getFeedMode(c.env.DB);
  return c.json({ mode });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/onlydate/admin/feed-settings
// Body: { mode: 'all' | 'selected' }
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/onlydate/admin/feed-settings', async (c) => {
  if (!isAdmin(c)) return c.json({ error: 'Unauthorized' }, 401);

  let body: { mode?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Bad JSON' }, 400); }
  if (body.mode !== 'all' && body.mode !== 'selected') {
    return c.json({ error: 'mode must be "all" or "selected"' }, 400);
  }

  try {
    await c.env.DB.prepare(`
      INSERT INTO app_settings (key, value) VALUES ('feed_mode', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).bind(body.mode).run();
    return c.json({ ok: true, mode: body.mode });
  } catch (err) {
    console.error('[OnlyDate] admin/feed-settings error:', err);
    return c.json({ error: 'Failed' }, 500);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/onlydate/admin/persona/set-feed-visibility
// Body: { persona_id: string, feed_visible: 0 | 1 | null }
// null = follow global mode, 1 = force show, 0 = force hide
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/onlydate/admin/persona/set-feed-visibility', async (c) => {
  if (!isAdmin(c)) return c.json({ error: 'Unauthorized' }, 401);

  let body: { persona_id?: string; feed_visible?: number | null };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Bad JSON' }, 400); }
  if (!body.persona_id) return c.json({ error: 'persona_id required' }, 400);

  const val = body.feed_visible === 1 ? 1 : body.feed_visible === 0 ? 0 : null;

  try {
    // Update whichever table contains this persona (the other will be a no-op)
    await c.env.DB.prepare(`UPDATE personas SET feed_visible = ? WHERE id = ?`)
      .bind(val, body.persona_id).run();
    await c.env.DB.prepare(`UPDATE onlydate_feed_entries SET feed_visible = ? WHERE id = ?`)
      .bind(val, body.persona_id).run();
    return c.json({ ok: true });
  } catch (err) {
    console.error('[OnlyDate] admin/persona/set-feed-visibility error:', err);
    return c.json({ error: 'Failed' }, 500);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/onlydate/admin/persona/toggle-active
// Body: { persona_id: string, is_active: boolean }
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/onlydate/admin/persona/toggle-active', async (c) => {
  if (!isAdmin(c)) return c.json({ error: 'Unauthorized' }, 401);

  let body: { persona_id?: string; is_active?: boolean };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Bad JSON' }, 400); }
  if (!body.persona_id) return c.json({ error: 'persona_id required' }, 400);

  const isActive = body.is_active ? 1 : 0;

  try {
    await c.env.DB.prepare(`UPDATE onlydate_feed_entries SET is_active = ? WHERE id = ?`)
      .bind(isActive, body.persona_id).run();
    return c.json({ ok: true });
  } catch (err) {
    console.error('[OnlyDate] admin/persona/toggle-active error:', err);
    return c.json({ error: 'Failed' }, 500);
  }
});

export { getFeedMode };
export default app;
