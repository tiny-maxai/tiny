import { relHint } from './rel.js';
import { isActive, ACTIVATE_HINT, FEAR_HINT, recapHint, logTurn } from './activate.js';
// The chat pipeline shared by the website and Telegram:
// save the message, recall memories, build the prompt, (stream) the answer, save it, learn new facts.
import { uid, now, clip, plainChat } from './util.js';
import { getSettings } from './settings.js';
import { recall, indexChat, extractAndStore } from './memory.js';
import { buildSystem } from './persona.js';
import { complete } from './ai.js';
import { getNote } from './notes.js';
import { moodContext } from './moods.js';
import { periodNow } from './period.js';
import { assist } from './assist.js';
import { tinyMoodNow } from './tinymood.js';
import { beforeReply, afterReply, getHer, putHer, queueMessage, moodNow, SOOTHABLE } from './her.js';
import { getLife, lifeLines } from './life.js';
import { getAmbient, ambientLines } from './ambient.js';
import { bondOf, prefsHint, humanRule } from './she.js';
import { matchSkill, skillHint, useSkill, splitSkillCmd, aiMatchSkill, aiPicked, learnSkillFacts } from './skills.js';
import { imageTurn, sceneTurn, GARTER_LINE, GIRL_TALK, PRIVATE_HINT, isPrivateTalk } from './extras.js';
import { occasionTurn, stripImg } from './occasion.js';
import { outfitCount } from './outfit.js';
import { dreamHint } from './reflect.js';
import { pastTalk } from './chatsearch.js';

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

const TEXT_STYLE = 'TEXTING STYLE: you are texting like a real girl. Normal replies are short and natural (1 to 4 lines), no tables, no headings, no bold, no bullet lists, and you do not offer to make sheets, notes or reminders on your own. Only use a list, steps or a table when they clearly ask for one, ask a study question that needs steps, or ask for a file.';
export async function prepareChat(env, { convId, text, source = 'web', via = 'text', spoken = false, noteId = null, task = false, gate = null, noInsert = false }) {
  // "/skill-cooking how do I make paneer": the command only picks the skill, the question is what she answers.
  const raw = text, cmd = splitSkillCmd(text);
  if (cmd) text = cmd.rest || `Help me with ${cmd.token.replace(/-/g, ' ')}.`;
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
  const history = (hist.results || []).reverse().map((m) => ({ role: m.role, content: clip(stripImg(m.content), m.role === 'user' && m.content.startsWith('[File: ') ? 17000 : 3000) }));
  const period = periodNow(settings);
  const bond = task ? null : await bondOf(env).catch(() => null);
  let sk = task ? null : matchSkill(herNow, raw);
  if (!sk && !task && !noInsert) sk = await aiMatchSkill(env, herNow, raw).catch(() => null);          // no keyword fits: a tiny AI check may still pick a skill
  const cm = moodNow(herNow, settings, now());
  const occ = task ? { hint: '', image: '', pre: '' } : await occasionTurn(env, text, { source, count: await outfitCount(env).catch(() => 0), mood: cm && cm.k, shocked: !!(herNow.shocks && herNow.shocks.last && now() - herNow.shocks.last < 3 * 3600000) }).catch(() => ({ hint: '', image: '', pre: '' }));
  const im = task ? null : await imageTurn(env, text).catch(() => null);                      // "draw me a cat": she makes a picture
  if (im) { occ.image = im.image; occ.pre = im.pre; occ.hint = [occ.hint, im.hint].filter(Boolean).join(' '); }
  if (!task && !occ.image) { const sc = await sceneTurn(env, text, { settings, mood: cm && cm.k, sk, t: now() }).catch(() => null); if (sc && sc.image) { occ.image = sc.image; occ.hint = [occ.hint, sc.hint].filter(Boolean).join(' '); } }
  const dream = task ? '' : await dreamHint(env).catch(() => '');
  const past = task ? '' : await pastTalk(env, text).catch(() => '');          // "what did I say about that exam?"
  const carry = cm && SOOTHABLE.has(cm.k) && now() - (cm.born || cm.since || now()) > 5 * 3600000 ? `You are STILL ${cm.k}${cm.reason ? ' because ' + cm.reason : ''}, it carried over from before. If this is the first message of a new day, let it show (cold or hurt, not over it yet).` : '';
  const collar = task ? false : await isActive(env, 'chat'), collarSk = task ? false : await isActive(env, 'skills');
  const relH = task ? '' : relHint(herNow, text);
  const extra = [relH, spoken ? 'VOICE LANGUAGE RULE: in voice mode you speak ONLY Hindi (Devanagari or Hinglish) or English, matching the language they used. If they spoke another language it was already translated for you: answer in Hindi or English, and you may briefly say what you understood. Never reply in any other language.' : '', humanRule(settings.persona.gender === 'girl'), prefsHint(herNow), bond ? `YOUR CLOSENESS WITH THEM: level ${bond.level} of ${bond.of} (${bond.name}). ${bond.talk} Never mention the level or its name.` : '', skillHint(sk), settings.persona.gender === 'girl' ? GARTER_LINE : '', settings.persona.gender === 'girl' && !(sk && sk.deep && !sk.pending) ? TEXT_STYLE : '', settings.persona.gender === 'girl' ? GIRL_TALK : '', settings.persona.gender === 'girl' && !task && isPrivateTalk(text) ? PRIVATE_HINT : '', carry, dream, past, occ.hint, collar ? ACTIVATE_HINT : (!task && /\b(collar|activate|garter|robot mode)\b/i.test(text) ? FEAR_HINT : '') ||  (task ? '' : await recapHint(env, text).catch(() => ''))].filter(Boolean).join('\n');
  const system = buildSystem({ settings, mem, spoken, source, note, task, moods, period, done: helped.done, web: helped.web, notes: helped.notes, moodKind: tinyMoodNow(settings, { lastActive: last, her: g.her || herNow, period, ambient: amb }), hint: g.hint || '', life: lifeLines(lifeNow), ambient: ambientLines(amb), extra });
  // skills get the stronger model and more room; a plain tip keeps the normal one
  const deepSkill = !!(sk && sk.deep && !sk.pending && !sk.unknown), brain = (deepSkill || collar || (collarSk && sk && sk.skill)) ? 'smart' : (sk && sk.skill && settings.brain === 'lite' ? 'fast' : settings.brain);
  return { convId: id, userMsgId, settings, brain, maxTokens: (deepSkill || (collarSk && sk && sk.skill)) ? 2400 : (collar ? 1200 : null), image: occ.image, pre: occ.pre, messages: [{ role: 'system', content: system }, ...history] };
}

