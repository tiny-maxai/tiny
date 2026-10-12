// The "brain": facts in D1, meaning-search in Vectorize. Everything degrades gracefully:
// if embeddings or Vectorize are unavailable, recall falls back to plain keyword search.
import { uid, now, clip, parseJsonLoose } from './util.js';
import { complete } from './ai.js';

const EMBED_MODEL = '@cf/baai/bge-m3';
// Two memories live in one table: category 'self' is HER memory (who she is), every other category is THEIR memory (who the person is).
const CATS = ['profile', 'preference', 'project', 'people', 'plan', 'other', 'self'];

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

// Both memories, separately. HER memory (who she is) is always loaded; THEIR memory is the pinned/important facts
// plus the ones closest in meaning to the new message.
export async function recall(env, query) {
  const [always, selfAlways, vec] = await Promise.all([
    env.DB.prepare("SELECT text,category FROM memories WHERE category<>'self' AND (pinned=1 OR importance>=4) ORDER BY pinned DESC, importance DESC, updated_at DESC LIMIT 16").all().then((r) => r.results || []).catch(() => []),
    env.DB.prepare("SELECT text,category FROM memories WHERE category='self' ORDER BY pinned DESC, importance DESC, updated_at DESC LIMIT 14").all().then((r) => r.results || []).catch(() => []),
    embed(env, query),
  ]);
  let facts = [], chats = [], notes = [];
  if (vec) {
    try {
      const q = await env.VECTORS.query(vec[0], { topK: 20, returnMetadata: 'all' });
      const hits = [];
      for (const m of q.matches || []) {
        if (!m.metadata || m.score < 0.45) continue;
        if (m.metadata.t === 'fact' && hits.length < 8) hits.push({ id: String(m.id).replace(/^f:/, ''), text: m.metadata.text });
        else if (m.metadata.t === 'chat' && chats.length < 4) chats.push({ role: m.metadata.role, text: m.metadata.text, ts: m.metadata.ts });
        else if (m.metadata.t === 'note' && notes.length < 2) notes.push({ title: m.metadata.title, text: m.metadata.text });
      }
      if (hits.length) {   // the table knows which memory each fact belongs to
        const rows = await env.DB.prepare(`SELECT id,text,category FROM memories WHERE id IN (${hits.map(() => '?').join(',')})`).bind(...hits.map((h) => h.id)).all().then((r) => r.results || []).catch(() => []);
        const byId = new Map(rows.map((r) => [r.id, r]));
        facts = hits.map((h) => (byId.get(h.id) ? { text: byId.get(h.id).text, category: byId.get(h.id).category } : { text: h.text, category: '' }));
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
  const seen = new Set([...always, ...selfAlways].map((f) => f.text));
  facts = facts.filter((f) => !seen.has(f.text));
  return { always, selfAlways, facts: facts.filter((f) => f.category !== 'self'), selfFacts: facts.filter((f) => f.category === 'self'), chats, notes };
}

// Asks the model for lasting facts in a conversation text and sorts them into the two memories:
// owner "user" = about the person, owner "self" = about her (who she is, her life, how she should act, what her creator told her).
export async function askFacts(env, { name, transcript, existing, creator = false, brain = 'fast', max = 6 }) {
  const sys = `You maintain TWO private memories for an AI companion called ${name} and the person who made her (her creator and close friend).
From the conversation, pull out lasting facts of two kinds:
- owner "user": facts about THEM: who they are, preferences, projects, people in their life, plans, goals, routines, important dates, things they dislike.
- owner "self": facts about ${name} HERSELF: who she is, her personality, likes, friends and life details, how she should talk or behave, her relationship with the person, and anything the person tells or changes about her (they created her, so what they say about her is true for her). ${creator ? 'They are updating her right now: keep EVERY statement about her, importance 5, pinned true.' : 'Keep a self fact only if the person said it about her, or if she clearly introduced a stable detail about her own life (favourite food, a friend) in her reply.'}
Rules:
- Pronouns: in what THEY say, "you/your/tum/tera/aap" means ${name} (owner self) and "me/my/I/main/mera/mujhe" means the person (owner user). In what ${name} says it is the other way round. Never file a fact under the wrong owner.
- Only facts that were stated or clearly confirmed. Never invent or guess.
- Short, standalone, third person. User facts start with "Likes", "Is building", "Plans to"... Self facts start with "${name}" (for example "${name} loves pasta", "${name} was created by the person she talks to"). Max 25 words each.
- Skip small talk, one-off questions, anything temporary, and anything already known (list below).
- NEVER store passwords, OTPs, card or bank numbers, or government ID numbers.
- If they say "remember this", set importance 5 and pinned true.
Return ONLY JSON: {"facts":[{"text":"...","owner":"user|self","category":"profile|preference|project|people|plan|other","importance":1-5,"pinned":false}]}. Use {"facts":[]} when nothing qualifies.
Already known:\n${existing || '(nothing yet)'}`;
  const r = await complete(env, { brain, temperature: 0.1, maxTokens: 900, json: true, messages: [{ role: 'system', content: sys }, { role: 'user', content: transcript }] });
  const parsed = parseJsonLoose(r.text);
  return (parsed && Array.isArray(parsed.facts) ? parsed.facts : []).slice(0, max)
    .filter((f) => f && typeof f.text === 'string' && !/\b(password|otp|cvv|aadhaar|aadhar|pan number|card number)\b/i.test(f.text))
    .map((f) => ({ ...f, category: f.owner === 'self' ? 'self' : (CATS.includes(f.category) && f.category !== 'self' ? f.category : 'other') }));
}
export const knownFacts = (env) => env.DB.prepare('SELECT text,category FROM memories ORDER BY updated_at DESC LIMIT 30').all().then((r) => (r.results || []).map((x) => '- ' + (x.category === 'self' ? '(her) ' : '') + x.text).join('\n')).catch(() => '');

// After a reply: ask the model what is worth remembering. Runs in the background.
export async function extractAndStore(env, { convId, userText, reply, source = 'auto', brain = 'fast', review = false, name = 'Tiny', creator = false }) {
  if (!userText || userText.trim().length < 8) return [];
  let facts;
  try { facts = await askFacts(env, { name, brain, creator, max: creator ? 10 : 6, existing: await knownFacts(env), transcript: `Person said:\n${clip(userText, 1500)}\n\n${name} replied:\n${clip(reply, 800)}` }); } catch { return []; }
  const out = [];
  for (const f of facts) {
    if (review) { await addPending(env, f); continue; }
    const mine = f.category === 'self';
    const saved = await remember(env, { text: f.text, category: f.category, importance: mine && creator ? 5 : f.importance, pinned: mine && creator ? 1 : (f.pinned ? 1 : 0), source: mine && creator ? 'creator' : source, convId }).catch(() => null);
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
