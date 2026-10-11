// Notes: pages you write or save from chats. Searchable by meaning, and she can read the one you have open.
import { uid, now, clip } from './util.js';
import { embed, vecDelete } from './memory.js';

async function index(env, n) {
  const vec = await embed(env, `${n.title}\n${clip(n.content, 1500)}`);
  if (!vec) return;
  try { await env.VECTORS.upsert([{ id: 'n:' + n.id, values: vec[0], metadata: { t: 'note', title: clip(n.title, 80), text: clip(n.content, 450) } }]); } catch { /* optional */ }
}

export async function listNotes(env, q) {
  const r = q
    ? await env.DB.prepare('SELECT id,title,substr(content,1,220) AS snippet,pinned,updated_at FROM notes WHERE title LIKE ?1 OR content LIKE ?1 ORDER BY pinned DESC, updated_at DESC LIMIT 200').bind(`%${q}%`).all()
    : await env.DB.prepare('SELECT id,title,substr(content,1,220) AS snippet,pinned,updated_at FROM notes ORDER BY pinned DESC, updated_at DESC LIMIT 500').all();
  return r.results || [];
}
export const getNote = (env, id) => env.DB.prepare('SELECT * FROM notes WHERE id=?').bind(id).first();

export async function createNote(env, { title, content }) {
  const t = now(), id = uid();
  title = clip(String(title || '').trim() || 'Untitled', 160); content = String(content || '').slice(0, 200000);
  await env.DB.prepare('INSERT INTO notes (id,title,content,pinned,rev,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').bind(id, title, content, 0, 1, t, t).run();
  const n = { id, title, content, pinned: 0, rev: 1, created_at: t, updated_at: t };
  await index(env, n);
  return n;
}

// Saving needs the revision you last saw. If another device saved in between, you get a 409 instead of overwriting it.
export async function saveNote(env, id, patch) {
  const cur = await getNote(env, id);
  if (!cur) return { status: 404 };
  if (patch.rev !== undefined && Number(patch.rev) !== cur.rev) return { status: 409, note: cur };
  const title = patch.title !== undefined ? clip(String(patch.title).trim() || 'Untitled', 160) : cur.title;
  const content = patch.content !== undefined ? String(patch.content).slice(0, 200000) : cur.content;
  const pinned = patch.pinned !== undefined ? (patch.pinned ? 1 : 0) : cur.pinned;
  const t = now(), rev = cur.rev + 1;
  await env.DB.prepare('UPDATE notes SET title=?,content=?,pinned=?,rev=?,updated_at=? WHERE id=?').bind(title, content, pinned, rev, t, id).run();
  const n = { ...cur, title, content, pinned, rev, updated_at: t };
  if (title !== cur.title || content !== cur.content) await index(env, n);
  return { status: 200, note: n };
}
export async function deleteNote(env, id) {
  await env.DB.prepare('DELETE FROM notes WHERE id=?').bind(id).run();
  await vecDelete(env, ['n:' + id]);
}

// Finds the notes a message is about, so she can answer from them on the very first ask
// (no "tell me to read it" step). Works without Vectorize: plain word matching in D1.
const STOP = new Set('the and you for with what that this have from about tell please can are was how why who when where which would could should there their them they your mine ours into then than just like some any all not but its it\'s hai kya mera meri mere mein main nahi aur ko ka ki ke se ye wo woh isme usme batao bata bolo read note notes show give ask answer say find check look see want need make add get let know'.split(' '));
export async function notesFor(env, text) {
  const explicit = /\bnotes?\b|\bdiary\b|नोट|\bmy (pages?|docs?|files?)\b/i.test(text);
  const words = [...new Set(String(text).toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [])].filter((w) => !STOP.has(w)).slice(0, 8);
  const out = { titles: [], notes: [], explicit };
  try {
    let rows = [];
    if (words.length) {
      const where = words.map(() => '(LOWER(title) LIKE ? OR LOWER(content) LIKE ?)').join(' OR ');
      const binds = words.flatMap((w) => [`%${w}%`, `%${w}%`]);
      rows = ((await env.DB.prepare(`SELECT id,title,content,updated_at FROM notes WHERE ${where} ORDER BY updated_at DESC LIMIT 30`).bind(...binds).all()).results || [])
        .map((n) => { const t = n.title.toLowerCase(), c = n.content.toLowerCase(); let s = 0; for (const w of words) { if (t.includes(w)) s += 3; if (c.includes(w)) s += 1; } return { ...n, s }; })
        .filter((n) => n.s >= (explicit ? 1 : 2)).sort((a, b) => b.s - a.s || b.updated_at - a.updated_at);
    }
    if (explicit) {
      out.titles = ((await env.DB.prepare('SELECT title FROM notes ORDER BY pinned DESC, updated_at DESC LIMIT 25').all()).results || []).map((r) => r.title);
      if (!rows.length && out.titles.length) rows = (await env.DB.prepare('SELECT id,title,content,updated_at FROM notes ORDER BY pinned DESC, updated_at DESC LIMIT 3').all()).results || [];
    }
    let budget = 9000;
    for (const n of rows.slice(0, 3)) { const t = clip(n.content, Math.min(4000, budget)); budget -= t.length; out.notes.push({ title: n.title, text: t }); if (budget < 300) break; }
  } catch (e) { console.error('[notesFor]', e && e.message); }
  return out;
}
