import { Hono }           from 'hono';
import { verifyInitData } from '../shared/telegram';

// ─── Env ──────────────────────────────────────────────────────────────────────
// Per Pattern 6 (RESEARCH.md): each route file declares its own Env interface.
interface Env {
  DB:              D1Database;
  BOT_TOKEN:       string;
  MEDIA:           R2Bucket;
  ADMIN_PASSWORD:  string;
  POSTHOG_API_KEY: string;
}

const app = new Hono<{ Bindings: Env }>();

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/onlydate/track
// Validates Telegram initData HMAC, writes event to D1, relays to PostHog EU.
// Satisfies: TRACK-01, TRACK-02, TRACK-03, TRACK-04, TRACK-05, TRACK-06, TRACK-07
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/onlydate/track', async (c) => {
  try {
    const body = await c.req.json<{
      initData:       string;
      event_type:     string;
      persona_handle: string | null;
      start_param:    string | null;
      utm_source:     string | null;
      utm_medium:     string | null;
      utm_campaign:   string | null;
    }>();

    if (!body.initData || !body.event_type) {
      return c.json({ error: 'initData and event_type required' }, 400);
    }

    // D-08: HMAC validation always enforced — no bypass in any environment.
    // D-09: Mini App scheme (not Login Widget scheme).
    // D-10: auth_date freshness checked inside verifyInitData (24h window).
    const valid = await verifyInitData(body.initData, c.env.BOT_TOKEN);
    if (!valid) {
      console.error('[OnlyDate] track: initData validation failed');
      return c.json({ error: 'Unauthorized' }, 403);
    }

    // Extract user_id from the server-validated initData only — never trust client-supplied user_id.
    const params = new URLSearchParams(body.initData);
    const user   = JSON.parse(params.get('user') ?? '{}') as { id?: number };
    const userId = String(user.id ?? '');
    if (!userId) {
      console.error('[OnlyDate] track: user.id missing from validated initData');
      return c.json({ error: 'Unauthorized' }, 403);
    }

    // Write event to D1 (synchronous — source of truth per D-03).
    const id = crypto.randomUUID();
    await c.env.DB.prepare(`
      INSERT INTO onlydate_events
        (id, event_type, user_id, persona_handle, start_param, utm_source, utm_medium, utm_campaign, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id,
      body.event_type,
      userId,
      body.persona_handle  ?? null,
      body.start_param     ?? null,
      body.utm_source      ?? null,
      body.utm_medium      ?? null,
      body.utm_campaign    ?? null,
      Date.now(),
    ).run();

    // Relay to PostHog EU — fire-and-forget via waitUntil so response is not blocked.
    // D-03: plain fetch, no SDK.
    // D-05: distinct_id = tg_${userId} to avoid namespace collision.
    // D-06: no PII (no first_name, last_name, username, photo_url).
    c.executionCtx.waitUntil(sendToPostHog(
      body.event_type,
      userId,
      {
        persona_handle: body.persona_handle ?? undefined,
        start_param:    body.start_param    ?? undefined,
        utm_source:     body.utm_source     ?? undefined,
        utm_medium:     body.utm_medium     ?? undefined,
        utm_campaign:   body.utm_campaign   ?? undefined,
      },
      c.env.POSTHOG_API_KEY,
    ));

    return c.json({ ok: true });
  } catch (err) {
    console.error('[OnlyDate] track error:', err);
    return c.json({ error: 'Track failed' }, 500);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// sendToPostHog — fire-and-forget relay to PostHog EU capture endpoint
// D-01: PostHog EU region: https://eu.i.posthog.com
// D-07: event names mirror D1 event_type values exactly
// Failures are swallowed silently — D1 is the source of truth.
// ─────────────────────────────────────────────────────────────────────────────
async function sendToPostHog(
  eventType:  string,
  userId:     string,
  properties: Record<string, string | undefined>,
  apiKey:     string,
): Promise<void> {
  try {
    await fetch('https://eu.i.posthog.com/capture/', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key:     apiKey,
        event:       eventType,
        distinct_id: userId,
        properties:  {
          ...properties,
        },
        timestamp: new Date().toISOString(),
      }),
    });
  } catch {
    // Non-critical: PostHog relay failure is swallowed. D1 row is already written.
  }
}

export default app;