// Saves the reply and learns from it. Safe to run in the background.
export async function finishChat(env, { convId, userMsgId, text, reply, model, source = 'web', settings }) {
  const t = now();
  const ins = await env.DB.prepare('INSERT INTO messages (conv_id,role,content,model,created_at) VALUES (?,?,?,?,?)').bind(convId, 'assistant', source === 'routine' ? reply : plainChat(reply), model || null, t).run();
  await env.DB.prepare('UPDATE conversations SET updated_at=? WHERE id=?').bind(t, convId).run();
  const botId = ins.meta && ins.meta.last_row_id;
  const her = source === 'routine' ? {} : await getHer(env);
  let skUsed = null;
  { const sk = source === 'routine' ? null : (matchSkill(her, text) || await aiPicked(env, her, text)); if (sk && useSkill(her, sk)) { await putHer(env, her); skUsed = sk; } }
  const creator = !!(her.updateUntil && her.updateUntil > t);       // they said "I am going to update you": what they say about her is stored as her memory
  await Promise.allSettled([
    userMsgId ? indexChat(env, userMsgId, 'user', text, convId) : null,
    botId ? indexChat(env, botId, 'assistant', reply, convId) : null,
    source !== 'routine' ? afterReply(env, settings || {}, { text, reply }) : null,
    extractAndStore(env, { convId, userText: text, reply, source: source === 'telegram' ? 'telegram' : 'auto', brain: 'fast', review: !!(settings && settings.reviewMemories) && !creator, name: (settings && settings.persona && settings.persona.name) || 'Tiny', creator }),
  ]);
  if (source !== 'routine') await logTurn(env, text, reply);                 // collar mode: kept so she can read it back later
  if (skUsed) await learnSkillFacts(env, her, skUsed, text);                // lasting things they told her for this skill
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
  const gate = { her, hint: 'You were asleep when they wrote the latest message(s) in this chat. Start with a cute "sorry, I was sleeping 😴" in your own words (once), then answer what they wrote, naturally. Do not act as if you read them in real time. Answer in 1 to 4 short text-message lines like a girl who just woke up: no tables, no lists, no bold, no headings, and do not offer sheets, notes or reminders unless they asked for one. Reply ONLY to what they actually wrote: do not start a new topic, do not bring up recipes, plans or things from memory that they did not mention in those messages.', creatorUpdate: false };
  const text = items.map((i) => i.text).join('\n');
  const p = await prepareChat(env, { convId: first.convId, text, source: first.source || 'web', via: 'text', gate, noInsert: true });
  const r = await complete(env, { brain: p.settings.brain, messages: p.messages, temperature: 0.8, maxTokens: 320 });
  r.text = plainChat(r.text);
  await finishChat(env, { convId: p.convId, userMsgId: null, text, reply: r.text, model: r.model, source: first.source || 'web', settings: p.settings });
  return { text: r.text, name: p.settings.persona.name, convId: p.convId, source: first.source || 'web' };
}

// Non-streaming version used by Telegram.
export async function chatOnce(env, { convId, text, source, via, spoken, gate = null, brain = null }) {
  const p = await prepareChat(env, { convId, text, source, via, spoken, gate });
  const r = await complete(env, brain ? { brain, effort: 'medium', messages: p.messages, temperature: 0.4, maxTokens: 3000, timeout: 45000 } : { brain: p.brain || p.settings.brain, messages: p.messages, temperature: 0.8, maxTokens: p.maxTokens || 1600 });
  return { ...p, reply: r.text, model: r.model };
}
