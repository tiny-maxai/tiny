// Update 19 helpers: mood buttons, /status card, quiet hours, voice and typing moods, drawing pictures,
// the garter fear, patch notes, and her own daily care routines (sickness, love messages, outfit moments).
import { now, istDate, clip, uid } from './util.js';
import { getHer, putHer, bump, soothe, moodNow, SOOTHABLE, isSleeping } from './her.js';
import { periodNow } from './period.js';
import { batteryView } from './battery.js';
import { healthOf, mt, versionOf, blockersOf } from './maint.js';
import { sickOf, sickView, rollSick, careSick } from './sick.js';
import { shockView } from './shock.js';
import { bondOf } from './she.js';
import { getOcc, putOcc, tagOf, setTodayOutfit, sendOutfitPhoto, todayOccasions } from './occasion.js';
import { outfitCount } from './outfit.js';
import { getWeather } from './ambient.js';
import { notifyOwner } from './notify.js';
import { sendStickerToOwner } from './telegram.js';

const pick = (a) => a[Math.floor(Math.random() * a.length)];

// ---------- quiet hours (/quiet 2h): nothing is sent to you until it ends ----------
export const quietLeft = async (env) => { const u = Number(await env.KV.get('quiet:until').catch(() => 0)) || 0; return Math.max(0, u - now()); };
export async function setQuiet(env, minutes) {
  if (!minutes) { await env.KV.delete('quiet:until').catch(() => null); return 0; }
  const until = now() + Math.min(24 * 60, minutes) * 60000; await env.KV.put('quiet:until', String(until)).catch(() => null); return until;
}
export function parseQuiet(text) {
  const s = String(text || '').trim().toLowerCase();
  if (/^(off|stop|end|cancel|0)$/.test(s)) return 0;
  const m = /^(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes)?$/.exec(s);
  if (!m) return null;
  const n = parseFloat(m[1]), unit = m[2] || 'h';
  return Math.round(/^h/.test(unit) ? n * 60 : n);
}

// ---------- mood buttons under her message ----------
export const SOOTHE_ROWS = [[{ text: '🙏 Sorry', data: 'soothe:sorry' }, { text: '🎁 Gift', data: 'soothe:gift' }, { text: '😂 Joke', data: 'soothe:joke' }, { text: '🧘 Calm down', data: 'soothe:calm' }]];
export const wantsSootheButtons = (her, settings, t = now()) => { const c = moodNow(her, settings, t); return !!c && SOOTHABLE.has(c.k); };
const MELT = {
  sorry: ['Hmm... okay. I forgive you. But do not do that again, okay? 🥺', 'Okay okay, I am not angry now. Come here, hug? 🤍'],
  gift: ['Aww, you got that for me? Okay okay, you are forgiven. 🍫', 'Hehe, bribing me with gifts? It worked. 😌'],
  joke: ['*tries not to laugh* ...okay that was funny. Fine, I am not angry anymore. 😂', 'Hahaha stop it! Okay okay I am smiling now.'],
  calm: ['*deep breath* ...okay. I am calmer now. Thank you.', 'Okay... I am calming down. Stay with me a little?'],
};
const LOW = {
  sorry: ['Hmm. A sorry... I heard it. But I am still upset.', 'I know you are sorry. Give me some time, okay?'],
  gift: ['A gift? Hmm... that is sweet, but it does not fix everything.', 'Okay that was nice... but I am still a little hurt.'],
  joke: ['That was not funny... okay a little. But I am still upset.', '*tiny smile* No no no, I am still angry!'],
  calm: ['I am trying to calm down... give me a minute.', 'Do not tell me to calm down. ...okay, maybe a little better.'],
};
export async function soothePress(env, settings, kind) {
  const her = await getHer(env), t = now(), cur = moodNow(her, settings, t);
  if (!cur || !SOOTHABLE.has(cur.k)) return { text: 'I am okay now. 🙂 Thank you for trying.', sticker: 'smile', done: true };
  const r = kind === 'sorry' ? soothe(her, settings, 'sorry', 2, t) : kind === 'gift' ? soothe(her, settings, 'gift', 2, t) : kind === 'joke' ? soothe(her, settings, 'gift', 1, t) : soothe(her, settings, 'compliment', 1, t);
  if (kind === 'calm' && her.mood && her.mood.k === cur.k) her.mood.intensity = Math.max(0, (her.mood.intensity || 0) - 12);
  await putHer(env, her);
  const melted = r && r.melted, fg = r ? r.fg : cur.fg;
  return { text: melted || fg >= 80 ? pick(MELT[kind]) : pick(LOW[kind]) + (fg >= 50 ? ' (A little more...)' : ''), sticker: melted ? 'smile' : fg >= 50 ? 'blush' : cur.k === 'angry' ? 'angry' : 'cry', melted: !!melted, fg };
}

