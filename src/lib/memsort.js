// One-time sorting of everything she already has into the two memories.
//   1) every saved memory is classified: about THEM (stays) or about HER (moved to her own memory),
//   2) recent chat history is read in chunks and mined for facts about both, so nothing told in the past is lost.
// It starts by itself the first time the app is opened after this update, works in small resumable steps
// (the every-minute cron finishes it if the app is closed) and never runs again unless you press "Sort again".
import { clip, now, parseJsonLoose } from './util.js';
import { complete } from './ai.js';
import { askFacts, knownFacts, remember } from './memory.js';
import { getSettings } from './settings.js';

const KEY = 'mem:sort';
const BATCH = 40, HISTORY_MESSAGES = 240, HIST_CHUNK = 40, CALLS_PER_STEP = 3;
export const getSortState = (env) => env.KV.get(KEY, 'json').then((v) => v || null).catch(() => null);
const putState = (env, s) => env.KV.put(KEY, JSON.stringify(s));

export async function startSort(env, { force = false } = {}) {
  const cur = await getSortState(env);
  if (cur && !force) return cur;
  const total = await env.DB.prepare('SELECT COUNT(*) AS n FROM memories').first().then((r) => r.n).catch(() => 0);
  const s = { phase: 'memories', cursor: 0, total, moved: 0, kept: 0, added: 0, addedSelf: 0, startedAt: now(), updatedAt: 0, done: false };
  await putState(env, s);
  return s;
}

async function classify(env, name, rows) {
  const list = rows.map((r, i) => `${i}. ${r.text}`).join('\n');
  const r = await complete(env, {
    brain: 'fast', temperature: 0, maxTokens: 500, json: true,
    messages: [
      { role: 'system', content: `${name} is an AI companion. Her creator and close friend is the person she talks to. Below are saved memory lines. For each one decide who it is about:\n"user" = about the person (who they are, what they like, their projects, people, plans, routines),\n"self" = about ${name} herself (her personality, likes, friends, life, how she should talk or act, what the person told her about herself or about their relationship).\nReturn ONLY JSON: {"self":[numbers of the lines that are about ${name}]}. Lines about the person stay out of the list. When unsure, treat it as "user".` },
      { role: 'user', content: list },
    ],
  });
  const p = parseJsonLoose(r.text);
  return new Set((p && Array.isArray(p.self) ? p.self : []).map((n) => parseInt(n, 10)).filter((n) => n >= 0 && n < rows.length));
}

// One small step. Returns the new state. Safe to call often.
export async function sortStep(env) {
  const s = await getSortState(env);
  if (!s || s.done) return s;
  if (now() - (s.updatedAt || 0) < 40000 && s.running) return s;          // another step is still working
  s.running = true; s.updatedAt = now(); await putState(env, s);
  const st = await getSettings(env), name = st.persona.name;
  try {
    for (let calls = 0; calls < CALLS_PER_STEP && !s.done; calls++) {
      if (s.phase === 'memories') {
        const rows = (await env.DB.prepare("SELECT id,text,category FROM memories ORDER BY created_at, id LIMIT ? OFFSET ?").bind(BATCH, s.cursor).all()).results || [];
        if (!rows.length) { s.phase = 'history'; s.cursor = 0; continue; }
        const mine = await classify(env, name, rows);
        for (let i = 0; i < rows.length; i++) {
          if (mine.has(i) && rows[i].category !== 'self') { await env.DB.prepare("UPDATE memories SET category='self',updated_at=? WHERE id=?").bind(now(), rows[i].id).run(); s.moved++; }
          else s.kept++;
        }
        s.cursor += rows.length;
      } else {
        // history: oldest of the recent messages first, in chunks, skipping her own scheduled routines
        const total = Math.min(HISTORY_MESSAGES, await env.DB.prepare("SELECT COUNT(*) AS n FROM messages WHERE conv_id<>'routines'").first().then((r) => r.n).catch(() => 0));
        if (s.cursor >= total) { s.done = true; s.finishedAt = now(); continue; }
        const rows = (await env.DB.prepare("SELECT role,content FROM (SELECT id,role,content FROM messages WHERE conv_id<>'routines' ORDER BY id DESC LIMIT ?) ORDER BY id LIMIT ? OFFSET ?").bind(total, HIST_CHUNK, s.cursor).all()).results || [];
        if (!rows.length) { s.done = true; s.finishedAt = now(); continue; }
        const transcript = rows.map((m) => `${m.role === 'user' ? 'Person' : name}: ${clip(m.content, 300)}`).join('\n');
        try {
          const facts = await askFacts(env, { name, transcript, existing: await knownFacts(env), max: 10 });
          for (const f of facts) {
            const saved = await remember(env, { text: f.text, category: f.category, importance: f.importance, pinned: f.pinned ? 1 : 0, source: 'sorted' }).catch(() => null);
            if (saved) { s.added++; if (saved.category === 'self') s.addedSelf++; }
          }
        } catch { /* a bad chunk is skipped, the rest still runs */ }
        s.cursor += rows.length;
      }
    }
  } catch (e) { console.error('[memsort]', e && e.message); }
  s.running = false; s.updatedAt = now();
  await putState(env, s);
  return s;
}

// Used by the cron: keeps going until it is finished.
export async function sortTick(env) {
  const s = await getSortState(env);
  if (!s || s.done) return;
  if (s.running && now() - s.updatedAt < 90000) return;
  s.running = false; await sortStep(env);
}
