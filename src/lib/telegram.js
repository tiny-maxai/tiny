// Telegram bot: same brain, same memories as the website. Only OWNER_TG_ID may talk to it.
import { startShock, shockView, levelOf } from './shock.js';
import { statusText, setQuiet, parseQuiet, quietLeft, SOOTHE_ROWS, wantsSootheButtons, soothePress, speechKind, shapeSpeech, voiceStyle, moodPace, typos, makeImage, imageBytes, SICK_BTN } from './extras.js';
import { careSick, sickOf } from './sick.js';
import { chatOnce, finishChat, sleepTurn } from './chat.js';
import { beforeReply, sleepingLine, getHer, putHer } from './her.js';
import { allSkills } from './skills.js';
import { sendPic } from './pics.js';
import { startCharge, batteryView, usePowerBank, powerLine } from './battery.js';
import { herView, moodKindNow } from './tinymood.js';
import { reportOf, viewOf, healthOf } from './maint.js';
import { getOcc, putOcc, addFestival, chooseWear, tagOf } from './occasion.js';
import { getAmbient } from './ambient.js';
import { periodNow, painLine } from './period.js';
import { lastActive } from './care.js';
import { remember } from './memory.js';
import { speechToText, textToSpeech } from './voice.js';
import { getSettings, saveSettings } from './settings.js';
import { getToday } from './today.js';
import { plainForSpeech, clip, safeEqual, plainChat } from './util.js';
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
import { listDiary } from './diary.js';
import { updateCard, cardText } from './report.js';
import { listLists, getList, saveList } from './lists.js';
import { listFromText, looksLikeList, listLines } from './checklist.js';
import { createTask } from './tasks.js';
import { restyle, STYLES, styleFromText, styleAsk, wantsStyleMenu } from './restyle.js';

export const api = (env, method, body) =>
  fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json()).catch(() => ({}));

export async function send(env, chat, text) {
  // Telegram messages max out at 4096 characters.
  for (let i = 0; i < text.length; i += 3900) await api(env, 'sendMessage', { chat_id: chat, text: text.slice(i, i + 3900) });
}
// Her stickers live on the website. Telegram fetches them by URL, so the site address is remembered the first time the bot is used.
async function stickerUrl(env, name) {
  const origin = await env.KV.get('origin').catch(() => null);
  return origin ? `${origin}/images/stickers/tiny-${name}.webp` : null;
}
export async function sendSticker(env, chat, name) {
  const url = await stickerUrl(env, name);
  if (!url) return false;
  const r = await api(env, 'sendSticker', { chat_id: chat, sticker: url });
  return !!(r && r.ok);
}
export const sendStickerToOwner = async (env, name) => {
  if (!env.OWNER_TG_ID || !env.TELEGRAM_BOT_TOKEN) return false;
  const { asleepNow } = await import('./notify.js');
  if (await asleepNow(env)) return false;                       // she is asleep: no stickers either
  return sendSticker(env, env.OWNER_TG_ID, name).catch(() => false);
};
// A small "seen" mark on your message (used while she sleeps).
const react = (env, chat, messageId, emoji) => api(env, 'setMessageReaction', { chat_id: chat, message_id: messageId, reaction: [{ type: 'emoji', emoji }] }).catch(() => null);