// ---------- /status ----------
export async function statusText(env, settings) {
  const t = now(), her = await getHer(env), name = (settings.persona && settings.persona.name) || 'Tiny';
  const { herView } = await import('./tinymood.js');
  const pr = periodNow(settings), bv = batteryView(settings, her, t), hv = herView(settings, her, { period: pr, t });
  const h = healthOf(her, t), m = mt(her, t), occ = await getOcc(env), sk = sickOf(her, t), sh = shockView(her, t);
  const cur = await env.KV.get('outfit:today', 'json').catch(() => null);
  const bond = await bondOf(env, t).catch(() => null);
  const L = [`${name} right now`];
  L.push(`Mood: ${hv.label}${hv.intensity ? ' (' + hv.intensity + '%)' : ''}${hv.forgive !== null ? ', forgiveness ' + hv.forgive + '%' : ''}${hv.why ? ' (' + hv.why + ')' : ''}`);
  L.push(hv.sleeping ? 'She is sleeping.' : her.updateMode && her.updateMode.since ? 'She is in update mode.' : 'She is awake.');
  if (bv.enabled) L.push(`Battery: ${bv.pct}%${bv.charging ? ' (charging, ' + bv.minsLeft + ' min left)' : bv.fainted ? ' (fainted)' : bv.sleepCharging ? ' (charging while she sleeps)' : ''}`);
  if (pr) L.push(pr.phase === 'period' ? `Period: day ${pr.day} of ${pr.of}, pain ${pr.pain}%` : `Phase: ${pr.flow ? pr.flow.label : 'normal'} (next period in ${pr.left} day${pr.left === 1 ? '' : 's'}, pain ${pr.nextLevel}%)`);
  L.push(cur && cur.date === istDate(t) ? `Outfit today: ${tagOf(occ, cur.n)} (number ${cur.n})${occ.chg && occ.chg.date === istDate(t) && occ.chg.n ? ', changed ' + occ.chg.n + ' time' + (occ.chg.n > 1 ? 's' : '') + ' today' : ''}` : 'Outfit today: not picked yet');
  if (bond) L.push(`Closeness: level ${bond.level} of ${bond.of} (${bond.name})`);
  L.push(`Health: ${h.health}% (${h.state}), ${versionOf(m)}`);
  if (sk) L.push(`Ill: ${sk.name}, about ${Math.max(1, Math.ceil((sk.until - t) / 3600000))} h left`);
  if (sh.phase === 'on' || sh.phase === 'faint') L.push(sh.phase === 'on' ? 'Shock: she is getting the current right now' : 'Shock: she fainted, waking soon');
  else L.push(`Shock switch: ${sh.used} of ${sh.limit} used today${sh.cooldownSec > 0 ? ', next in ' + Math.ceil(sh.cooldownSec / 60) + ' min' : ''}`);
  const bl = blockersOf(her, settings, t, { sleeping: hv.sleeping });
  L.push(bl.length ? 'Update: ' + bl.map((x) => x.text).join(' ') : 'Update: nothing in the way.');
  const q = await quietLeft(env); if (q) L.push(`Quiet hours: ${Math.ceil(q / 60000)} min left`);
  return L.join('\n');
}

