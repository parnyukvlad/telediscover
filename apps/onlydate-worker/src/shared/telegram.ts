export const MEDIA_BASE  = 'https://onlydate-api.tg-saas.workers.dev/media';
export const MINIAPP_URL = 'https://onlydate.pages.dev';

export async function tgSend(token: string, method: string, body: unknown): Promise<void> {
  await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/**
 * Validates Telegram Mini App initData HMAC signature.
 * Uses Mini App scheme: HMAC-SHA256(data_check_string, HMAC-SHA256("WebAppData", bot_token))
 * NOT the Login Widget scheme (SHA256(bot_token)).
 *
 * Also checks auth_date freshness: rejects tokens older than 24 hours (86400 seconds).
 *
 * Per D-08: always enforced — no dev-mode bypass.
 * Per D-09: Mini App HMAC key derivation only.
 * Per D-10: 24-hour freshness window.
 */
export async function verifyInitData(initData: string, botToken: string): Promise<boolean> {
  const params = new URLSearchParams(initData);
  const hash   = params.get('hash');
  if (!hash) return false;

  params.delete('hash');
  const pairs: [string, string][] = [];
  params.forEach((v, k) => pairs.push([k, v]));
  const dataCheckString = pairs
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const encoder = new TextEncoder();

  // Step 1: derive secret key = HMAC-SHA256("WebAppData", bot_token)
  // Note: "WebAppData" is the data being signed; bot_token is the key
  const secretKey = await crypto.subtle.importKey(
    'raw', encoder.encode('WebAppData'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const secretKeyBytes = await crypto.subtle.sign('HMAC', secretKey, encoder.encode(botToken));

  // Step 2: compute HMAC-SHA256(data_check_string, secretKeyBytes)
  const dataKey = await crypto.subtle.importKey(
    'raw', secretKeyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig      = await crypto.subtle.sign('HMAC', dataKey, encoder.encode(dataCheckString));
  const computed = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');

  if (computed !== hash) return false;

  // Step 3: check auth_date freshness (24-hour window per D-10)
  const authDate = parseInt(params.get('auth_date') ?? '0', 10);
  if (Date.now() / 1000 - authDate > 86400) return false;

  return true;
}
