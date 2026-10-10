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