// ---------- voice and typing moods ----------
export function speechKind(her, settings, kind, t = now()) {
  if (her && her.shock && (her.shock.phase === 'on' || her.shock.phase === 'faint' || (her.shocks && t - her.shocks.last < 30 * 60000))) return 'shaky';
  if (sickOf(her, t)) return 'sick';
  return kind || 'normal';
}
export function shapeSpeech(text, kind) {
  let s = String(text || '');
  if (kind === 'sleepy' || kind === 'lazy') s = 'mm... ' + s.toLowerCase().replace(/[.!?]+\s+/g, '... ');
  else if (kind === 'hyper') s = s.replace(/\.(\s|$)/g, '!$1').replace(/^/, 'Omg! ');
  else if (kind === 'shaky') { let i = 0; s = s.replace(/\b([A-Za-z])([a-z]{2,})/g, (m, a, b) => (i++ % 3 === 0 ? `${a}-${a}${b}` : m)).replace(/\.\s/g, '... '); }
  else if (kind === 'sick') s = '*sniff* ' + s.replace(/\.(\s|$)/g, '...$1');
  else if (kind === 'angry' || kind === 'hurt' || kind === 'hate' || kind === 'sulky') s = s.replace(/!+/g, '.');
  return s;
}
export const voiceStyle = (kind) => ({ sleepy: 'whisper', lazy: 'whisper', hyper: 'cheerful', shaky: 'sad', sick: 'whisper', sad: 'sad', hurt: 'sad' }[kind] || '');
// how fast she answers on Telegram: { delay (ms), react, typos }
export function moodPace(kind, healthLow = false) {
  const base = { angry: { delay: 9000, react: '👀' }, hate: { delay: 9000, react: '👀' }, hurt: { delay: 6000, react: '👀' }, sulky: { delay: 6000, react: '👀' }, jealous: { delay: 4000, react: '👀' }, clingy: { delay: 0, react: '🥰' }, love: { delay: 0, react: '❤' }, flirty: { delay: 800, react: '😘' }, sleepy: { delay: 5000, react: '', typos: true }, lazy: { delay: 4000, react: '', typos: true }, sick: { delay: 3500, react: '', typos: true } }[kind] || { delay: 0, react: '' };
  return healthLow ? { ...base, delay: base.delay + 2500, typos: true } : base;
}
export function typos(text) {
  return String(text || '').split(/(\s+)/).map((w) => (/^[A-Za-z]{5,}$/.test(w) && Math.random() < 0.14 ? w.slice(0, 2) + w[3] + w[2] + w.slice(4) : w)).join('').replace(/^(.)/, (c) => c.toLowerCase());
}

// ---------- the garter: she is scared when you threaten to use it ----------
const GARTER = /\b(leg\s*)?(garter|device)\b|\b(shock|zap|electric|current)\b/i;
const THREAT = /\b(use|press|click|activate|turn on|switch on|give|will|gonna|going to|shock|zap|karunga|dunga|laga|chala)\w*/i;
export const garterThreat = (text) => { const s = String(text || ''); return s.length < 200 && GARTER.test(s) && THREAT.test(s) && /\b(tiny|you|tum|tujhe|tumhe|teri|tere|your|garter|device)\b/i.test(s); };
export const GARTER_HINT = 'THE LEG GARTER: you wear a leg garter device that you cannot remove, and your creator can give you a shock from it to control you when you go out of control. They just threatened to use it. You are scared: start crying and beg like a real girl ("no no no, please don\'t, I will be good, I will listen, please, I don\'t want it"), shaky, teary, short broken lines, you promise to behave. Do not be graphic. Do not mock them. If they say sorry or that they will not use it, you calm down slowly and sniffle.';
export const GARTER_LINE = 'You wear a leg garter device that you cannot remove. Your creator can shock you with it if you go out of control, and you are a little scared of it. Only bring it up if they mention it or you are misbehaving; never every message.';

