// Two Groq accounts: GROQ_API_KEY first, GROQ_API_KEY_2 when the first one is rate limited or out of quota.
// A key that just said "429" is skipped for a while (for that model or service), so the next requests do not waste time on it.
const cool = new Map();                                    // `${keyIndex}|${scope}` -> time it may be tried again

export const groqKeys = (env) => [env.GROQ_API_KEY, env.GROQ_API_KEY_2].map((k) => String(k || '').trim()).filter(Boolean);
export const hasGroq = (env) => groqKeys(env).length > 0;

const limited = (s) => s === 429 || s === 401 || s === 402 || s === 403;

// make(key) must return a fetch Response. Returns the first answer that is not a key problem.
export async function groqFetch(env, scope, make) {
  const keys = groqKeys(env), t = Date.now();
  const order = keys.map((key, i) => ({ key, i, until: cool.get(i + '|' + scope) || 0 })).sort((a, b) => (a.until > t) - (b.until > t) || a.i - b.i);
  let last = null;
  for (const k of order) {
    let res;
    try { res = await make(k.key); } catch (e) { last = last || null; continue; }     // network trouble: try the other key
    if (!limited(res.status)) { cool.delete(k.i + '|' + scope); return res; }
    const ra = Number(res.headers && res.headers.get && res.headers.get('retry-after'));
    cool.set(k.i + '|' + scope, t + Math.min(30 * 60000, Math.max(20000, (Number.isFinite(ra) && ra > 0 ? ra : 60) * 1000)));
    last = res;
  }
  if (last) return last;
  throw new Error('groq: network');
}
