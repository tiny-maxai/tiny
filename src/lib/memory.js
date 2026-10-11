// The "brain": facts in D1, meaning-search in Vectorize. Everything degrades gracefully:
// if embeddings or Vectorize are unavailable, recall falls back to plain keyword search.
import { uid, now, clip, parseJsonLoose } from './util.js';
import { complete } from './ai.js';

const EMBED_MODEL = '@cf/baai/bge-m3';
const CATS = ['profile', 'preference', 'project', 'people', 'plan', 'other'];

// Meaning search is optional: without a Vectorize index there is nothing to compare with, so we skip the (slow) embedding call completely.
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
export async function embed(env, texts) {
  if (!env.AI || !env.VECTORS) return null;
  try {
    const arr = Array.isArray(texts) ? texts : [texts];
    const r = await withTimeout(env.AI.run(EMBED_MODEL, { text: arr.map((t) => clip(t, 2000)) }), 2500);
    const data = r && (r.data || r);
    return Array.isArray(data) && Array.isArray(data[0]) ? data : null;
  } catch (e) { console.error('[embed]', e && e.message); return null; }
}

async function vecUpsert(env, items) {
  try { await env.VECTORS.upsert(items); return true; } catch (e) { console.error('[vectorize upsert]', e && e.message); return false; }
}
export async function vecDelete(env, ids) {
  try { if (ids.length) await env.VECTORS.deleteByIds(ids); } catch (e) { console.error('[vectorize delete]', e && e.message); }
}

// Save a fact. If almost the same fact exists already, update that one instead of duplicating.
export async function remember(env, { text, category = 'other', importance = 3, pinned = 0, source = 'auto', convId = null }) {
  text = clip(String(text || '').trim(), 400);
  if (text.length < 3) return null;
  category = CATS.includes(category) ? category : 'other';
  importance = Math.min(5, Math.max(1, parseInt(importance, 10) || 3));
  const t = now();
  let id = null;
  const same = await env.DB.prepare('SELECT id FROM memories WHERE LOWER(text)=LOWER(?)').bind(text).first().catch(() => null);
  if (same) id = same.id;
  const vec = await embed(env, text);
  if (vec && !id) {
    try {
      const q = await env.VECTORS.query(vec[0], { topK: 3, returnMetadata: 'all' });
      const hit = (q.matches || []).find((m) => m.metadata && m.metadata.t === 'fact' && m.score >= 0.93);
      if (hit) id = hit.id.replace(/^f:/, '');
    } catch { /* no dedupe, still save */ }
  }
  if (id) {
    await env.DB.prepare('UPDATE memories SET text=?, category=?, importance=MAX(importance,?), pinned=MAX(pinned,?), updated_at=? WHERE id=?')
      .bind(text, category, importance, pinned ? 1 : 0, t, id).run();
  } else {
    id = uid();
    await env.DB.prepare('INSERT INTO memories (id,text,category,importance,pinned,source,conv_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .bind(id, text, category, importance, pinned ? 1 : 0, source, convId, t, t).run();
  }
  if (vec) await vecUpsert(env, [{ id: 'f:' + id, values: vec[0], metadata: { t: 'fact', text } }]);
  return { id, text, category, importance, pinned: pinned ? 1 : 0 };
}

export async function forget(env, id) {
  await env.DB.prepare('DELETE FROM memories WHERE id=?').bind(id).run();
  await vecDelete(env, ['f:' + id]);
}

export async function updateMemory(env, id, patch) {
  const row = await env.DB.prepare('SELECT * FROM memories WHERE id=?').bind(id).first();
  if (!row) return null;
  const text = patch.text !== undefined ? clip(String(patch.text).trim(), 400) : row.text;
  const pinned = patch.pinned !== undefined ? (patch.pinned ? 1 : 0) : row.pinned;
  const category = CATS.includes(patch.category) ? patch.category : row.category;
  const importance = patch.importance !== undefined ? Math.min(5, Math.max(1, parseInt(patch.importance, 10) || row.importance)) : row.importance;
  await env.DB.prepare('UPDATE memories SET text=?,pinned=?,category=?,importance=?,updated_at=? WHERE id=?').bind(text, pinned, category, importance, now(), id).run();
  if (text !== row.text) {
    const vec = await embed(env, text);
    if (vec) await vecUpsert(env, [{ id: 'f:' + id, values: vec[0], metadata: { t: 'fact', text } }]);
  }
  return { ...row, text, pinned, category, importance };
}

// Index a chat message so old conversations can be found by meaning.
export async function indexChat(env, messageId, role, text, convId) {
  if (!text || text.trim().length < 12) return;
  const vec = await embed(env, text);
  if (vec) await vecUpsert(env, [{ id: 'c:' + messageId, values: vec[0], metadata: { t: 'chat', role, conv: convId, text: clip(text, 600), ts: now() } }]);
}

// Always-on facts (pinned or important) plus the ones closest in meaning to the new message.
export async function recall(env, query) {
  // the two lookups do not depend on each other, so they run together
  const [always, vec] = await Promise.all([
    env.DB.prepare('SELECT text,category FROM memories WHERE pinned=1 OR importance>=4 ORDER BY pinned DESC, importance DESC, updated_at DESC LIMIT 20').all().then((r) => r.results || []).catch(() => []),
    embed(env, query),
  ]);
  let facts = [], chats = [], notes = [];
  if (vec) {
    try {
      const q = await env.VECTORS.query(vec[0], { topK: 20, returnMetadata: 'all' });
      for (const m of q.matches || []) {
        if (!m.metadata || m.score < 0.45) continue;
        if (m.metadata.t === 'fact' && facts.length < 8) facts.push({ text: m.metadata.text, category: '' });
        else if (m.metadata.t === 'chat' && chats.length < 4) chats.push({ role: m.metadata.role, text: m.metadata.text, ts: m.metadata.ts });
        else if (m.metadata.t === 'note' && notes.length < 2) notes.push({ title: m.metadata.title, text: m.metadata.text });
      }
    } catch (e) { console.error('[vectorize query]', e && e.message); }
  }
  if (!vec || (!facts.length && !chats.length && !notes.length)) {
    // keyword fallback
    const words = [...new Set(String(query).toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) || [])].slice(0, 6);
    if (words.length) {
      const where = words.map(() => 'LOWER(text) LIKE ?').join(' OR ');
      const r = await env.DB.prepare(`SELECT text,category FROM memories WHERE ${where} ORDER BY updated_at DESC LIMIT 8`).bind(...words.map((w) => `%${w}%`)).all().catch(() => ({ results: [] }));
      facts = r.results || [];
    }
  }
  const seen = new Set(always.map((f) => f.text));
  facts = facts.filter((f) => !seen.has(f.text));
  return { always, facts, chats, notes };
}

