// The chat pipeline shared by the website and Telegram:
// save the message, recall memories, build the prompt, (stream) the answer, save it, learn new facts.
import { uid, now, clip } from './util.js';
import { getSettings } from './settings.js';
import { recall, indexChat, extractAndStore } from './memory.js';
import { buildSystem } from './persona.js';
import { complete } from './ai.js';
import { getNote } from './notes.js';
import { moodContext } from './moods.js';
import { periodNow } from './period.js';
import { assist } from './assist.js';
import { tinyMoodNow } from './tinymood.js';

export async function ensureConversation(env, convId, source, firstText) {
  if (convId) {
    const c = await env.DB.prepare('SELECT id FROM conversations WHERE id=?').bind(convId).first();
    if (c) return convId;
  }
  const id = convId || uid();
  const t = now();
  await env.DB.prepare('INSERT INTO conversations (id,title,source,created_at,updated_at) VALUES (?,?,?,?,?)')
    .bind(id, clip(firstText.replace(/\s+/g, ' '), 60) || 'New chat', source, t, t).run();
  return id;
}

export async function prepareChat(env, { convId, text, source = 'web', via = 'text', spoken = false, noteId = null, task = false }) {
  // Everything that does not depend on the new message loads at the same time, so the first word comes sooner.
  const [settings, id, mem, note, moods, helped, last] = await Promise.all([
    getSettings(env),
    ensureConversation(env, convId, source, text),
    recall(env, text),
    noteId ? getNote(env, noteId).catch(() => null) : null,
    task ? [] : moodContext(env),
    assist(env, text, { source, task, convId }),
    task ? 0 : env.DB.prepare("SELECT MAX(created_at) AS t FROM messages WHERE role='user' AND conv_id<>'routines'").first().then((r) => (r && r.t) || 0).catch(() => 0),
  ]);
  if (helped.notes && helped.notes.notes.length) { const seen = new Set((mem.notes || []).map((n) => n.title)); mem.notes = [...helped.notes.notes.filter((n) => !seen.has(n.title)), ...(mem.notes || [])].slice(0, 4); }
  const ins = await env.DB.prepare('INSERT INTO messages (conv_id,role,content,via,created_at) VALUES (?,?,?,?,?)').bind(id, 'user', text, via, now()).run();
  const userMsgId = ins.meta && ins.meta.last_row_id;
  const hist = await env.DB.prepare('SELECT role,content FROM messages WHERE conv_id=? ORDER BY id DESC LIMIT 20').bind(id).all();
  const history = (hist.results || []).reverse().map((m) => ({ role: m.role, content: clip(m.content, m.role === 'user' && m.content.startsWith('[File: ') ? 17000 : 3000) }));
  const period = periodNow(settings);
  const system = buildSystem({ settings, mem, spoken, source, note, task, moods, period, done: helped.done, web: helped.web, notes: helped.notes, moodKind: task ? null : tinyMoodNow(settings, { lastActive: last }) });
  return { convId: id, userMsgId, settings, messages: [{ role: 'system', content: system }, ...history] };
}

// Saves the reply and learns from it. Safe to run in the background.
export async function finishChat(env, { convId, userMsgId, text, reply, model, source = 'web', settings }) {
  const t = now();
  const ins = await env.DB.prepare('INSERT INTO messages (conv_id,role,content,model,created_at) VALUES (?,?,?,?,?)').bind(convId, 'assistant', reply, model || null, t).run();
  await env.DB.prepare('UPDATE conversations SET updated_at=? WHERE id=?').bind(t, convId).run();
  const botId = ins.meta && ins.meta.last_row_id;
  await Promise.allSettled([
    userMsgId ? indexChat(env, userMsgId, 'user', text, convId) : null,
    botId ? indexChat(env, botId, 'assistant', reply, convId) : null,
    extractAndStore(env, { convId, userText: text, reply, source: source === 'telegram' ? 'telegram' : 'auto', brain: 'fast', review: !!(settings && settings.reviewMemories) }),
  ]);
}

// Non-streaming version used by Telegram.
export async function chatOnce(env, { convId, text, source, via, spoken }) {
  const p = await prepareChat(env, { convId, text, source, via, spoken });
  const r = await complete(env, { brain: p.settings.brain, messages: p.messages, temperature: 0.8, maxTokens: 1600 });
  return { ...p, reply: r.text, model: r.model };
}