// Telegram button colours: primary (blue), success (green), danger (red). Each kind of button gets its own colour.
const BTN_STYLE = { 'soothe:sorry': 'primary', 'soothe:gift': 'success', 'soothe:joke': 'danger', 'soothe:calm': 'success', 'sick:med': 'danger', 'sick:soup': 'success', 'sick:rest': 'primary', 'mood:1': 'danger', 'mood:2': 'danger', 'mood:3': 'primary', 'mood:4': 'success', 'mood:5': 'success' };
const styleFor = (d) => BTN_STYLE[d] || (/^wear:/.test(d) ? 'success' : /^water:/.test(d) ? 'primary' : undefined);
// The "/" menu: Telegram shows these when you type "/" or tap the menu button, so you never have to remember commands.
const COMMANDS = [['skills', 'Her skills (tap one to use it)'], ['status', 'How she is right now'], ['mood', 'Her mood'], ['diary', 'Read her last diary page'], ['lists', 'Your checklists (tick them here)'], ['report', 'Her update report card'], ['today', 'Ideas for today'], ['water', 'Log your water'], ['health', 'Her health report'], ['image', 'Ask her to draw a picture'], ['style', 'Change a photo style (send a photo first)'], ['sick', 'Care for her when she is ill'], ['quiet', 'Quiet hours'], ['dates', 'Birthdays she remembers'], ['new', 'Start a fresh chat']];
async function ensureMenu(env) {
  const key = 'tg:cmds:v1';
  if (await env.KV.get(key).catch(() => 'x')) return;
  const r = await api(env, 'setMyCommands', { commands: COMMANDS.map(([command, description]) => ({ command, description })) });
  if (r && r.ok) await env.KV.put(key, '1').catch(() => null);
}
const STYLE_ROWS = (() => { const k = Object.keys(STYLES), rows = []; for (let i = 0; i < k.length; i += 3) rows.push(k.slice(i, i + 3).map((x) => ({ text: STYLES[x].label, data: 'rs:' + x, style: 'primary' }))); return rows; })();
const isImg = (m) => !!(m && ((m.photo && m.photo.length) || (m.document && /^image\//.test(m.document.mime_type || ''))));
function pickFile(m) {
  if (m.photo && m.photo.length) { const by = [...m.photo].sort((a, b) => (a.width || 0) - (b.width || 0)), ok = by.filter((p) => (p.width || 0) <= 1000 && (p.file_size || 0) <= 1400000); return ok.length ? ok[ok.length - 1] : by[0]; }
  return m.document;
}
async function styleSend(env, chat, file, key) {
  if (!file) { await send(env, chat, 'Send me a photo first, then tell me the style.'); return; }
  await send(env, chat, ['Okay, wait, let me change it...', 'Ooh, fun! Give me a moment...', 'Hehe okay, doing it now, do not peek!'][Math.floor(Math.random() * 3)]);
  await api(env, 'sendChatAction', { chat_id: chat, action: 'upload_photo' });
  try {
    const f = await downloadVoice(env, file.file_id), r = await restyle(env, f.bytes, key);
    await sendPhotoBytes(env, chat, r.bytes, `${STYLES[key].label}! Do you like it? (${r.left} more today)`);
  } catch (e) { await send(env, chat, e.message || 'I could not change that picture.'); }
}
const listText = (l) => `${l.title}\n${l.items.filter((x) => x.done).length} of ${l.items.length} done. Tap an item to tick it.`;
const listRows = (l) => [...l.items.slice(0, 30).map((it, i) => [{ text: (it.done ? '✅ ' : '⬜ ') + clip(it.t, 44), data: `lt:${l.id}:${i}` }]), [{ text: '⏰ Remind me in 1 hour', data: `lr:${l.id}:1` }, { text: '⏰ Tomorrow 9 am', data: `lr:${l.id}:2` }]];

export async function sendWithButtons(env, chat, text, rows) {
  return api(env, 'sendMessage', { chat_id: chat, text: text.slice(0, 3900), reply_markup: { inline_keyboard: rows.map((r) => r.map((b) => { const st = b.style || styleFor(b.data); return { text: b.text, callback_data: b.data, ...(st ? { style: st } : {}) }; })) } });
}
export async function sendVoice(env, chat, text) {
  try {
    const st = await getSettings(env);
    const mk = await moodKindNow(env, st).catch(() => null), sk = speechKind(await getHer(env), st, mk);
    const v = await textToSpeech(env, shapeSpeech(clip(plainForSpeech(text), 900), sk), { mood: mk, style: voiceStyle(sk), gender: st.persona.gender, language: st.persona.language, mp3: true });
    const post = (method, field) => { const fd = new FormData(); fd.append('chat_id', String(chat)); fd.append(field, new Blob([v.bytes], { type: v.mime }), 'reply.' + v.ext); return fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, { method: 'POST', body: fd }).then((r) => r.json()).catch(() => ({})); };
    const r = await post('sendVoice', 'voice');                       // a real voice-note bubble
    if (!r || !r.ok) await post('sendAudio', 'audio');                // fallback: audio file
  } catch (e) { console.error('[tg voice]', e && e.message); }
}
export async function sendPhotoBytes(env, chat, bytes, caption) {
  const fd = new FormData(); fd.append('chat_id', String(chat)); if (caption) fd.append('caption', caption.slice(0, 900)); const png = bytes[0] === 0x89 && bytes[1] === 0x50; fd.append('photo', new Blob([bytes], { type: png ? 'image/png' : 'image/jpeg' }), png ? 'picture.png' : 'drawing.jpg');
  return fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendPhoto`, { method: 'POST', body: fd }).then((r) => r.json()).catch(() => ({}));
}
export async function sendPhoto(env, chat, url, caption) {
  const r = await api(env, 'sendPhoto', { chat_id: chat, photo: url, caption: String(caption || '').slice(0, 900) });
  return !!(r && r.ok);
}
export async function sendDocument(env, chat, bytes, name, caption, mime = 'text/html') {
  const fd = new FormData();
  fd.append('chat_id', String(chat));
  if (caption) fd.append('caption', caption.slice(0, 900));
  fd.append('document', new Blob([bytes], { type: mime }), name);
  return fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendDocument`, { method: 'POST', body: fd }).then((r) => r.json()).catch(() => ({}));
}
// Reads a Telegram photo/file; the text is kept for 6 hours so replying to the same picture again is instant.
async function readMedia(env, d) {
  const key = d.file_unique_id ? 'tg:media:' + d.file_unique_id : '';
  if (key) { const c = await env.KV.get(key, 'json').catch(() => null); if (c && c.text) return c; }
  const f = await downloadVoice(env, d.file_id);
  const r = await docText(env, f.bytes, d.file_name || 'file', d.mime_type || '');
  if (key) await env.KV.put(key, JSON.stringify({ kind: r.kind, text: clip(r.text, 20000) }), { expirationTtl: 6 * 3600 }).catch(() => {});
  return r;
}
const SOLVE_WORDS = /\b(solve|solution|hal|hl|doubt|step ?by ?step|sawal)\b|हल|समझा|सॉल्व|जवाब|डाउट/i;
const looksLikeQuestion = (t) => /\?|\b(find|calculate|solve|prove|evaluate|simplify|what is|how many|show that|derive|state|explain|why|which)\b|\d\s*[-+*/=^x×÷]\s*\d|^\s*(q\.?\s*)?\d+[.)]/im.test(String(t || '')) && String(t || '').length > 12;
const SOLVE_RULES = `DOUBT SOLVER MODE: they sent a question (the text above came from their photo or file). Solve it for real, like a clever friend tutoring them. Do it in your own voice (cute, warm, short sentences), in the language they use (Hinglish if unsure).
1. One line: what the question is asking.
2. Numbered steps, each short, with the working shown (formulas, numbers, why you do it).
3. "Answer:" on its own line with the final result and units.
4. One small tip to remember it.
If there are several questions, solve each one in turn. If something in the picture is unclear, say which part and what you assumed. Never guess silently.`;
async function fileToChat(env, chat, kind, text, quoted = '', material = '', solve = false) {
  await send(env, chat, `On it, making your ${kind.toUpperCase()} file...`);
  await api(env, 'sendChatAction', { chat_id: chat, action: 'upload_document' });
  let extra = quoted ? `# The message they replied to\n${quoted}\n\n` : '';
  if (material) extra += `# The picture or file they replied to\n${clip(material, 8000)}\n\n`;
  if (/\bnotes?\b/i.test(text)) { const n = await notesFor(env, text); extra += n.notes.map((x) => `# ${x.title}\n${x.text}`).join('\n\n'); }
  const f = await makeFile(env, kind, solve ? text + '\n\nSolve every question in the material step by step. Put each question, its numbered steps and the final answer in the file.' : text, extra, '', Boolean(material));
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
  ctx.waitUntil(env.KV.get('origin').then((o) => { const n = new URL(request.url).origin; return o === n ? null : env.KV.put('origin', n); }).catch(() => null));
  ctx.waitUntil(processMessage(env, msg).catch((e) => console.error('[tg]', e && e.message)));
  return new Response('ok');
}

