import type { Context } from 'hono';

interface Env {
  DB: D1Database;
  BOT_TOKEN: string;
  MEDIA: R2Bucket;
  ADMIN_PASSWORD: string;
}

/**
 * Returns true if the request carries the correct admin password.
 * Reads ADMIN_PASSWORD from Wrangler secret binding (c.env.ADMIN_PASSWORD).
 * The X-Admin-Password header value is compared directly — no hashing at this layer.
 */
export function isAdmin(c: Context<{ Bindings: Env }>): boolean {
  return c.req.header('X-Admin-Password') === c.env.ADMIN_PASSWORD;
}