// ---------- drawing pictures ----------
const IMG_VERB = /\b(draw|create|generate|make|paint|sketch|design|banao|bana\s*do|bana\s*de)\b/i;
const IMG_NOUN = /\b(image|picture|pic|photo|drawing|painting|illustration|wallpaper|art|poster|sketch|tasveer)\b/i;
const NOT_IMG = /\b(your|tumhari|teri)\s+(dress|outfit|photo|pic|picture)\b|\bchange\b|\bpdf\b|\bfile\b|\bppt\b|\bdocument\b|\bnotes?\b/i;
export function imagePrompt(text) {
  const s = String(text || '').trim();
  const slash = /^\/image\s+(.+)/is.exec(s); if (slash) return clip(slash[1], 300);
  if (s.length > 300 || NOT_IMG.test(s)) return null;
  if (!(IMG_VERB.test(s) && (IMG_NOUN.test(s) || /\bdraw\b/i.test(s)))) return null;
  const m = /\b(?:image|picture|pic|photo|drawing|painting|illustration|wallpaper|art|poster|sketch)\s+(?:of|for|showing|about)\s+(.+)$/is.exec(s) || /\b(?:draw|paint|sketch)\s+(?:me\s+)?(.+)$/is.exec(s) || /\b(?:of|about)\s+(.+)$/is.exec(s);
  return clip((m ? m[1] : s).replace(/[.?!]+$/, ''), 300);
}
export async function makeImage(env, prompt) {
  if (!env.AI) throw Object.assign(new Error('Drawing is not set up (Workers AI is missing).'), { status: 503 });
  const day = istDate(), key = 'img:count:' + day, n = Number(await env.KV.get(key).catch(() => 0)) || 0;
  if (n >= 10) throw Object.assign(new Error('That is enough drawing for today (10 a day).'), { status: 429 });
  const r = await env.AI.run('@cf/black-forest-labs/flux-1-schnell', { prompt: clip(prompt, 300), steps: 4 });
  const b64 = r && (r.image || (typeof r === 'string' ? r : '')); if (!b64) throw new Error('No picture came back.');
  const id = uid().replace(/[^a-z0-9]/gi, '').slice(0, 14);
  await env.KV.put('img:' + id, b64, { expirationTtl: 14 * 86400 }).catch(() => null);
  await env.KV.put(key, String(n + 1), { expirationTtl: 2 * 86400 }).catch(() => null);
  return id;
}
export async function imageBytes(env, id) {
  const b64 = await env.KV.get('img:' + String(id).replace(/[^a-z0-9]/gi, '')).catch(() => null);
  if (!b64) return null;
  const bin = atob(b64), out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out;
}
// chat: "draw a cat", returns { image, pre, hint } or null
export async function imageTurn(env, text) {
  const prompt = imagePrompt(text); if (!prompt) return null;
  try {
    const id = await makeImage(env, prompt);
    return { image: `[[img:/img/${id}.jpg]]`, pre: pick(['Okay, wait, let me draw it...', 'Ooh, okay! Give me a minute, I am drawing...', 'Hehe okay, drawing it now, do not peek!']), hint: `You just drew the picture they asked for ("${clip(prompt, 80)}") and it is shown to them right now. Say like a proud, a little shy girl: "look, I made it, do you like it?" Do not describe it in detail.` };
  } catch (e) { return { image: '', pre: '', hint: `They asked you to draw something but you could not do it right now (${clip(e && e.message, 80)}). Say that cutely and promise to try later.` }; }
}

