'use strict';

// Node.js 24 LTS; no external packages are required.
const http = require('node:http');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const token = process.env.BOT_TOKEN;
const origin = process.env.FRONTEND_ORIGIN;
const port = Number(process.env.PORT || 3000);
const dbPath = process.env.DB_PATH || './kurs-vpn.db';
if (!token || !origin) throw new Error('Set BOT_TOKEN and FRONTEND_ORIGIN');
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');

const db = new DatabaseSync(dbPath);
db.exec(`CREATE TABLE IF NOT EXISTS users (
  telegram_id INTEGER PRIMARY KEY,
  first_name TEXT NOT NULL DEFAULT '',
  subscription_until TEXT
)`);
const upsert = db.prepare(`INSERT INTO users (telegram_id, first_name) VALUES (?, ?)
  ON CONFLICT(telegram_id) DO UPDATE SET first_name = excluded.first_name`);
const find = db.prepare('SELECT telegram_id, first_name, subscription_until FROM users WHERE telegram_id = ?');

function verify(initData) {
  if (typeof initData !== 'string' || !initData || initData.length > 12000) return null;
  const params = new URLSearchParams(initData);
  const keys = [...params.keys()];
  if (new Set(keys).size !== keys.length) return null;
  const hash = params.get('hash');
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) return null;
  params.delete('hash');
  const check = [...params.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  const expected = crypto.createHmac('sha256', secret).update(check).digest();
  if (!crypto.timingSafeEqual(expected, Buffer.from(hash, 'hex'))) return null;
  const authDate = Number(params.get('auth_date'));
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isInteger(authDate) || authDate > now + 60 || now - authDate > 86400) return null;
  try {
    const user = JSON.parse(params.get('user') || 'null');
    if (!user || !Number.isSafeInteger(user.id) || user.id <= 0 || user.is_bot) return null;
    return user;
  } catch { return null; }
}

function json(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(data));
}

http.createServer(async (req, res) => {
  const requestOrigin = req.headers.origin;
  if (requestOrigin === origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  } else if (requestOrigin) return json(res, 403, { error: 'Origin not allowed' });
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  if (req.method === 'GET' && req.url === '/health') return json(res, 200, { ok: true });
  if (req.method !== 'POST' || req.url !== '/api/me') return json(res, 404, { error: 'Not found' });
  try {
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 16384) return json(res, 413, { error: 'Request too large' });
      chunks.push(chunk);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const user = verify(body?.initData);
    if (!user) return json(res, 401, { error: 'Invalid Telegram authorization' });
    const firstName = typeof user.first_name === 'string' ? user.first_name.slice(0, 100) : '';
    upsert.run(user.id, firstName);
    const row = find.get(user.id);
    const expiresAt = row.subscription_until;
    const active = Boolean(expiresAt) && new Date(expiresAt).getTime() > Date.now();
    return json(res, 200, { telegramId: row.telegram_id, firstName: row.first_name, subscription: { active, expiresAt } });
  } catch (err) {
    if (err instanceof SyntaxError) return json(res, 400, { error: 'Invalid JSON' });
    console.error('Request failed');
    return json(res, 500, { error: 'Server error' });
  }
}).listen(port, () => console.log(`KURS VPN backend listening on ${port}`));
