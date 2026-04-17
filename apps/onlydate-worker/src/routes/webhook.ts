import { Hono } from 'hono';
import { tgSend, MINIAPP_URL } from '../shared/telegram';

interface Env {
  DB: D1Database;
  BOT_TOKEN: string;
  MEDIA: R2Bucket;
  ADMIN_PASSWORD: string;
}

const app = new Hono<{ Bindings: Env }>();

// ═════════════════════════════════════════════════════════════════════════════
// TELEGRAM WEBHOOK  — @onlydatebot /start handler
// ═════════════════════════════════════════════════════════════════════════════

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

export default app;