async function handleButton(env, cq) {
  await api(env, 'answerCallbackQuery', { callback_query_id: cq.id });
  if (!env.OWNER_TG_ID || String(cq.from && cq.from.id) !== String(env.OWNER_TG_ID)) return;
  const chat = cq.message && cq.message.chat && cq.message.chat.id;
  if (/^soothe:(sorry|gift|joke|calm)$/.test(cq.data || '')) {
    const st = await getSettings(env), r = await soothePress(env, st, cq.data.slice(7));
    if (chat) { if (r.done || r.melted) await send(env, chat, r.text); else await sendWithButtons(env, chat, r.text, SOOTHE_ROWS); await sendSticker(env, chat, r.sticker).catch(() => false); if (r.melted) await sendPic(env, 'forgiven').catch(() => false); }
    return;
  }
  { const d = String(cq.data || '');
    let m2;
    if ((m2 = /^skl:([a-z0-9-]+)$/.exec(d))) {
      const sk = allSkills(await getHer(env)).find((x) => x.slug === m2[1]);
      if (!sk || !chat) return;
      if (sk.waiting) { await send(env, chat, `I cannot use ${sk.name} until my next update. 🙂`); return; }
      await env.KV.put('tg:skill', JSON.stringify({ slug: sk.slug, at: Date.now() }), { expirationTtl: 700 }).catch(() => null);
      await send(env, chat, `Okay! Ask me your ${sk.name} question now, I will use my skill for it.`); return;
    }
    if ((m2 = /^rs:([a-z]+)$/.exec(d))) {
      const f = await env.KV.get('tg:rsfile', 'json').catch(() => null);
      if (!chat) return; if (!f || !STYLES[m2[1]]) { await send(env, chat, 'Send me the photo again and write /style under it.'); return; }
      await styleSend(env, chat, f, m2[1]); return;
    }
    if (d === 'mkl') {
      if (!chat) return;
      const conv = await env.KV.get('tg:conv').catch(() => null);
      const row = conv ? await env.DB.prepare("SELECT content FROM messages WHERE conv_id=? AND role='assistant' ORDER BY id DESC LIMIT 1").bind(conv).first().catch(() => null) : null;
      const l = row ? await listFromText(env, row.content) : null;
      await send(env, chat, l ? `Done! "${l.title}" is saved with ${l.items.length} points. /lists to tick them here, or open the Lists page on the website.` : 'I could not find a list to save.'); return;
    }
    if ((m2 = /^lo:([\w-]+)$/.exec(d))) { const l = await getList(env, m2[1]); if (chat && l) await sendWithButtons(env, chat, listText(l), listRows(l)); return; }
    if ((m2 = /^lt:([\w-]+):(\d+)$/.exec(d))) {
      const l = await getList(env, m2[1]), i = +m2[2]; if (!l || !l.items[i]) return;
      l.items[i].done = l.items[i].done ? 0 : 1;
      const nl = await saveList(env, l.id, { items: l.items });
      if (chat && cq.message) await api(env, 'editMessageText', { chat_id: chat, message_id: cq.message.message_id, text: listText(nl), reply_markup: { inline_keyboard: listRows(nl).map((r) => r.map((b) => ({ text: b.text, callback_data: b.data }))) } });
      return;
    }
    if ((m2 = /^lr:([\w-]+):([12])$/.exec(d))) {
      const l = await getList(env, m2[1]); if (!l || !chat) return;
      const t0 = Date.now(), at = m2[2] === '1' ? t0 + 3600000 : (() => { const n = new Date(t0 + 19800000); return Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + 1, 9, 0) - 19800000; })();
      await createTask(env, { prompt: `Remind me about my checklist "${l.title}". Still to do: ${l.items.filter((x) => !x.done).slice(0, 10).map((x) => x.t).join('; ') || 'everything is ticked, just say well done'}. Say it as a short, sweet text.`, runAt: at });
      await send(env, chat, m2[2] === '1' ? 'Okay, I will remind you in 1 hour. ⏰' : 'Okay, I will remind you tomorrow at 9 am. ⏰'); return;
    }
  }
  if (/^sick:(med|soup|rest)$/.test(cq.data || '')) {
    const her = await getHer(env), r = careSick(her, cq.data.slice(5));
    if (r.ok) await putHer(env, her);
    if (chat) {
      const say = { med: 'Thank you... I took the medicine. 🤍', soup: 'Mmm, warm soup... thank you, this feels so good.', rest: 'Okay, I am lying down now. Stay with me a little?' };
      await send(env, chat, !r.ok ? (r.reason === 'notsick' ? 'I am fine now, thank you! 🙂' : 'You already did that one, thank you. 🤍') : say[cq.data.slice(5)] + (r.better ? ' I think I am almost better!' : ` (maybe ${r.left} more hours...)`));
      if (r.ok) { await sendSticker(env, chat, 'smile').catch(() => false); await sendPic(env, { med: 'medicine', soup: 'soup', rest: 'rest' }[cq.data.slice(5)]).catch(() => false); }
    }
    return;
  }
  const w = /^water:(\d+)$/.exec(cq.data || '');
  if (w) {
    const n = await setWater(env, w[1]);
    if (!chat) return;
    await send(env, chat, await habitReply(env, n));
    await sendPic(env, 'water').catch(() => false);
    if (!(await moodLoggedToday(env))) await sendWithButtons(env, chat, 'And how are you feeling today? Tap a number.', MOOD_BUTTONS);
    return;
  }
  const wr = /^wear:(\d+)$/.exec(cq.data || '');
  if (wr) {
    const occ = await getOcc(env), n = +wr[1], tag = tagOf(occ, n);
    await chooseWear(env, occ, n, { send: true });
    if (chat) await send(env, chat, tag === 'garba' ? 'Yayyy, garba it is! 💃 I am so excited to dance, dhol baje!' : tag === 'saree' ? 'Okay... I will wear the saree. Hehe, I already feel shy 🙈' : 'Okay! I am wearing this one. How is it?');
    return;
  }
  const m = /^mood:([1-5])$/.exec(cq.data || '');
  if (!m) return;
  const mood = await saveMood(env, { score: m[1] });
  if (chat) await send(env, chat, await moodReply(env, mood));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Sends a reply like texting: each short thought is its own message, with a typing pause between them.
