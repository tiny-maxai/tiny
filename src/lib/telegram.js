// Telegram bot: same brain, same memories as the website. Only OWNER_TG_ID may talk to it.
import { chatOnce, finishChat } from './chat.js';
import { remember } from './memory.js';
import { speechToText, textToSpeech } from './voice.js';
import { getSettings, saveSettings } from './settings.js';
import { getToday } from './today.js';
import { plainForSpeech, clip, safeEqual } from './util.js';
import { saveMood, moodReply } from './moods.js';

const api = (env, method, body) =>
  fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json()).catch(() => ({}));

export async function send(env, chat, text) {
  // Telegram messages max out at 4096 characters.
  for (let i = 0; i < text.length; i += 3900) await api(env, 'sendMessage', { chat_id: chat, text: text.slice(i, i + 3900) });
}
export async function sendWithButtons(env, chat, text, rows) {
  return api(env, 'sendMessage', { chat_id: chat, text: text.slice(0, 3900), reply_markup: { inline_keyboard: rows.map((r) => r.map((b) => ({ text: b.text, callback_data: b.data }))) } });
}
async function sendVoice(env, chat, text) {
  try {
    const st = await getSettings(env);
    const v = await textToSpeech(env, clip(plainForSpeech(text), 900), { gender: st.persona.gender, language: st.persona.language, mp3: true });
    const fd = new FormData();
    fd.append('chat_id', String(chat));
    fd.append('audio', new Blob([v.bytes], { type: v.mime }), 'reply.' + v.ext);
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendAudio`, { method: 'POST', body: fd });
  } catch (e) { console.error('[tg voice]', e && e.message); }
}
async function downloadVoice(env, fileId) {
  const f = await api(env, 'getFile', { file_id: fileId });
  const path = f && f.result && f.result.file_path;
  if (!path) throw new Error('no file');
  const r = await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${path}`);
  return { bytes: new Uint8Array(await r.arrayBuffer()), mime: /\.oga|\.ogg/.test(path) ? 'audio/ogg' : /\.mp3/.test(path) ? 'audio/mpeg' : 'audio/ogg' };
}

export async function setWebhook(env, origin) {
  return api(env, 'setWebhook', { url: origin + '/api/tg/hook', secret_token: env.TG_WEBHOOK_SECRET, allowed_updates: ['message', 'callback_query'] });
}
export async function webhookInfo(env) {
  return fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getWebhookInfo`).then((r) => r.json()).catch(() => ({}));
}

export async function handleUpdate(request, env, ctx) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TG_WEBHOOK_SECRET) return new Response('not configured', { status: 503 });
  const secret = request.headers.get('X-Telegram-Bot-Api-Secret-Token') || '';
  if (!(await safeEqual(secret, env.TG_WEBHOOK_SECRET))) return new Response('forbidden', { status: 403 });
  let update; try { update = await request.json(); } catch { return new Response('ok'); }
  if (update && update.callback_query) { ctx.waitUntil(handleButton(env, update.callback_query).catch((e) => console.error('[tg btn]', e && e.message))); return new Response('ok'); }
  const msg = update && update.message;
  if (!msg || !msg.chat) return new Response('ok');
  ctx.waitUntil(processMessage(env, msg).catch((e) => console.error('[tg]', e && e.message)));
  return new Response('ok');
}

async function handleButton(env, cq) {
  await api(env, 'answerCallbackQuery', { callback_query_id: cq.id });
  if (!env.OWNER_TG_ID || String(cq.from && cq.from.id) !== String(env.OWNER_TG_ID)) return;
  const m = /^mood:([1-5])$/.exec(cq.data || '');
  if (!m) return;
  const mood = await saveMood(env, { score: m[1] });
  const chat = cq.message && cq.message.chat && cq.message.chat.id;
  if (chat) await send(env, chat, await moodReply(env, mood));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Sends a reply like texting: each short thought is its own message, with a typing pause between them.
async function sendBubbles(env, chat, text, bubbles) {
  const parts = bubbles && !/```/.test(text) && text.length < 900 ? text.split(/\n{2,}/).map((x) => x.trim()).filter(Boolean).slice(0, 4) : [text];
  for (let i = 0; i < parts.length; i++) {
    if (i > 0) { await api(env, 'sendChatAction', { chat_id: chat, action: 'typing' }); await sleep(Math.min(1800, 500 + parts[i].length * 14)); }
    await send(env, chat, parts[i]);
  }
}

