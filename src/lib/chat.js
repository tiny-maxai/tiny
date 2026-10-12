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
import { beforeReply, afterReply, getHer, queueMessage } from './her.js';
import { getLife, lifeLines } from './life.js';
import { getAmbient, ambientLines } from './ambient.js';

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

export async function prepareChat(env, { convId, text, source = 'web', via = 'text', spoken = false, noteId = null, task = false, gate = null, noInsert = false }) {
  // Everything that does not depend on the new message loads at the same time, so the first word comes sooner.
  const settings = await getSettings(env);
  const [id, mem, note, moods, helped, last, herNow, lifeNow, amb] = await Promise.all([
    ensureConversation(env, convId, source, text),
    recall(env, text),
    noteId ? getNote(env, noteId).catch(() => null) : null,
    task ? [] : moodContext(env),
    assist(env, text, { source, task, convId }),
    task ? 0 : env.DB.prepare("SELECT MAX(created_at) AS t FROM messages WHERE role='user' AND conv_id<>'routines'").first().then((r) => (r && r.t) || 0).catch(() => 0),
    getHer(env),
    getLife(env),
    task ? null : getAmbient(env, settings),
  ]);
  // Her feelings: judged before she answers (anger, good night, ignored messages). Callers that already did it pass `gate`.
  const g = task ? { her: herNow, hint: '' } : (gate || await beforeReply(env, settings, text));
  if (helped.notes && helped.notes.notes.length) { const seen = new Set((mem.notes || []).map((n) => n.title)); mem.notes = [...helped.notes.notes.filter((n) => !seen.has(n.title)), ...(mem.notes || [])].slice(0, 4); }
  let userMsgId = null;
  if (!noInsert) { const ins = await env.DB.prepare('INSERT INTO messages (conv_id,role,content,via,created_at) VALUES (?,?,?,?,?)').bind(id, 'user', text, via, now()).run(); userMsgId = ins.meta && ins.meta.last_row_id; }
  const hist = await env.DB.prepare('SELECT role,content FROM messages WHERE conv_id=? ORDER BY id DESC LIMIT 20').bind(id).all();
  const history = (hist.results || []).reverse().map((m) => ({ role: m.role, content: clip(m.content, m.role === 'user' && m.content.startsWith('[File: ') ? 17000 : 3000) }));
  const period = periodNow(settings);
  const system = buildSystem({ settings, mem, spoken, source, note, task, moods, period, done: helped.done, web: helped.web, notes: helped.notes, moodKind: tinyMoodNow(settings, { lastActive: last, her: g.her || herNow, period, ambient: amb }), hint: g.hint || '', life: lifeLines(lifeNow), ambient: ambientLines(amb) });
  return { convId: id, userMsgId, settings, messages: [{ role: 'system', content: system }, ...history] };
}

// Saves the reply and learns from it. Safe to run in the background.
export async function finishChat(env, { convId, userMsgId, text, reply, model, source = 'web', settings }) {
  const t = now();
  const ins = await env.DB.prepare('INSERT INTO messages (conv_id,role,content,model,created_at) VALUES (?,?,?,?,?)').bind(convId, 'assistant', reply, model || null, t).run();
  await env.DB.prepare('UPDATE conversations SET updated_at=? WHERE id=?').bind(t, convId).run();
  const botId = ins.meta && ins.meta.last_row_id;
  const her = source === 'routine' ? {} : await getHer(env);
  const creator = !!(her.updateUntil && her.updateUntil > t);       // they said "I am going to update you": what they say about her is stored as her memory
  await Promise.allSettled([
    userMsgId ? indexChat(env, userMsgId, 'user', text, convId) : null,
    botId ? indexChat(env, botId, 'assistant', reply, convId) : null,
    source !== 'routine' ? afterReply(env, settings || {}, { text, reply }) : null,
    extractAndStore(env, { convId, userText: text, reply, source: source === 'telegram' ? 'telegram' : 'auto', brain: 'fast', review: !!(settings && settings.reviewMemories) && !creator, name: (settings && settings.persona && settings.persona.name) || 'Tiny', creator }),
  ]);
}

// While she sleeps nothing is sent to the AI: the message is only saved (with her short "sleeping" line when she says one).
export async function sleepTurn(env, { convId, text, source = 'web', via = 'text', reply = '' }) {
  const id = await ensureConversation(env, convId, source, text), t = now();
  await env.DB.prepare('INSERT INTO messages (conv_id,role,content,via,created_at) VALUES (?,?,?,?,?)').bind(id, 'user', text, via, t).run();
  if (reply) await env.DB.prepare('INSERT INTO messages (conv_id,role,content,model,created_at) VALUES (?,?,?,?,?)').bind(id, 'assistant', reply, 'sleeping', t + 1).run();
  await env.DB.prepare('UPDATE conversations SET updated_at=? WHERE id=?').bind(t + 1, id).run();
  await queueMessage(env, { text, source, convId: id, via });          // she answers it in the morning
  return id;
}

// Morning: she answers what you wrote while she slept, starting with "sorry, I was sleeping". The messages are already saved in the chat.
export async function answerQueued(env, items) {
  const first = items[0];
  const her = await getHer(env);
  const gate = { her, hint: 'You were asleep when they wrote the latest message(s) in this chat. Start with a cute "sorry, I was sleeping 😴" in your own words (once), then answer what they wrote, naturally. Do not act as if you read them in real time.', creatorUpdate: false };
  const text = items.map((i) => i.text).join('\n');
  const p = await prepareChat(env, { convId: first.convId, text, source: first.source || 'web', via: 'text', gate, noInsert: true });
  const r = await complete(env, { brain: p.settings.brain, messages: p.messages, temperature: 0.8, maxTokens: 900 });
  await finishChat(env, { convId: p.convId, userMsgId: null, text, reply: r.text, model: r.model, source: first.source || 'web', settings: p.settings });
  return { text: r.text, name: p.settings.persona.name, convId: p.convId, source: first.source || 'web' };
}

// Non-streaming version used by Telegram.
export async function chatOnce(env, { convId, text, source, via, spoken, gate = null, brain = null }) {
  const p = await prepareChat(env, { convId, text, source, via, spoken, gate });
  const r = await complete(env, brain ? { brain, effort: 'medium', messages: p.messages, temperature: 0.4, maxTokens: 3000, timeout: 45000 } : { brain: p.settings.brain, messages: p.messages, temperature: 0.8, maxTokens: 1600 });
  return { ...p, reply: r.text, model: r.model };
}