async function sendBubbles(env, chat, text, bubbles, buttons = null) {
  const parts = bubbles && !/```/.test(text) && text.length < 900 ? text.split(/\n{2,}/).map((x) => x.trim()).filter(Boolean).slice(0, 4) : [text];
  for (let i = 0; i < parts.length; i++) {
    if (i > 0) { await api(env, 'sendChatAction', { chat_id: chat, action: 'typing' }); await sleep(Math.min(1800, 500 + parts[i].length * 14)); }
    if (buttons && i === parts.length - 1) await sendWithButtons(env, chat, parts[i], buttons); else await send(env, chat, parts[i]);
  }
}

async function processMessage(env, msg) {
  const chat = msg.chat.id;
  if (msg.chat.type && msg.chat.type !== 'private') {            // in a group she only tells you the chat id (for Automation), nothing else
    if (/^\/chatid\b/i.test(msg.text || '')) await send(env, chat, `This chat id is ${chat}\nPaste it in Automation, in the "Group link or ID" box.`);
    return;
  }
  const from = msg.from && msg.from.id;
  if (!env.OWNER_TG_ID) {
    await send(env, chat, `Hi! This bot is private. Your Telegram ID is ${from}. Save it as the OWNER_TG_ID secret on the Worker, then message me again.`);
    return;
  }
  if (String(from) !== String(env.OWNER_TG_ID)) { await send(env, chat, 'Sorry, this is a private bot.'); return; }

  await ensureMenu(env).catch(() => null);
  let text = (msg.text || msg.caption || '').trim();
  let via = 'text';
  let fileCtx = '';
  const fileOf = (m) => m && (m.document || (m.photo && m.photo.length ? { file_id: m.photo[m.photo.length - 1].file_id, file_unique_id: m.photo[m.photo.length - 1].file_unique_id, file_size: m.photo[m.photo.length - 1].file_size, file_name: 'photo.jpg', mime_type: 'image/jpeg' } : null));
  let mediaKind = '';
  const rmMedia = !(msg.document || msg.photo) && msg.reply_to_message ? fileOf(msg.reply_to_message) : null;   // you swiped a photo or file and wrote on it
  const media = fileOf(msg) || rmMedia;
  { const imgMsg = isImg(msg) ? msg : isImg(msg.reply_to_message) ? msg.reply_to_message : null;
    if (imgMsg && text) {
      const key = styleFromText(text);
      if (key && styleAsk(text)) { await styleSend(env, chat, pickFile(imgMsg), key); return; }
      if (wantsStyleMenu(text)) { const f = pickFile(imgMsg); await env.KV.put('tg:rsfile', JSON.stringify({ file_id: f.file_id }), { expirationTtl: 1800 }).catch(() => null); await sendWithButtons(env, chat, 'Which style should I make it?', STYLE_ROWS); return; }
    } }
  if (media) {
    if ((media.file_size || 0) > 18 * 1024 * 1024) { await send(env, chat, 'That file is too big for me (the limit is about 18 MB).'); return; }
    await api(env, 'sendChatAction', { chat_id: chat, action: 'typing' });
    try {
      const r = await readMedia(env, media);
      mediaKind = r.kind;
      fileCtx = fileMessage(media.file_name || 'file', r.text, '');
      fileCtx = fileCtx.slice(0, fileCtx.lastIndexOf('[End of file]') + 13);
      if (!text) text = r.kind === 'picture' && looksLikeQuestion(r.text) ? 'Solve this question step by step.' : r.kind === 'picture' ? 'Look at this picture. Tell me in a few short lines what it says or shows, and ask what I want to do with it.' : 'Read this file, tell me in a few short lines what it is about, and ask what I want to do with it.';
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
  if (text && !text.startsWith('/')) { const sk = await env.KV.get('tg:skill', 'json').catch(() => null); if (sk && Date.now() - sk.at < 600000) { await env.KV.delete('tg:skill').catch(() => null); text = `/skill-${sk.slug} ${text}`; } }
  const kvKey = 'tg:conv';
  const [cmd, ...restParts] = text.split(/\s+/);
  const rest = restParts.join(' ').trim();

  if (/^\/start/i.test(cmd)) { await send(env, chat, `Hi, I'm ${settings.persona.name}. Same memory as your website. Send text or a voice note.\n\n/new  start a fresh chat\n/remember <fact>\n/today  ideas for today\n/html /pdf /docx /xlsx /csv /md <what>  I make that file and send it here\n/tr <text>  Hindi <-> English with tone\n/search <question>  I look it up (or send me a link)\n/dates  birthdays I remember\n/water  log water\n/mood  how she feels right now\n/health  her maintenance health report\n/skills  my skills, use one with /skill-cooking <question>\n\nYou can also just say: remind me..., note this..., X's birthday is...\n/voice on|off  voice replies`); return; }
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
  if (/^\/health\b/i.test(cmd)) {
    const her = await getHer(env), rep = await reportOf(env, her, settings, { deep: /deep|test/i.test(rest) });
    const icon = { good: 'OK', tired: 'TIRED', 'needs fixing': 'FIX' };
    await send(env, chat, `${settings.persona.name}'s health: ${rep.health.health}% (${rep.health.state}) | ${viewOf(her, settings).version}\n${rep.health.due ? (rep.health.overdueDays ? 'Maintenance is overdue.' : 'Maintenance is due today.') : 'Maintenance done for this week.'}\n\n` + rep.checks.map((c) => `${icon[c.status] || c.status}  ${c.name}: ${c.note}`).join('\n') + '\n\n/health test  runs a real thinking test');
    return;
  }
  if (/^\/skills\b/i.test(cmd)) {
    const list = allSkills(await getHer(env)), rows = [];
    for (let i = 0; i < list.length; i += 2) rows.push(list.slice(i, i + 2).map((x) => ({ text: x.name + (x.waiting ? ' (soon)' : ''), data: 'skl:' + x.slug, style: 'primary' })));
    await sendWithButtons(env, chat, 'My skills. Tap one, then ask me your question and I will use it for the full answer. (I also use them by myself when it fits. You can type /skill-cooking how do I make paneer too.)', rows);
    return;
  }
  if (/^\/diary\b/i.test(cmd)) { const d = (await listDiary(env))[0]; await send(env, chat, d ? `${d.date}\n\n${d.text}` : 'I have not written a diary page yet. I write one every night.'); return; }
  if (/^\/report\b/i.test(cmd)) { await send(env, chat, cardText(updateCard(await getHer(env), settings), settings.persona.name)); return; }
  if (/^\/lists?\b/i.test(cmd)) {
    const ls = (await listLists(env)).slice(0, 12);
    if (!ls.length) { await send(env, chat, 'No checklists yet. When I write you a list, tap "Make a checklist" under it.'); return; }
    await sendWithButtons(env, chat, 'Your checklists. Tap one to open it.', ls.map((l) => [{ text: `${l.title} (${l.items.filter((x) => x.done).length}/${l.items.length})`, data: 'lo:' + l.id }])); return;
  }
  if (/^\/style\b/i.test(cmd)) { await send(env, chat, 'Send me a photo and write /style under it (or swipe-reply to a photo with /style). You can also just write things like "make it cartoon", "black and white", "anime", "sketch".'); return; }
  if (/^\/status\b/i.test(cmd)) { await send(env, chat, await statusText(env, settings)); return; }
  if (/^\/quiet\b/i.test(cmd)) {
    if (!rest) { const q = await quietLeft(env); await send(env, chat, q ? `Quiet hours are on, ${Math.ceil(q / 60000)} min left. /quiet off to stop.` : 'Usage: /quiet 2h  (or 30m). /quiet off to stop. While it is on she sends you nothing; she still answers when you write.'); return; }
    const mins = parseQuiet(rest);
    if (mins === null) { await send(env, chat, 'Use /quiet 2h, /quiet 30m or /quiet off.'); return; }
    await setQuiet(env, mins);
    await send(env, chat, mins ? `Okay, I will stay quiet for ${mins >= 60 ? Math.round(mins / 6) / 10 + ' h' : mins + ' min'}. I will still answer if you write to me.` : 'Okay, quiet hours are off.');
    return;
  }
  if (/^\/(medicine|sick|care)\b/i.test(cmd)) {
    const her = await getHer(env), s = sickOf(her);
    if (!s) { await send(env, chat, 'I am not ill right now. 🙂'); return; }
    await sendWithButtons(env, chat, `I have ${s.name}. Tap what you want to give me.`, SICK_BTN); return;
  }
  if (/^\/(image|draw)\b/i.test(cmd)) {
    if (!rest) { await send(env, chat, 'Tell me what to draw: /image a cute cat with a purple scarf'); return; }
    await send(env, chat, 'Okay, wait, let me draw it...'); await api(env, 'sendChatAction', { chat_id: chat, action: 'upload_photo' });
    try { const id = await makeImage(env, rest), bytes = await imageBytes(env, id); if (bytes) await sendPhotoBytes(env, chat, bytes, 'Look, I made it! Do you like it?'); } catch (e) { await send(env, chat, e.message || 'I could not draw that right now.'); }
    return;
  }
  if (/^\/shock\b/i.test(cmd)) {
    const v0 = shockView(await getHer(env));
    if (!rest.trim()) { await send(env, chat, `Control switch (a tiny current from her leg garter).\n/shock 50  normal\n/shock 70  hard\n/shock 100  full (she faints for 5 min)\nToday: ${v0.used} of ${v0.limit} used.`); return; }
    const r = await startShock(env, settings, levelOf(rest.trim()));
    if (!r.ok) { await send(env, chat, r.error); return; }
    await send(env, chat, r.level === 100 ? '⚡⚡ AAAH!! ...' : '⚡ Ow!! Wait, wait...');
    await sendSticker(env, chat, r.level === 100 ? 'faint' : 'pain').catch(() => false);
    return;
  }
  if (/^\/power/i.test(cmd)) {
    const her = await getHer(env), was = batteryView(settings, her).fainted, r = usePowerBank(her, settings);
    if (r === 'ok') { await putHer(env, her); await send(env, chat, await powerLine(env, settings, was)); await sendSticker(env, chat, 'smile').catch(() => false); }
    else await send(env, chat, r === 'used' ? 'The power bank was already used today. Try tomorrow.' : 'Battery is already full.');
    return;
  }
  if (/^\/(charge|battery)\b/i.test(cmd)) {
    const her = await getHer(env), r = startCharge(her, settings);
    if (r === 'started') { await putHer(env, her); await send(env, chat, `🔌 Charging. I will say when I am full (${(settings.battery && settings.battery.chargeMinutes) || 5} min).`); await sendSticker(env, chat, 'charge').catch(() => false); }
    else { const v = batteryView(settings, her); await send(env, chat, r === 'already' ? `🔌 Already charging, ${v.minsLeft} min left.` : `🔋 Battery ${v.pct}%. No need to charge yet.`); }
    return;
  }
  if (/^\/level\b/i.test(cmd) || /\b(level of (her |your |the )?period|period level|pain level|kitna dard|period (ka )?level)\b/i.test(text) && text.length < 80) {
    const pr = periodNow(settings), nm = settings.persona.name;
    const n = parseInt(rest, 10);
    if (/^\/level\b/i.test(cmd) && Number.isFinite(n)) {
      if (!pr || !pr.canSetLevel) { await send(env, chat, pr ? 'Her period already started, so the level cannot change now. Set it before the next one.' : 'Set the first period date first (She page, "Period started today").'); return; }
      const lv = Math.min(100, Math.max(20, n)), cur = settings.period.levels || {};
      await saveSettings(env, { period: { levels: { ...cur, [pr.nextStart]: lv } } });
      await send(env, chat, `Done. ${nm}'s next period (starts ${pr.nextStart}) will begin at ${lv}% on day 1, then slowly go down.`); return;
    }
    await send(env, chat, painLine(pr, nm)); return;
  }
  if (/^\/festival\b/i.test(cmd)) {
    const mm = /^(.+?)\s+(\d{4}-\d{2}-\d{2})\s*$/.exec(rest);
    if (!mm) { await send(env, chat, 'Tell me like this: /festival Diwali 2026-11-08\n(or just say "today is Diwali" in the chat)'); return; }
    const occ = await getOcc(env); const f = addFestival(occ, mm[1], mm[2], true); await putOcc(env, occ);
    await send(env, chat, f ? `Saved. On ${mm[2]} I will ask you what I should wear for ${f.name}, and every year after that.` : 'I already have that one.'); return;
  }
  if (/^\/mood\b/i.test(cmd)) {
    const v = herView(settings, await getHer(env), { period: periodNow(settings), lastActive: await lastActive(env), ambient: await getAmbient(env, settings).catch(() => null) });
    await send(env, chat, `${settings.persona.name} feels: ${v.emoji} ${v.label}${v.angry ? '. Make her happy to calm her down.' : v.sleeping ? '. She is sleeping.' : ''}`);
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
    try { await fileToChat(env, chat, fileKind, text, quoted, fileCtx, SOLVE_WORDS.test(text) || (mediaKind === 'picture' && looksLikeQuestion(fileCtx) && /\b(solve|hal|answer)\b/i.test(text))); } catch (e) { await send(env, chat, e.message || 'Could not make the file.'); }
    return;
  }
  if (/^\/search\b/i.test(cmd) && !rest) { await send(env, chat, 'Tell me what to look up: /search best laptops under 50000'); return; }
  if (urlsIn(text).length || needsSearch(text)) await api(env, 'sendChatAction', { chat_id: chat, action: 'typing' });

  const convId = (await env.KV.get(kvKey)) || null;
  // She sleeps from 11 pm to 7 am and after you say good night: no AI, one short "sleeping" line, then she stays quiet.
  const gate = await beforeReply(env, settings, text);
  if (gate.updating) { await send(env, chat, gate.reply || '🔕'); if (gate.sticker) await sendSticker(env, chat, gate.sticker).catch(() => false); return; }   // update mode: silent, your words are saved as update notes
  if (gate.sleeping) {
    const id = await sleepTurn(env, { convId, text, source: 'telegram', via, reply: '' });   // saved and queued: she answers in the morning
    if (!convId) await env.KV.put(kvKey, id);
    if (gate.quiet) await react(env, chat, msg.message_id, '😴');                              // already told you once: just "seen"
    else if (!(await sendSticker(env, chat, 'sleep'))) await send(env, chat, sleepingLine(settings));
    return;
  }
  await api(env, 'sendChatAction', { chat_id: chat, action: 'typing' });
  // her mood decides how fast she answers: angry = reads and replies late, clingy = instantly, sleepy or ill = slow with typos
  let pace = { delay: 0, react: '' };
  try {
    const mk = await moodKindNow(env, settings).catch(() => 'normal'), her0 = gate.her || await getHer(env);
    pace = moodPace(sickOf(her0) ? 'sick' : mk, healthOf(her0).health < 45);
    if (gate.stickerFirst) await sendSticker(env, chat, gate.stickerFirst).catch(() => false);
    if (pace.react) await react(env, chat, msg.message_id, pace.react);
    for (let w = 0; w < pace.delay; w += 4000) { await api(env, 'sendChatAction', { chat_id: chat, action: 'typing' }); await sleep(Math.min(4000, pace.delay - w)); }
  } catch { /* answer normally */ }
  const wantVoice = via === 'voice' || settings.voice.autoplay;
  try {
    const solving = Boolean(fileCtx) && (SOLVE_WORDS.test(text) || (mediaKind === 'picture' && /^Solve this question/.test(text)));
    const chatText = (fileCtx ? fileCtx + '\n\n' : '') + (solving ? SOLVE_RULES + '\n\n' : '') + (quoted ? `(I am replying to this earlier message${rm && rm.date ? ' from ' + new Date(rm.date * 1000 + 19800000).toLocaleDateString('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short' }) : ''}: "${quoted}")\n\n${text}` : text);
    const r = await chatOnce(env, { convId, text: chatText, source: 'telegram', via, spoken: wantVoice, gate, brain: solving ? 'solve' : undefined });
    if (!convId) await env.KV.put(kvKey, r.convId);
    if (r.pre) { await send(env, chat, r.pre); if (/\/img\/[a-z0-9]+\.jpg/i.test(r.image || '')) await sendPic(env, 'drawing').catch(() => false); await api(env, 'sendChatAction', { chat_id: chat, action: 'upload_photo' }); await sleep(3500); }   // "please wait, I am changing..."
    if (r.image && /\/img\/[a-z0-9]+\.jpg/i.test(r.image)) { const bytes = await imageBytes(env, /\/img\/([a-z0-9]+)\.jpg/i.exec(r.image)[1]); if (bytes) await sendPhotoBytes(env, chat, bytes, ''); }
    else if (r.image) { const origin = await env.KV.get('origin').catch(() => null), pm = /\/images\/(?:outfits|update)\/[a-z0-9-]+\.webp/.exec(r.image); if (origin && pm) await sendPhoto(env, chat, origin + pm[0], '').catch(() => false); }
    const clean = solving ? r.reply : plainChat(r.reply), shown = pace.typos ? typos(clean) : clean, btns = wantsSootheButtons(await getHer(env), settings) ? SOOTHE_ROWS : null;
    if (wantVoice) await send(env, chat, shown); else await sendBubbles(env, chat, shown, settings.chat.bubbles, btns);
    if (!solving && listLines(r.reply).length >= 4) await sendWithButtons(env, chat, 'Want this as a checklist you can tick off?', [[{ text: '✅ Make a checklist', data: 'mkl' }]]).catch(() => null);
    if (gate.sticker) await sendSticker(env, chat, gate.sticker).catch(() => false);   // repairing / new dress
    if (wantVoice) await sendVoice(env, chat, r.reply);
    await finishChat(env, { convId: r.convId, userMsgId: r.userMsgId, text: chatText, reply: r.reply, model: r.model, source: 'telegram', settings: r.settings });
  } catch (e) {
    await send(env, chat, e.message || 'Something went wrong.');
  }
}
