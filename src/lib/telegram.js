// Telegram bot: same brain, same memories as the website. Only OWNER_TG_ID may talk to it.
import { chatOnce, finishChat } from './chat.js';
import { remember } from './memory.js';
import { speechToText, textToSpeech } from './voice.js';
import { getSettings, saveSettings } from './settings.js';
import { getToday } from './today.js';
import { plainForSpeech, clip, safeEqual } from './util.js';
import { saveMood, moodReply } from './moods.js';
import { MOOD_BUTTONS } from './care.js';
import { wantsFile, makeFile } from './files.js';
import { wantsTranslate, translate, payload } from './translate.js';
import { notesFor } from './notes.js';
import { setWater, habitReply } from './habits.js';
import { moodLoggedToday } from './moods.js';
import { listDates, prettyDate } from './dates.js';
import { urlsIn, needsSearch } from './web.js';
import { docText, fileMessage } from './docs.js';

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
export async function sendDocument(env, chat, bytes, name, caption, mime = 'text/html') {
  const fd = new FormData();
  fd.append('chat_id', String(chat));
  if (caption) fd.append('caption', caption.slice(0, 900));
  fd.append('document', new Blob([bytes], { type: mime }), name);
  return fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendDocument`, { method: 'POST', body: fd }).then((r) => r.json()).catch(() => ({}));
}
async function fileToChat(env, chat, kind, text, quoted = '') {
  await send(env, chat, `On it, making your ${kind.toUpperCase()} file...`);
  await api(env, 'sendChatAction', { chat_id: chat, action: 'upload_document' });
  let extra = quoted ? `# The message they replied to\n${quoted}\n\n` : '';
  if (/\bnotes?\b/i.test(text)) { const n = await notesFor(env, text); extra += n.notes.map((x) => `# ${x.title}\n${x.text}`).join('\n\n'); }
  const f = await makeFile(env, kind, text, extra);
  const res = await sendDocument(env, chat, f.bytes, f.name, 'Here you go. Tell me what to change and I will make a new version.', f.mime);
  if (!res.ok) await send(env, chat, 'I made it but Telegram would not take the file. Try again?');
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
  const chat = cq.message && cq.message.chat && cq.message.chat.id;
  const w = /^water:(\d+)$/.exec(cq.data || '');
  if (w) {
    const n = await setWater(env, w[1]);
    if (!chat) return;
    await send(env, chat, await habitReply(env, n));
    if (!(await moodLoggedToday(env))) await sendWithButtons(env, chat, 'And how are you feeling today? Tap a number.', MOOD_BUTTONS);
    return;
  }
  const m = /^mood:([1-5])$/.exec(cq.data || '');
  if (!m) return;
  const mood = await saveMood(env, { score: m[1] });
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
  let fileCtx = '';
  if (msg.document || msg.photo) {
    const d = msg.document || { file_id: msg.photo[msg.photo.length - 1].file_id, file_size: msg.photo[msg.photo.length - 1].file_size, file_name: 'photo.jpg', mime_type: 'image/jpeg' };
    if ((d.file_size || 0) > 18 * 1024 * 1024) { await send(env, chat, 'That file is too big for me (the limit is about 18 MB).'); return; }
    await api(env, 'sendChatAction', { chat_id: chat, action: 'typing' });
    try {
      const f = await downloadVoice(env, d.file_id);
      const r = await docText(env, f.bytes, d.file_name || 'file', d.mime_type || '');
      fileCtx = fileMessage(d.file_name || 'file', r.text, '');
      fileCtx = fileCtx.slice(0, fileCtx.lastIndexOf('[End of file]') + 13);
      if (!text) text = r.kind === 'picture' ? 'Look at this picture. Tell me in a few short lines what it says or shows, and ask what I want to do with it.' : 'Read this file, tell me in a few short lines what it is about, and ask what I want to do with it.';
    } catch (e) { await send(env, chat, e.message || 'I could not read that file.'); return; }
  }
  if (msg.voice || msg.audio) {
    await api(env, 'sendChatAction', { chat_id: chat, action: 'record_voice' });
    try {
      const f = await downloadVoice(env, (msg.voice || msg.audio).file_id);
      text = await speechToText(env, f.bytes, f.mime);
      via = 'voice';
    } catch { await send(env, chat, 'I could not hear that voice note. Try again?'); return; }
    if (!text) { await send(env, chat, 'That voice note was empty.'); return; }
  }
  // If you swipe-reply to one of her (or your own) messages, that message is what you are talking about.
  const rm = msg.reply_to_message;
  const quoted = rm ? clip(String(rm.text || rm.caption || '').trim(), 3500) : '';
  if (!text && !quoted) return;
  if (!text) return;

  const settings = await getSettings(env);
  const kvKey = 'tg:conv';
  const [cmd, ...restParts] = text.split(/\s+/);
  const rest = restParts.join(' ').trim();

  if (/^\/start/i.test(cmd)) { await send(env, chat, `Hi, I'm ${settings.persona.name}. Same memory as your website. Send text or a voice note.\n\n/new  start a fresh chat\n/remember <fact>\n/today  ideas for today\n/html /pdf /csv /md <what>  I make that file and send it here\n/tr <text>  Hindi <-> English with tone\n/search <question>  I look it up (or send me a link)\n/dates  birthdays I remember\n/water  log water\n\nYou can also just say: remind me..., note this..., X's birthday is...\n/voice on|off  voice replies`); return; }
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

  if (/^\/dates\b/i.test(cmd)) {
    const ds = await listDates(env);
    await send(env, chat, ds.length ? ds.map((d) => `${prettyDate(d)}  ${d.title}${d.days === 0 ? '  (today!)' : '  (in ' + d.days + ' days)'}`).join('\n') : 'No dates yet. Tell me: "Riya\'s birthday is 14 March".');
    return;
  }
  if (/^\/water\b/i.test(cmd)) {
    const n = parseInt(rest, 10);
    if (Number.isFinite(n)) { await setWater(env, n); await send(env, chat, await habitReply(env, n)); }
    else await sendWithButtons(env, chat, 'How many glasses of water today?', (await import('./habits.js')).WATER_BUTTONS);
    return;
  }
  if (wantsTranslate(text)) {
    try { await api(env, 'sendChatAction', { chat_id: chat, action: 'typing' }); await send(env, chat, await translate(env, quoted && !payload(text) ? text + ' ' + quoted : text)); } catch (e) { await send(env, chat, e.message || 'Could not translate.'); }
    return;
  }
  const fileKind = wantsFile(text);
  if (fileKind) {
    try { await fileToChat(env, chat, fileKind, text, quoted); } catch (e) { await send(env, chat, e.message || 'Could not make the file.'); }
    return;
  }
  if (/^\/search\b/i.test(cmd) && !rest) { await send(env, chat, 'Tell me what to look up: /search best laptops under 50000'); return; }
  if (urlsIn(text).length || needsSearch(text)) await api(env, 'sendChatAction', { chat_id: chat, action: 'typing' });

  await api(env, 'sendChatAction', { chat_id: chat, action: 'typing' });
  const convId = (await env.KV.get(kvKey)) || null;
  const wantVoice = via === 'voice' || settings.voice.autoplay;
  try {
    const chatText = (fileCtx ? fileCtx + '\n\n' : '') + (quoted ? `(I am replying to this earlier message: "${quoted}")\n\n${text}` : text);
    const r = await chatOnce(env, { convId, text: chatText, source: 'telegram', via, spoken: wantVoice });
    if (!convId) await env.KV.put(kvKey, r.convId);
    if (wantVoice) await send(env, chat, r.reply); else await sendBubbles(env, chat, r.reply, settings.chat.bubbles);
    if (wantVoice) await sendVoice(env, chat, r.reply);
    await finishChat(env, { convId: r.convId, userMsgId: r.userMsgId, text: chatText, reply: r.reply, model: r.model, source: 'telegram', settings: r.settings });
  } catch (e) {
    await send(env, chat, e.message || 'Something went wrong.');
  }
}