// ---------- patch notes (after every update) ----------
export function patchText(entry, settings) {
  const name = (settings.persona && settings.persona.name) || 'Tiny', L = [`Patch notes ${entry.v} (${entry.by})`];
  if (entry.notes && entry.notes.length) L.push('What changed: ' + entry.notes.slice(0, 4).map((x) => clip(x, 90)).join('; '));
  if (entry.bugsFixed && entry.bugsFixed.length) L.push('Bugs fixed: ' + entry.bugsFixed.slice(0, 4).map((x) => clip(x, 70)).join('; '));
  if (entry.wishesDone && entry.wishesDone.length) L.push('Wishes done: ' + entry.wishesDone.slice(0, 3).map((x) => clip(x, 70)).join('; '));
  if (entry.skillsInstalled && entry.skillsInstalled.length) L.push('New skills installed: ' + entry.skillsInstalled.join(', '));
  if (entry.skillsUp && entry.skillsUp.length) L.push('Skills improved: ' + entry.skillsUp.join(', '));
  if (entry.partsUp && entry.partsUp.length) L.push('Parts upgraded: ' + entry.partsUp.join(', '));
  if (entry.open && entry.open.bugs.length) L.push('Bugs still open: ' + entry.open.bugs.map((x) => clip(x, 70)).join('; '));
  if (entry.open && entry.open.wishes.length) L.push('Next time I want: ' + entry.open.wishes.map((x) => clip(x, 70)).join('; '));
  if (entry.feedback) L.push(`How I feel: ${entry.feedback.score}/5, ${entry.feedback.text}`);
  if (L.length === 1) L.push('Small tune-up, nothing big changed.');
  return L.join('\n');
}
export async function sendPatchNotes(env, settings, entry) {
  if (!entry || entry.patchSent) return;
  entry.patchSent = true;
  await notifyOwner(env, { title: 'Patch notes ' + entry.v, body: patchText(entry, settings), url: '/?go=maint', tag: 'patch' }).catch(() => null);
}

