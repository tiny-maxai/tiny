// Free-allowance meter. Cloudflare and Groq have no "how much is left" call inside a Worker, so we count our own calls
// (KV reads and writes, Workers AI calls, requests) in memory, save them to D1 once a minute, and read Groq's own
// "requests left" numbers from its response headers. All daily limits reset at 00:00 UTC (5:30 am India).
import { clip } from './util.js';
const pend = new Map(), vals = new Map();
let lastFlush = 0, busy = false;
export const track = (k, n = 1) => pend.set(k, (pend.get(k) || 0) + n);
export const setVal = (k, v) => { if (Number.isFinite(v)) vals.set(k, v); };
const day = () => new Date().toISOString().slice(0, 10);

export function noteGroq(scope, headers) {
  try {
    track('groq:calls');
    const left = Number(headers.get('x-ratelimit-remaining-requests')), lim = Number(headers.get('x-ratelimit-limit-requests'));
    const m = String(scope).replace(/[^a-z0-9._-]/gi, '').slice(0, 40);
    if (Number.isFinite(left) && Number.isFinite(lim)) { setVal('groqleft:' + m, left); setVal('groqlim:' + m, lim); }
  } catch (e) { /* headers missing */ }
}

// wraps KV and AI so every call is counted, without changing how they work
export function instrument(env) {
  const wrap = (obj, count) => new Proxy(obj, { get(t, p) { const v = t[p]; if (typeof v !== 'function') return v; return (...a) => { try { count(String(p), a); } catch (e) { /* never block */ } return v.apply(t, a); }; } });
  const out = { ...env };
  if (env.KV) out.KV = wrap(env.KV, (p) => track(p === 'get' || p === 'getWithMetadata' ? 'kv:read' : p === 'put' || p === 'delete' ? 'kv:write' : p === 'list' ? 'kv:list' : 'kv:other'));
  if (env.AI) out.AI = wrap(env.AI, (p, a) => { if (p === 'run') track('ai:' + String(a[0]).split('/').pop().slice(0, 40)); });
  return out;
}

export async function flush(env, force = false) {
  if (busy || !env.DB || (!pend.size && !vals.size)) return;
  if (!force && Date.now() - lastFlush < 60000) return;
  busy = true; lastFlush = Date.now();
  const p = new Map(pend), v = new Map(vals); pend.clear(); vals.clear();
  try {
    const d = day(), st = [];
    for (const [k, n] of p) st.push(env.DB.prepare('INSERT INTO usage(day,k,n) VALUES(?,?,?) ON CONFLICT(day,k) DO UPDATE SET n=n+excluded.n').bind(d, k, n));
    for (const [k, n] of v) st.push(env.DB.prepare('INSERT INTO usage(day,k,n) VALUES(?,?,?) ON CONFLICT(day,k) DO UPDATE SET n=excluded.n').bind(d, k, n));
    if (st.length) await env.DB.batch(st);
    await warn(env, d);
  } catch (e) { for (const [k, n] of p) track(k, n); for (const [k, n] of v) setVal(k, n); }   // try again next time
  finally { busy = false; }
}

const LIMITS = { 'kv:read': 100000, 'kv:write': 1000, req: 100000 };
const NAMES = { 'kv:read': 'KV reads', 'kv:write': 'KV writes', req: 'Worker requests' };
async function warn(env, d) {                                  // one warning a day for each allowance that passes 80%
  const rows = (await env.DB.prepare('SELECT k,n FROM usage WHERE day=?').bind(d).all()).results || [], m = new Map(rows.map((r) => [r.k, r.n]));
  for (const k of Object.keys(LIMITS)) {
    const n = m.get(k) || 0; if (n < LIMITS[k] * 0.8 || m.get('warned:' + k)) continue;
    await env.DB.prepare('INSERT OR REPLACE INTO usage(day,k,n) VALUES(?,?,1)').bind(d, 'warned:' + k).run();
    const { notifyOwner } = await import('./notify.js');
    await notifyOwner(env, { title: 'Free limit warning', body: `${NAMES[k]} are at ${Math.round((n / LIMITS[k]) * 100)}% of today's free limit (${n} of ${LIMITS[k]}). It resets at 5:30 am India time.`, tag: 'usage-' + k }).catch(() => null);
  }
}

export async function usageView(env) {
  await flush(env, true);
  const d = day(), rows = (await env.DB.prepare('SELECT k,n FROM usage WHERE day=?').bind(d).all().catch(() => ({ results: [] }))).results || [];
  const m = new Map(rows.map((r) => [r.k, r.n]));
  const item = (k, label, limit, note = '') => ({ k, label, used: m.get(k) || 0, limit, pct: limit ? Math.min(100, Math.round(((m.get(k) || 0) / limit) * 100)) : null, note });
  const ai = rows.filter((r) => r.k.startsWith('ai:')).map((r) => ({ model: r.k.slice(3), calls: r.n })).sort((a, b) => b.calls - a.calls);
  const groq = rows.filter((r) => r.k.startsWith('groqleft:')).map((r) => { const s = r.k.slice(9), lim = m.get('groqlim:' + s) || 0; return { model: s, left: r.n, limit: lim, pct: lim ? Math.round(((lim - r.n) / lim) * 100) : null }; }).sort((a, b) => (b.pct || 0) - (a.pct || 0)).slice(0, 4);
  return {
    day: d, resets: '5:30 am India time',
    items: [item('req', 'Worker requests', 100000), item('kv:read', 'KV reads', 100000), item('kv:write', 'KV writes (saves and deletes)', 1000, 'The tightest one. Each message she remembers and each state change is a write.'), item('kv:list', 'KV lists', 1000)],
    ai: { calls: ai.reduce((s, x) => s + x.calls, 0), models: ai.slice(0, 5), note: 'Workers AI gives 10,000 free "neurons" a day. Cloudflare does not show it from inside the app, so only calls are counted. Pictures are capped at 10 a day and style changes at 12.' },
    groq: { calls: m.get('groq:calls') || 0, models: groq, note: 'Read from Groq itself after each reply. It shows requests left today for each model.' },
  };
}