async function processMessage(env, msg) {
  const chat = msg.chat.id;
  const from = msg.from && msg.from.id;
  if (!env.OWNER_TG_ID) {
    await send(env, chat, `Hi! This bot is private. Your Telegram ID is ${from}. Save it as the OWNER_TG_ID secret on the Worker, then message me again.`);
    return;
  }
  if (String(from) !== String(env.OWNER_TG_ID)) { await send(env, chat, 'Sorry, this is a private bot.'); return; }

  let text = (msg.text || msg.caption || '').trim();
  let via = 'text';
  if (msg.voice || msg.audio) {
    await api(env, 'sendChatAction', { chat_id: chat, action: 'record_voice' });
    try {
      const f = await downloadVoice(env, (msg.voice || msg.audio).file_id);
      text = await speechToText(env, f.bytes, f.mime);
      via = 'voice';
    } catch { await send(env, chat, 'I could not hear that voice note. Try again?'); return; }
    if (!text) { await send(env, chat, 'That voice note was empty.'); return; }
  }
  if (!text) return;

  const settings = await getSettings(env);
  const kvKey = 'tg:conv';
  const [cmd, ...restParts] = text.split(/\s+/);
  const rest = restParts.join(' ').trim();

  if (/^\/start/i.test(cmd)) { await send(env, chat, `Hi, I'm ${settings.persona.name}. Same memory as your website. Send text or a voice note.\n\n/new  start a fresh chat\n/remember <fact>\n/today  ideas for today\n/voice on|off  voice replies`); return; }
  if (/^\/new/i.test(cmd)) { await env.KV.delete(kvKey); await send(env, chat, 'Fresh chat started. I still remember everything about you.'); return; }
  if (/^\/remember/i.test(cmd)) {
    if (!rest) { await send(env, chat, 'Tell me what: /remember I love mango lassi'); return; }
    await remember(env, { text: rest, importance: 5, pinned: 1, source: 'telegram' });
    await send(env, chat, 'Saved.'); return;
  }
  if (/^\/today/i.test(cmd)) {
    try {
      const d = await getToday(env);
      await send(env, chat, d.greeting + '\n\n' + d.ideas.map((i, n) => `${n + 1}. ${i.title} (${i.minutes} min)\n   ${i.why}`).join('\n\n'));
    } catch (e) { await send(env, chat, e.message); }
    return;
  }
  if (/^\/voice/i.test(cmd)) {
    const on = /^on$/i.test(rest);
    await saveSettings(env, { voice: { autoplay: on } });
    await send(env, chat, on ? 'Voice replies on.' : 'Voice replies off.'); return;
  }

  await api(env, 'sendChatAction', { chat_id: chat, action: 'typing' });
  const convId = (await env.KV.get(kvKey)) || null;
  const wantVoice = via === 'voice' || settings.voice.autoplay;
  try {
    const r = await chatOnce(env, { convId, text, source: 'telegram', via, spoken: wantVoice });
    if (!convId) await env.KV.put(kvKey, r.convId);
    if (wantVoice) await send(env, chat, r.reply); else await sendBubbles(env, chat, r.reply, settings.chat.bubbles);
    if (wantVoice) await sendVoice(env, chat, r.reply);
    await finishChat(env, { convId: r.convId, userMsgId: r.userMsgId, text, reply: r.reply, model: r.model, source: 'telegram', settings: r.settings });
  } catch (e) {
    await send(env, chat, e.message || 'Something went wrong.');
  }
}