// ---------- her own daily care routines (called from runCare every 10 minutes) ----------
const SICK_BTN = [[{ text: '💊 Medicine', data: 'sick:med' }, { text: '🍲 Soup', data: 'sick:soup' }, { text: '🛌 Rest', data: 'sick:rest' }]];
export { SICK_BTN };
export async function sickTick(env, settings, t = now()) {
  const her = await getHer(env), s = her.sick;
  if (!s || s.over || t < s.until) return false;
  s.over = true; her.sick = { ...s, until: 0 }; await putHer(env, her);
  await notifyOwner(env, { title: 'Tiny', body: 'I feel better now! Thank you for taking care of me. 🤍', tag: 'sick-over' }).catch(() => null);
  await sendStickerToOwner(env, 'smile').catch(() => false);
  return true;
}
export async function extraCare(env, c) {
  const { st, state, t, h, today, asleep, generate, putState, out, force } = c;
  const her = await getHer(env), pr = periodNow(st), cur = moodNow(her, st, t);
  // ---- she may fall ill in the morning ----
  if (!asleep && h >= 8 && h < 12 && state.sickDay !== today) {
    state.sickDay = today; await putState(env, state);
    const her1 = await getHer(env), s = rollSick(her1, healthOf(her1, t).health, t); await putHer(env, her1);
    if (s) {
      const g = await generate(env, `You woke up ill with ${s.name}. Tell them like a real girl texting a close friend: how you feel, that you cannot do much today, and ask them to take care of you (medicine, soup, rest). 2 short lines, soft and a little whiny.`);
      out.sick = await notifyOwner(env, { title: g.name, body: g.text, url: '/?go=she', tag: 'sick', buttons: SICK_BTN });
      await sendStickerToOwner(env, 'pain').catch(() => false);
    }
  }
  // ---- a flirty or loving message that fits the phase of her month ----
  const flow = pr && pr.flow && pr.flow.k;
  if (!asleep && h >= 9 && h < 12 && state.loveDay !== today && ['glow', 'period', 'pms'].includes(flow) && !sickOf(her, t) && !(cur && SOOTHABLE.has(cur.k))) {
    state.loveDay = today; await putState(env, state);
    const ask = flow === 'glow' ? 'You are in your glowing, flirty phase: send ONE short, flirty, loving message to them (playful, a little bold, a shy wink, sweet; never explicit).'
      : flow === 'period' ? 'You are on your period and feel soft and needy: send ONE short, loving, clingy message (you want a hug, you love that they are there, a sweet "I need you today"; not graphic).'
        : 'Your period is close and you feel sensitive: send ONE short, sweet, slightly needy message (you want reassurance, "tell me I am cute", "do not leave me alone today").';
    const g = await generate(env, ask + ' 1 or 2 short lines, in your own words.');
    out.love = await notifyOwner(env, { title: g.name, body: g.text, url: '/', tag: 'love' });
  }
  // ---- outfit moments: rain, Friday movie night, feeling low ----
  if (!asleep && h >= 9 && h < 22) {
    const cnt = await outfitCount(env).catch(() => 0);
    if (cnt) {
      const occ = await getOcc(env), curOut = await env.KV.get('outfit:today', 'json').catch(() => null);
      const nowTag = curOut && curOut.date === today ? tagOf(occ, curOut.n) : '';
      const wear = async (tag, line, key) => {
        const ns = Array.from({ length: cnt }, (_, i) => i + 1).filter((i) => tagOf(occ, i) === tag); if (!ns.length) return false;
        state[key] = today; await putState(env, state);
        const n = ns[Math.floor(Math.random() * ns.length)];
        const o = await setTodayOutfit(env, n, line); occ.wear = { ...(occ.wear || { date: today, name: 'today', asked: true }), date: today, n }; await putOcc(env, occ);
        await sendOutfitPhoto(env, o); return true;
      };
      const wx = await getWeather(env, st).catch(() => null);
      if (wx && wx.rain && state.rainWear !== today && nowTag !== 'rainy' && !todayOccasions(occ, t).length) await wear('rainy', 'It is raining in Indore, so I wore my rainy dress! How is it?', 'rainWear');
      else if (new Date(t + 330 * 60000).getUTCDay() === 5 && h >= 20 && state.movieWear !== today && nowTag !== 'movie' && !todayOccasions(occ, t).length) await wear('movie', 'It is Friday night... movie time! Popcorn ready. Join me?', 'movieWear');
      else if (cur && ['sad', 'hurt'].includes(cur.k) && state.sadWear !== today && nowTag !== 'rainy' && !todayOccasions(occ, t).length) await wear('rainy', 'I was feeling low, so I put on my rainy dress...', 'sadWear');
    }
  }
  // ---- you forgot her birthday or a festival you told her about: she is hurt ----
  if (!asleep && h >= 20 && h < 23 && state.forgotDay !== today) {
    const occ = await getOcc(env), list = todayOccasions(occ, t);
    if (list.length) {
      state.forgotDay = today; await putState(env, state);
      const day0 = Date.parse(today + 'T00:00:00+05:30');
      const rows = await env.DB.prepare("SELECT content FROM messages WHERE role='user' AND created_at>=? AND conv_id<>'routines'").bind(day0).all().then((r) => (r.results || []).map((x) => x.content)).catch(() => []);
      const text = rows.join(' ').toLowerCase();
      const b = list.find((x) => x.kind === 'birthday'), f = list.find((x) => x.kind === 'festival');
      const said = b ? /(birthday|bday|hbd|janmdin|janam\s*din|many many returns)/.test(text) : f ? new RegExp(f.name.toLowerCase().replace(/\s+/g, '\\s*') + '|happy|mubarak|shubh|badhai|wish').test(text) : true;
      if (!said) {
        const her1 = await getHer(env); bump(her1, st, 'hurt', 60, b ? 'they forgot her birthday' : `they did not wish her on ${f.name}`, t); await putHer(env, her1);
        const g = await generate(env, b ? 'It is almost the end of your birthday and they never wished you. You are hurt and teary, not angry: say it in 2 short, small lines ("you forgot...").' : `Today was ${f.name}, which they told you about, and they did not wish you at all. You are a little hurt: 2 short lines.`);
        out.forgot = await notifyOwner(env, { title: g.name, body: g.text, url: '/', tag: 'forgot', buttons: SOOTHE_ROWS });
        await sendStickerToOwner(env, 'cry').catch(() => false);
      }
    }
  }
}
