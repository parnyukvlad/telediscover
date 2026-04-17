import { Hono } from 'hono';
import adminRoutes     from './routes/admin';
import analyticsRoutes from './routes/analytics';
import publicRoutes    from './routes/public';
import webhookRoutes   from './routes/webhook';

// ─── Env ──────────────────────────────────────────────────────────────────────
interface Env {
  DB:              D1Database;
  BOT_TOKEN:       string;
  MEDIA:           R2Bucket;
  ADMIN_PASSWORD:  string;
  POSTHOG_API_KEY: string;   // D-21: public write-only PostHog project token (Phase 2)
}

const app = new Hono<{ Bindings: Env }>();

// ─── CORS ─────────────────────────────────────────────────────────────────────
app.use('*', async (c, next) => {
  c.header('Access-Control-Allow-Origin', '*');
  c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  c.header('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Password');
  if (c.req.method === 'OPTIONS') return c.body(null, 204);
  await next();
});

// ─── Routes ───────────────────────────────────────────────────────────────────
app.route('/', publicRoutes);
app.route('/', adminRoutes);
app.route('/', webhookRoutes);
app.route('/', analyticsRoutes);   // Phase 2: POST /api/onlydate/track

// ─── 404 ─────────────────────────────────────────────────────────────────────
app.notFound((c) => c.json({ error: 'Not found' }, 404));

// ─────────────────────────────────────────────────────────────────────────────
// pruneOldEvents — deletes onlydate_events rows older than 90 days
// Called from scheduled() handler. TRACK-08.
// created_at stores Unix milliseconds (per Phase 1 schema decision D-04).
// ─────────────────────────────────────────────────────────────────────────────
async function pruneOldEvents(db: D1Database): Promise<void> {
  const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
  await db.prepare('DELETE FROM onlydate_events WHERE created_at < ?').bind(cutoff).run();
}

// ─────────────────────────────────────────────────────────────────────────────
// Export: object form required for cron support (D-20).
// fetch: app.fetch — Hono's standard Workers adapter (NOT bare `app`).
// scheduled: daily at midnight UTC per wrangler.toml [triggers].
// ─────────────────────────────────────────────────────────────────────────────
export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(pruneOldEvents(env.DB));
  },
};
