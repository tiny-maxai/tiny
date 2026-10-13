// Lists: tick-off lists. You can speak (Whisper on Groq) or type, and she turns it into short points with fixed grammar.
import { uid, now, clip, parseJsonLoose } from './util.js';
import { complete } from './ai.js';

const parse = (s) => { try { const a = JSON.parse(s || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } };
const out = (r) => ({ id: r.id, title: r.title, items: parse(r.items), pinned: !!r.pinned, created_at: r.created_at, updated_at: r.updated_at });
const cleanItems = (items) => (Array.isArray(items) ? items : []).slice(0, 300).map((x) => ({ id: String((x && x.id) || uid()).slice(0, 40), t: clip(String((x && x.t) || '').trim(), 400), done: x && x.done ? 1 : 0 })).filter((x) => x.t);

export async function listLists(env) {
  const r = await env.DB.prepare('SELECT * FROM lists ORDER BY pinned DESC, updated_at DESC LIMIT 200').all();
  return (r.results || []).map(out);
}
export async function getList(env, id) { const r = await env.DB.prepare('SELECT * FROM lists WHERE id=?').bind(id).first(); return r ? out(r) : null; }
export async function createList(env, b = {}) {
  const id = uid(), t = now();
  await env.DB.prepare('INSERT INTO lists (id,title,items,pinned,created_at,updated_at) VALUES (?,?,?,?,?,?)').bind(id, clip(String(b.title || 'New list').trim(), 120) || 'New list', JSON.stringify(cleanItems(b.items)), b.pinned ? 1 : 0, t, t).run();
  return getList(env, id);
}
export async function saveList(env, id, b = {}) {
  const cur = await getList(env, id); if (!cur) return null;
  const title = b.title !== undefined ? clip(String(b.title).trim(), 120) || 'New list' : cur.title;
  const items = b.items !== undefined ? cleanItems(b.items) : cur.items;
  const pinned = b.pinned !== undefined ? (b.pinned ? 1 : 0) : (cur.pinned ? 1 : 0);
  await env.DB.prepare('UPDATE lists SET title=?, items=?, pinned=?, updated_at=? WHERE id=?').bind(title, JSON.stringify(items), pinned, now(), id).run();
  return getList(env, id);
}
export const deleteList = (env, id) => env.DB.prepare('DELETE FROM lists WHERE id=?').bind(id).run();

// Spoken or typed text -> short clean points. mode "fix" keeps one point per line and only fixes grammar and spelling.
export async function tidyPoints(env, text, mode = 'points', lang = '') {
  text = clip(String(text || '').trim(), 6000);
  if (!text) return { title: '', points: [] };
  const rule = mode === 'fix'
    ? 'Each input line is one point. Keep the same lines in the same order. Only fix grammar, spelling, capital letters and punctuation.'
    : 'The text may be spoken (with fillers like "umm", "uh", repeated words, "and then") or typed. Turn it into separate short points: one idea per point, at most about 14 words each. Remove fillers and repeats. Split when several things are mentioned. Do not add anything the person did not say.';
  const L = { en: 'Write every point in English (translate if needed).', hi: 'Write every point in Hindi, in Devanagari script (हिंदी).', hinglish: 'Write every point in Hinglish: Hindi words in Roman (English) letters, not Devanagari.' }[lang] || '';
  try {
    const r = await complete(env, {
      brain: 'fast', temperature: 0.1, maxTokens: 900, json: true,
      messages: [
        { role: 'system', content: `You clean up text for a to-do or notes list. ${rule} Fix grammar and spelling. ${L || "Keep the person's language: English stays English, Hindi in Devanagari stays Devanagari, Hinglish (Hindi in Roman letters) stays Hinglish."} Return JSON only: {"title": "a 2 to 4 word title for the list, or empty string", "points": ["...", "..."]}.` },
        { role: 'user', content: text },
      ],
    });
    const p = parseJsonLoose(r.text);
    const pts = p && Array.isArray(p.points) ? p.points.map((x) => clip(String(x || '').replace(/^[-•*\d.)\s]+/, '').trim(), 300)).filter(Boolean) : [];
    if (pts.length) return { title: clip(String((p && p.title) || ''), 60), points: pts.slice(0, 60) };
  } catch (e) { console.error('[lists tidy]', e && e.message); }
  const pts = text.split(/\n|[.;!?]+\s|\s*,\s*(?=\w)|\s+(?:and then|then|aur phir|phir)\s+/i).map((x) => x.replace(/^[-•*\d.)\s]+/, '').trim()).filter((x) => x.length > 1).map((x) => x[0].toUpperCase() + x.slice(1));
  return { title: '', points: pts.slice(0, 60) };
}