// After a reply: ask the model what is worth remembering. Runs in the background.
export async function extractAndStore(env, { convId, userText, reply, source = 'auto', brain = 'fast', review = false }) {
  if (!userText || userText.trim().length < 8) return [];
  const existing = await env.DB.prepare('SELECT text FROM memories ORDER BY updated_at DESC LIMIT 30').all().then((r) => (r.results || []).map((x) => '- ' + x.text).join('\n')).catch(() => '');
  const sys = `You maintain a private memory for one person. From the latest exchange, pull out lasting facts worth remembering about THEM: who they are, preferences, projects, people in their life, plans, goals, routines, important dates, things they dislike.
Rules:
- Only facts the person stated or clearly confirmed. Never invent or guess.
- Short, standalone, third person starting with "Likes", "Is building", "Plans to", etc. Max 25 words each.
- Skip small talk, one-off questions, anything temporary, and anything already known (list below).
- NEVER store passwords, OTPs, card or bank numbers, or government ID numbers.
- If they say "remember this", set importance 5 and pinned true.
Return ONLY JSON: {"facts":[{"text":"...","category":"profile|preference|project|people|plan|other","importance":1-5,"pinned":false}]}. Use {"facts":[]} when nothing qualifies.
Already known:\n${existing || '(nothing yet)'}`;
  let r;
  try {
    r = await complete(env, { brain, temperature: 0.1, maxTokens: 500, json: true, messages: [{ role: 'system', content: sys }, { role: 'user', content: `Person said:\n${clip(userText, 1500)}\n\nAssistant replied:\n${clip(reply, 800)}` }] });
  } catch { return []; }
  const parsed = parseJsonLoose(r.text);
  const out = [];
  for (const f of (parsed && Array.isArray(parsed.facts) ? parsed.facts : []).slice(0, 6)) {
    if (!f || typeof f.text !== 'string') continue;
    if (/\b(password|otp|cvv|aadhaar|aadhar|pan number|card number)\b/i.test(f.text)) continue;
    if (review) { await addPending(env, f); continue; }
    const saved = await remember(env, { text: f.text, category: f.category, importance: f.importance, pinned: f.pinned ? 1 : 0, source, convId }).catch(() => null);
    if (saved) out.push(saved);
  }
  return out;
}

// ---- review before remembering: new facts wait here until you approve them ----
export async function getPending(env) { return (await env.KV.get('pending', 'json').catch(() => null)) || []; }
async function addPending(env, f) {
  const list = await getPending(env);
  const text = clip(String(f.text).trim(), 400);
  if (list.some((p) => p.text.toLowerCase() === text.toLowerCase())) return;
  list.push({ id: uid(), text, category: CATS.includes(f.category) ? f.category : 'other', importance: Math.min(5, Math.max(1, parseInt(f.importance, 10) || 3)), pinned: f.pinned ? 1 : 0, at: now() });
  await env.KV.put('pending', JSON.stringify(list.slice(-40)));
}
export async function resolvePending(env, id, approve) {
  const list = await getPending(env);
  const targets = id === 'all' ? list : list.filter((p) => p.id === id);
  const rest = id === 'all' ? [] : list.filter((p) => p.id !== id);
  await env.KV.put('pending', JSON.stringify(rest));
  let saved = 0;
  if (approve) for (const p of targets) if (await remember(env, { text: p.text, category: p.category, importance: p.importance, pinned: p.pinned, source: 'auto' }).catch(() => null)) saved++;
  return { saved, left: rest.length };
}
