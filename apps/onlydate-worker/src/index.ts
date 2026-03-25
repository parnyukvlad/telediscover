import { Hono } from 'hono';

interface Env {
  DB: D1Database;
  BOT_TOKEN: string;
  MEDIA: R2Bucket;
}

const MEDIA_BASE = 'https://onlydate-api.tg-saas.workers.dev/media';

const app = new Hono<{ Bindings: Env }>();

// ─── Admin password (server-side validated) ───────────────────────────────────
const ADMIN_PASSWORD = 'PhotoAdmin#9Kz$M2pVL8xR5nQ!2025';

function isAdmin(c: { req: { header: (name: string) => string | undefined } }): boolean {
  return c.req.header('X-Admin-Password') === ADMIN_PASSWORD;
}

// ─── CORS ─────────────────────────────────────────────────────────────────────
app.use('*', async (c, next) => {
  c.header('Access-Control-Allow-Origin', '*');
  c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  c.header('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Password');
  if (c.req.method === 'OPTIONS') return c.body(null, 204);
  await next();
});

// ─── Health ───────────────────────────────────────────────────────────────────
app.get('/', (c) => c.json({ name: 'OnlyDate API', status: 'ok' }));

// ─── R2 media serve ───────────────────────────────────────────────────────────
// Serves uploaded files publicly via the worker
app.get('/media/*', async (c) => {
  const key = c.req.path.replace(/^\/media\//, '');
  if (!key) return c.notFound();
  const obj = await c.env.MEDIA.get(key);
  if (!obj) return c.notFound();
  const headers = new Headers();
  if (obj.httpMetadata?.contentType) headers.set('Content-Type', obj.httpMetadata.contentType);
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  return new Response(obj.body as BodyInit, { headers });
});

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
      await c.env.MEDIA.delete(body.file_key).catch(() => {});
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

    // Delete photos from R2 (best effort)
    await Promise.all(
      (photos.results as { file_key: string }[]).map((p) => c.env.MEDIA.delete(p.file_key).catch(() => {}))
    );

    // Delete from DB
    await c.env.DB.prepare(`DELETE FROM onlydate_feed_photos WHERE feed_entry_id = ?`).bind(body.feed_entry_id).run();
    await c.env.DB.prepare(`DELETE FROM onlydate_feed_entries WHERE id = ?`).bind(body.feed_entry_id).run();

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

// feed_visible: NULL = follow mode, 1 = force show, 0 = force hide
// alias = table alias used in query (e.g. 'p' or 'fe')
function feedFilter(alias: string, mode: 'all' | 'selected'): string {
  return mode === 'selected'
    ? `${alias}.feed_visible = 1`
    : `(${alias}.feed_visible IS NULL OR ${alias}.feed_visible = 1)`;
}

// ─── SQL fragments (visibility-aware) ────────────────────────────────────────
// cover_photo: prefers admin-set cover, falls back to oldest visible photo
// NOTE: D1 SQLite does NOT allow outer-query aliases (p.id) in subquery ORDER BY.
// Workaround: COALESCE two subqueries — explicit cover (p.id in WHERE is fine),
// then fallback oldest photo (no outer alias in ORDER BY).
const COVER_PHOTO = `COALESCE(
  (
    SELECT mf.file_url
    FROM   media_library ml
    JOIN   media_files   mf  ON mf.media_id = ml.id
    JOIN   onlydate_photo_config opc ON opc.media_id = ml.id
    WHERE  ml.persona_id = p.id
      AND  ml.category = 'casual'
      AND  (ml.price_stars IS NULL OR ml.price_stars = 0)
      AND  ml.type = 'photo'
      AND  opc.is_cover_for_persona = p.id
      AND  (opc.is_hidden IS NULL OR opc.is_hidden = 0)
    LIMIT 1
  ),
  (
    SELECT mf.file_url
    FROM   media_library ml
    JOIN   media_files   mf  ON mf.media_id = ml.id
    LEFT JOIN onlydate_photo_config opc ON opc.media_id = ml.id
    WHERE  ml.persona_id = p.id
      AND  ml.category = 'casual'
      AND  (ml.price_stars IS NULL OR ml.price_stars = 0)
      AND  ml.type = 'photo'
      AND  (opc.is_hidden IS NULL OR opc.is_hidden = 0)
    ORDER BY ml.created_at ASC, mf.file_order ASC
    LIMIT 1
  )
)`;

// has at least one visible free photo
const HAS_FREE_PHOTO = `(
  SELECT COUNT(*)
  FROM   media_library ml2
  JOIN   media_files   mf2  ON mf2.media_id = ml2.id
  LEFT JOIN onlydate_photo_config opc2 ON opc2.media_id = ml2.id
  WHERE  ml2.persona_id = p.id
    AND  ml2.category = 'casual'
    AND  (ml2.price_stars IS NULL OR ml2.price_stars = 0)
    AND  ml2.type = 'photo'
    AND  (opc2.is_hidden IS NULL OR opc2.is_hidden = 0)
) > 0`;

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/onlydate/models?tab=trending|popular|new
// Returns personas (from personas table) UNION feed entries (onlydate_feed_entries)
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/onlydate/models', async (c) => {
  const tab = c.req.query('tab') ?? 'trending';

  const mode       = await getFeedMode(c.env.DB);
  const pFilter    = feedFilter('p', mode);
  const feFilter   = feedFilter('fe', mode);
  const baseWhere  = `p.is_active = 1 AND p.handle IS NOT NULL AND ${pFilter} AND ${HAS_FREE_PHOTO}`;

  let msgCount: string;
  let orderBy: string;
  const params: (string | number)[] = [];

  if (tab === 'new') {
    msgCount = `(SELECT COUNT(*) FROM message_history mh WHERE mh.persona_id = p.id)`;
    orderBy  = `created_at DESC`;
  } else if (tab === 'trending') {
    const since = Date.now() - 7 * 24 * 60 * 60 * 1000;
    msgCount = `(SELECT COUNT(*) FROM message_history mh WHERE mh.persona_id = p.id AND mh.created_at > ?)`;
    orderBy  = `message_count DESC`;
    params.push(since);
  } else {
    msgCount = `(SELECT COUNT(*) FROM message_history mh WHERE mh.persona_id = p.id)`;
    orderBy  = `message_count DESC`;
  }

  const sql = `
    SELECT id, name, username, cover_photo, message_count FROM (
      SELECT
        p.id,
        p.display_name  AS name,
        p.handle        AS username,
        ${COVER_PHOTO}  AS cover_photo,
        ${msgCount}     AS message_count,
        p.created_at    AS created_at
      FROM personas p
      WHERE ${baseWhere}
      UNION ALL
      SELECT
        fe.id,
        fe.display_name AS name,
        fe.handle       AS username,
        fe.cover_url    AS cover_photo,
        0               AS message_count,
        fe.created_at   AS created_at
      FROM onlydate_feed_entries fe
      WHERE fe.is_active = 1 AND fe.cover_url IS NOT NULL AND ${feFilter}
    )
    ORDER BY ${orderBy}
    LIMIT 100
  `;

  try {
    const stmt   = params.length ? c.env.DB.prepare(sql).bind(...params) : c.env.DB.prepare(sql);
    const result = await stmt.all();
    const models = (result.results as Record<string, unknown>[]).filter((r) => r.cover_photo != null);
    return c.json({ models });
  } catch (err) {
    console.error('[OnlyDate] /models error:', err);
    return c.json({ models: [] }, 500);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/onlydate/models/:username
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/onlydate/models/:username', async (c) => {
  const username = c.req.param('username');

  const mode     = await getFeedMode(c.env.DB);
  const pFilter  = feedFilter('p', mode);
  const feFilter = feedFilter('fe', mode);

  const personaSql = `
    SELECT id, name, username, cover_photo, message_count FROM (
      SELECT
        p.id,
        p.display_name AS name,
        p.handle       AS username,
        ${COVER_PHOTO} AS cover_photo,
        (SELECT COUNT(*) FROM message_history mh WHERE mh.persona_id = p.id) AS message_count
      FROM personas p
      WHERE p.is_active = 1 AND p.handle = ? AND ${pFilter}
      UNION ALL
      SELECT
        fe.id,
        fe.display_name AS name,
        fe.handle       AS username,
        fe.cover_url    AS cover_photo,
        0               AS message_count
      FROM onlydate_feed_entries fe
      WHERE fe.is_active = 1 AND fe.handle = ? AND ${feFilter}
    )
    LIMIT 1
  `;

  // visible photos only, cover first
  const photosSql = `
    SELECT mf.file_url
    FROM   media_library ml
    JOIN   media_files   mf  ON mf.media_id = ml.id
    LEFT JOIN onlydate_photo_config opc ON opc.media_id = ml.id
    WHERE  ml.persona_id = ?
      AND  ml.category = 'casual'
      AND  (ml.price_stars IS NULL OR ml.price_stars = 0)
      AND  ml.type = 'photo'
      AND  (opc.is_hidden IS NULL OR opc.is_hidden = 0)
    ORDER BY
      CASE WHEN opc.is_cover_for_persona = ? THEN 0 ELSE 1 END ASC,
      ml.created_at ASC,
      mf.file_order ASC
  `;

  try {
    const persona = await c.env.DB.prepare(personaSql).bind(username, username).first() as Record<string, unknown> | null;
    if (!persona) return c.json({ error: 'Not found' }, 404);

    const photos = await c.env.DB.prepare(photosSql)
      .bind(persona.id as string, persona.id as string)
      .all();

    return c.json({
      id:            persona.id,
      name:          persona.name,
      username:      persona.username,
      cover_photo:   persona.cover_photo,
      free_photos:   (photos.results as Record<string, unknown>[]).map((r) => r.file_url),
      message_count: persona.message_count,
    });
  } catch (err) {
    console.error('[OnlyDate] /models/:username error:', err);
    return c.json({ error: 'Failed to load profile' }, 500);
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// ADMIN ENDPOINTS  (require X-Admin-Password header)
// ═════════════════════════════════════════════════════════════════════════════

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
      NULL           AS cover_url
    FROM personas p
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
      fe.cover_url    AS cover_url
    FROM onlydate_feed_entries fe
    ORDER BY persona_name ASC
    LIMIT 5000
  `;

  try {
    const [mainResult, feedPhotosResult] = await Promise.all([
      c.env.DB.prepare(sql).all(),
      c.env.DB.prepare(`
        SELECT fp.id AS photo_id, fp.feed_entry_id, fp.file_url, fp.file_key, fp.sort_order
        FROM onlydate_feed_photos fp
        ORDER BY fp.feed_entry_id, fp.sort_order ASC, fp.created_at ASC
      `).all(),
    ]);

    // Index feed photos by entry id
    const feedPhotos = new Map<string, { id: string; file_url: string; file_key: string; sort_order: number }[]>();
    for (const row of feedPhotosResult.results as Record<string, unknown>[]) {
      const eid = row.feed_entry_id as string;
      if (!feedPhotos.has(eid)) feedPhotos.set(eid, []);
      feedPhotos.get(eid)!.push({
        id:         row.photo_id as string,
        file_url:   row.file_url as string,
        file_key:   row.file_key as string,
        sort_order: row.sort_order as number,
      });
    }

    type PhotoRow = { media_id: string; file_url: string; is_hidden: boolean; is_cover: boolean };
    type PersonaEntry = { id: string; name: string; username: string; is_active: boolean; feed_visible: number | null; source: string; photos: PhotoRow[]; cover_url?: string };

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
          is_hidden: false,
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

// ═════════════════════════════════════════════════════════════════════════════
// TELEGRAM WEBHOOK  — @onlydatebot /start handler
// ═════════════════════════════════════════════════════════════════════════════

const MINIAPP_URL = 'https://onlydate.pages.dev';

async function tgSend(token: string, method: string, body: unknown): Promise<void> {
  await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

app.post('/webhook/onlydate', async (c) => {
  let update: Record<string, unknown>;
  try { update = await c.req.json(); } catch { return c.json({ ok: true }); }

  const message = update.message as Record<string, unknown> | undefined;
  if (!message) return c.json({ ok: true });

  const text = (message.text as string | undefined) ?? '';
  const chatId = (message.chat as Record<string, unknown>).id;

  if (text.startsWith('/start')) {
    await tgSend(c.env.BOT_TOKEN, 'sendMessage', {
      chat_id: chatId,
      text: '🎉 <b>Welcome to OnlyDate!</b>\n\n💘 OnlyDate is a discovery app for AI companions on Telegram. Browse unique personalities and start chatting.',
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[
          { text: 'Open', web_app: { url: MINIAPP_URL } },
        ]],
      },
    });
  }

  return c.json({ ok: true });
});

// ─── 404 ─────────────────────────────────────────────────────────────────────
app.notFound((c) => c.json({ error: 'Not found' }, 404));

export default app;
