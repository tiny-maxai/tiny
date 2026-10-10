// Web Push without any library: VAPID signing (ES256) and message encryption (RFC 8291, aes128gcm).
// Phones get a notification even when the app is closed. Free, no card.
const enc = new TextEncoder();
const b64u = {
  enc(bytes) { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); },
  dec(str) { const p = String(str).replace(/-/g, '+').replace(/_/g, '/'); const bin = atob(p + '='.repeat((4 - (p.length % 4)) % 4)); const o = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) o[i] = bin.charCodeAt(i); return o; },
};
const cat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let p = 0; for (const x of a) { o.set(x, p); p += x.length; } return o; };

export const pushReady = (env) => !!(env.VAPID_PUBLIC && env.VAPID_PRIVATE);

async function vapidHeader(env, endpoint) {
  const aud = new URL(endpoint).origin;
  const pub = b64u.dec(env.VAPID_PUBLIC);
  const key = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: b64u.enc(pub.slice(1, 33)), y: b64u.enc(pub.slice(33, 65)), d: env.VAPID_PRIVATE, ext: true }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const head = b64u.enc(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64u.enc(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: env.VAPID_SUBJECT || 'mailto:owner@example.com' })));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(head + '.' + body)));
  return `vapid t=${head}.${body}.${b64u.enc(sig)}, k=${env.VAPID_PUBLIC}`;
}

async function hkdf(salt, ikm, info, len) {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, len * 8));
}

export async function encryptPayload(sub, payload) {
  const uaPub = b64u.dec(sub.keys.p256dh), auth = b64u.dec(sub.keys.auth);
  const eph = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', eph.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, eph.privateKey, 256));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hkdf(auth, secret, cat(enc.encode('WebPush: info\0'), uaPub, asPub), 32);
  const cek = await hkdf(salt, prk, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, prk, enc.encode('Content-Encoding: nonce\0'), 12);
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const data = cat(enc.encode(payload), new Uint8Array([2]));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, data));
  const rs = new Uint8Array([0, 0, 0x10, 0]); // 4096
  return cat(salt, rs, new Uint8Array([asPub.length]), asPub, ct);
}

export async function listSubs(env) {
  try { return (await env.KV.get('push:subs', 'json')) || []; } catch { return []; }
}
export async function addSub(env, sub, ua = '') {
  if (!sub || typeof sub.endpoint !== 'string' || !/^https:\/\//.test(sub.endpoint) || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) throw Object.assign(new Error('Bad subscription.'), { status: 400 });
  const subs = (await listSubs(env)).filter((s) => s.endpoint !== sub.endpoint);
  subs.push({ endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth }, ua: String(ua).slice(0, 120), at: Date.now() });
  await env.KV.put('push:subs', JSON.stringify(subs.slice(-8)));
  return subs.length;
}
export async function removeSub(env, endpoint) {
  const subs = (await listSubs(env)).filter((s) => s.endpoint !== endpoint);
  await env.KV.put('push:subs', JSON.stringify(subs));
}

// payload: { title, body, url, tag }. Returns how many devices accepted it.
export async function sendPush(env, payload) {
  if (!pushReady(env)) return 0;
  const subs = await listSubs(env);
  let ok = 0; const dead = [];
  const text = JSON.stringify(payload);
  await Promise.all(subs.map(async (s) => {
    try {
      const body = await encryptPayload(s, text);
      const r = await fetch(s.endpoint, { method: 'POST', headers: { Authorization: await vapidHeader(env, s.endpoint), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: 'high' }, body });
      if (r.ok) ok++; else if (r.status === 404 || r.status === 410) dead.push(s.endpoint); else console.error('[push]', r.status);
    } catch (e) { console.error('[push]', e && e.message); }
  }));
  if (dead.length) await env.KV.put('push:subs', JSON.stringify(subs.filter((s) => !dead.includes(s.endpoint))));
  return ok;
}
