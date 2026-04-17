import { Hono } from 'hono';
import { COVER_PHOTO, HAS_FREE_PHOTO, feedFilter } from '../shared/db';
import { getFeedMode } from './admin';

interface Env {
  DB: D1Database;
  BOT_TOKEN: string;
  MEDIA: R2Bucket;
  ADMIN_PASSWORD: string;
}

const app = new Hono<{ Bindings: Env }>();

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

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/onlydate/models?tab=trending|popular|new
// Returns personas (from personas table) UNION feed entries (onlydate_feed_entries)
// Ordered by is_promoted DESC, sort_order ASC. Tab param accepted but has no effect.
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/onlydate/models', async (c) => {
  const mode     = await getFeedMode(c.env.DB);
  const pFilter  = feedFilter('p', mode);
  const feFilter = feedFilter('fe', mode);
  const baseWhere = `p.is_active = 1 AND p.handle IS NOT NULL AND ${pFilter} AND ${HAS_FREE_PHOTO}`;

  const sql = `
    SELECT id, name, username, cover_photo, message_count, is_promoted FROM (
      SELECT
        p.id,
        p.display_name  AS name,
        p.handle        AS username,
        COALESCE(opc2.cover_url, ${COVER_PHOTO}) AS cover_photo,
        0               AS message_count,
        COALESCE(opc2.is_promoted, 0) AS is_promoted,
        COALESCE(opc2.sort_order, 9999999) AS sort_order
      FROM personas p
      LEFT JOIN onlydate_persona_config opc2 ON opc2.persona_id = p.id
      WHERE ${baseWhere}
      UNION ALL
      SELECT
        fe.id,
        fe.display_name AS name,
        fe.handle       AS username,
        fe.cover_url    AS cover_photo,
        0               AS message_count,
        fe.is_promoted  AS is_promoted,
        fe.sort_order   AS sort_order
      FROM onlydate_feed_entries fe
      WHERE fe.is_active = 1 AND fe.cover_url IS NOT NULL AND ${feFilter}
    )
    ORDER BY is_promoted DESC, sort_order ASC
    LIMIT 100
  `;

  try {
    const result = await c.env.DB.prepare(sql).all();
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
        COALESCE(pc.cover_url, ${COVER_PHOTO}) AS cover_photo,
        (SELECT COUNT(*) FROM message_history mh WHERE mh.persona_id = p.id) AS message_count
      FROM personas p
      LEFT JOIN onlydate_persona_config pc ON pc.persona_id = p.id
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

    // Determine if this persona is a feed_entry (uses onlydate_feed_photos)
    // or a legacy persona (uses media_library / media_files)
    const isFeedEntry = await c.env.DB.prepare(
      'SELECT id FROM onlydate_feed_entries WHERE id = ? LIMIT 1'
    ).bind(persona.id as string).first();

    let freePhotos: string[];
    if (isFeedEntry) {
      const feedPhotoRows = await c.env.DB.prepare(
        'SELECT file_url FROM onlydate_feed_photos WHERE feed_entry_id = ? AND is_hidden = 0 ORDER BY sort_order ASC, created_at ASC'
      ).bind(persona.id as string).all();
      freePhotos = (feedPhotoRows.results as Record<string, unknown>[]).map((r) => r.file_url as string);
    } else {
      const photos = await c.env.DB.prepare(photosSql)
        .bind(persona.id as string, persona.id as string)
        .all();
      freePhotos = (photos.results as Record<string, unknown>[]).map((r) => r.file_url as string);
    }

    return c.json({
      id:            persona.id,
      name:          persona.name,
      username:      persona.username,
      cover_photo:   persona.cover_photo,
      free_photos:   freePhotos,
      message_count: persona.message_count,
    });
  } catch (err) {
    console.error('[OnlyDate] /models/:username error:', err);
    return c.json({ error: 'Failed to load profile' }, 500);
  }
});

export default app;
