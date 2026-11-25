// KURS VPN: Telegram account API for Cloudflare Workers + D1.
// BOT_TOKEN must be configured as a Worker secret, not committed to git.
const encoder = new TextEncoder();

async function importHmac(key) {
  return crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function verifiedUser(initData, botToken) {
  if (typeof initData !== 'string' || !initData || initData.length > 12000) return null;
  const params = new URLSearchParams(initData);
  const keys = [...params.keys()];
  if (new Set(keys).size !== keys.length) return null;
  const hash = params.get('hash');
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) return null;
  params.delete('hash');
  const check = [...params.entries()]
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, value]) => `${key}=${value}`).join('\n');
  const rootKey = await importHmac(encoder.encode('WebAppData'));
  const derived = await crypto.subtle.sign('HMAC', rootKey, encoder.encode(botToken));
  const signingKey = await importHmac(derived);
  const supplied = Uint8Array.from(hash.match(/../g), pair => parseInt(pair, 16));
  if (!await crypto.subtle.verify('HMAC', signingKey, supplied, encoder.encode(check))) return null;
  const authDate = Number(params.get('auth_date'));
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isInteger(authDate) || authDate > now + 60 || now - authDate > 86400) return null;
  try {
    const user = JSON.parse(params.get('user') || 'null');
    return user && Number.isSafeInteger(user.id) && user.id > 0 && !user.is_bot ? user : null;
  } catch { return null; }
}

function json(status, data, headers) {
  const h = new Headers(headers);
  h.set('Content-Type', 'application/json; charset=utf-8');
  h.set('Cache-Control', 'no-store');
  h.set('X-Content-Type-Options', 'nosniff');
  return new Response(JSON.stringify(data), { status, headers: h });
}

export default {
  async fetch(request, env) {
    const headers = new Headers({ Vary: 'Origin' });
    const origin = request.headers.get('Origin');
    if (!env.BOT_TOKEN || !env.FRONTEND_ORIGIN || !env.DB) return json(503, { error: 'Service is not configured' }, headers);
    if (origin && origin !== env.FRONTEND_ORIGIN) return json(403, { error: 'Origin not allowed' }, headers);
    if (origin) {
      headers.set('Access-Control-Allow-Origin', origin);
      headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      headers.set('Access-Control-Allow-Headers', 'Content-Type');
    }
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    const path = new URL(request.url).pathname;
    if (request.method === 'GET' && path === '/health') return json(200, { ok: true }, headers);
    if (request.method !== 'POST' || path !== '/api/me') return json(404, { error: 'Not found' }, headers);
    if (Number(request.headers.get('content-length') || 0) > 16384) return json(413, { error: 'Request too large' }, headers);
    try {
      const bodyText = await request.text();
      if (encoder.encode(bodyText).length > 16384) return json(413, { error: 'Request too large' }, headers);
      const body = JSON.parse(bodyText);
      const user = await verifiedUser(body?.initData, env.BOT_TOKEN);
      if (!user) return json(401, { error: 'Invalid Telegram authorization' }, headers);
      const firstName = typeof user.first_name === 'string' ? user.first_name.slice(0, 100) : '';
      const row = await env.DB.prepare(`INSERT INTO users (telegram_id, first_name) VALUES (?, ?)
        ON CONFLICT(telegram_id) DO UPDATE SET first_name = excluded.first_name
        RETURNING telegram_id, first_name, subscription_until`).bind(user.id, firstName).first();
      if (!row) throw new Error('Database error');
      const expiresAt = row.subscription_until;
      const active = Boolean(expiresAt) && new Date(expiresAt).getTime() > Date.now();
      return json(200, { telegramId: row.telegram_id, firstName: row.first_name, subscription: { active, expiresAt } }, headers);
    } catch (error) {
      if (error instanceof SyntaxError) return json(400, { error: 'Invalid JSON' }, headers);
      // Avoid logging secrets or Telegram initData.
      console.error('Account request failed');
      return json(500, { error: 'Server error' }, headers);
    }
  },
};
