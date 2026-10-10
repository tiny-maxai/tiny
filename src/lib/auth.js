// Single-owner login. ACCESS_KEY (a Worker secret) is your passphrase.
// Login returns a session token = HMAC(ACCESS_KEY). Change ACCESS_KEY and every old session stops working.
import { hmacHex, safeEqual, json } from './util.js';

const sessionToken = (env) => hmacHex(env.ACCESS_KEY, 'memory-ai-session-v1');

export async function checkAuth(request, env) {
  if (!env.ACCESS_KEY) return { ok: false, res: json({ error: 'ACCESS_KEY is not set. Run: npx wrangler secret put ACCESS_KEY' }, 503) };
  const h = request.headers.get('Authorization') || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (t && (await safeEqual(t, await sessionToken(env)))) return { ok: true };
  return { ok: false, res: json({ error: 'Please log in.' }, 401) };
}

// Failed-login brake (protects your private memories from guessing; it does not limit normal use).
export async function login(request, env) {
  if (!env.ACCESS_KEY) return json({ error: 'ACCESS_KEY is not set on the server yet.' }, 503);
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const bucket = `fail:${ip}:${new Date().toISOString().slice(0, 13)}`;
  const fails = parseInt((await env.KV.get(bucket)) || '0', 10) || 0;
  if (fails >= 10) return json({ error: 'Too many wrong tries. Wait an hour and try again.' }, 429);
  let body; try { body = await request.json(); } catch { body = {}; }
  if (body && typeof body.key === 'string' && (await safeEqual(body.key, env.ACCESS_KEY))) {
    return json({ token: await sessionToken(env) });
  }
  await env.KV.put(bucket, String(fails + 1), { expirationTtl: 3700 });
  return json({ error: 'That key is not right.' }, 401);
}
