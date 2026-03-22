import { Hono } from 'hono';

interface Env {
  DB: D1Database;
  BOT_TOKEN: string;
}

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
function feedVisibilityFilter(mode: 'all' | 'selected'): string {
  return mode === 'selected'
    ? `p.feed_visible = 1`
    : `(p.feed_visible IS NULL OR p.feed_visible = 1)`;
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
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/onlydate/models', async (c) => {
  const tab = c.req.query('tab') ?? 'trending';

  const feedMode   = await getFeedMode(c.env.DB);
  const feedFilter = feedVisibilityFilter(feedMode);
  const baseWhere  = `p.is_active = 1 AND p.handle IS NOT NULL AND ${feedFilter} AND ${HAS_FREE_PHOTO}`;

  let msgCount: string;
  let orderBy: string;
  const params: (string | number)[] = [];

  if (tab === 'new') {
    msgCount = `(SELECT COUNT(*) FROM message_history mh WHERE mh.persona_id = p.id)`;
    orderBy  = `p.created_at DESC`;
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
    SELECT
      p.id,
      p.display_name AS name,
      p.handle       AS username,
      ${COVER_PHOTO} AS cover_photo,
      ${msgCount}    AS message_count
    FROM personas p
    WHERE ${baseWhere}
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

  const feedMode   = await getFeedMode(c.env.DB);
  const feedFilter = feedVisibilityFilter(feedMode);

  const personaSql = `
    SELECT
      p.id,
      p.display_name AS name,
      p.handle       AS username,
      ${COVER_PHOTO} AS cover_photo,
      (SELECT COUNT(*) FROM message_history mh WHERE mh.persona_id = p.id) AS message_count
    FROM personas p
    WHERE p.is_active = 1 AND p.handle = ? AND ${feedFilter}
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
    const persona = await c.env.DB.prepare(personaSql).bind(username).first() as Record<string, unknown> | null;
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
      ml.id          AS media_id,
      mf.file_url,
      COALESCE(opc.is_hidden, 0)                                     AS is_hidden,
      CASE WHEN opc.is_cover_for_persona = p.id THEN 1 ELSE 0 END   AS is_cover
    FROM personas p
    LEFT JOIN media_library ml
      ON ml.persona_id = p.id
     AND ml.category = 'casual'
     AND (ml.price_stars IS NULL OR ml.price_stars = 0)
     AND ml.type = 'photo'
    LEFT JOIN media_files mf ON mf.media_id = ml.id
    LEFT JOIN onlydate_photo_config opc ON opc.media_id = ml.id
    ORDER BY p.display_name ASC, ml.created_at ASC, mf.file_order ASC
    LIMIT 5000
  `;

  try {
    const result = await c.env.DB.prepare(sql).all();

    type PhotoRow = { media_id: string; file_url: string; is_hidden: boolean; is_cover: boolean };
    type PersonaEntry = { id: string; name: string; username: string; is_active: boolean; feed_visible: number | null; photos: PhotoRow[] };

    const map = new Map<string, PersonaEntry>();
    for (const row of result.results as Record<string, unknown>[]) {
      const pid = row.persona_id as string;
      if (!map.has(pid)) {
        map.set(pid, {
          id:           pid,
          name:         row.persona_name as string,
          username:     row.persona_username as string,
          is_active:    (row.is_active as number) === 1,
          feed_visible: row.feed_visible as number | null,
          photos:       [],
        });
      }
      // Only push if there's actually a photo row (LEFT JOIN may produce NULLs)
      if (row.media_id) {
        map.get(pid)!.photos.push({
          media_id:  row.media_id as string,
          file_url:  row.file_url as string,
          is_hidden: (row.is_hidden as number) === 1,
          is_cover:  (row.is_cover as number) === 1,
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
// Body: { display_name: string, handle: string, is_active?: boolean }
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/onlydate/admin/persona/create', async (c) => {
  if (!isAdmin(c)) return c.json({ error: 'Unauthorized' }, 401);

  let body: { display_name?: string; handle?: string; is_active?: boolean };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Bad JSON' }, 400); }

  const displayName = body.display_name?.trim();
  const handle      = body.handle?.trim().replace(/^@/, '').trim();
  if (!displayName) return c.json({ error: 'display_name required' }, 400);
  if (!handle)      return c.json({ error: 'handle required' }, 400);

  const id       = crypto.randomUUID();
  const isActive = body.is_active !== false ? 1 : 0;
  const now      = Date.now();

  try {
    await c.env.DB.prepare(`
      INSERT INTO personas (id, display_name, handle, is_active, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).bind(id, displayName, handle, isActive, now).run();

    return c.json({
      ok: true,
      persona: { id, name: displayName, username: handle, is_active: isActive === 1, photos: [] },
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
    await c.env.DB.prepare(`UPDATE personas SET feed_visible = ? WHERE id = ?`)
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
    await c.env.DB.prepare(`UPDATE personas SET is_active = ? WHERE id = ?`)
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
