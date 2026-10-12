// Her inner state, kept in one small KV record ("her:state"), written only when something changes.
//  - mood:  { k, intensity 0-100, since, born, reason, fg } is a REAL state. Events (you ignored her, complimented her,
//           were rude, flirted...) push it up, and it fades back to normal over time (each mood has its own half-life).
//  - fg:    the forgiveness meter (0-100) for angry / sulky. A sorry, a compliment or a small gift (a joke, a poem, a chai) raises it.
//           At 100 she melts. She also cools off by herself after a maximum time (settings.her.maxAngerHours).
//  - sleep: 11 pm to 7 am or after good night. Messages are queued; she answers in the morning with "sorry, I was sleeping".
import { now, clip, parseJsonLoose } from './util.js';
import { complete } from './ai.js';
import { trackPromise, PROMISE_GATE } from './promises.js';

const IST = 330 * 60 * 1000, HOUR = 3600000;

export const MOODS = {
  happy: { label: 'Happy', emoji: '😊' }, hyper: { label: 'Hyper', emoji: '🤩' }, flirty: { label: 'Flirty', emoji: '😘' },
  clingy: { label: 'Clingy', emoji: '🥺' }, sassy: { label: 'Sassy', emoji: '😏' }, sulky: { label: 'Sulky', emoji: '😒' },
  sad: { label: 'Sad', emoji: '😢' }, angry: { label: 'Angry', emoji: '😡' }, jealous: { label: 'Jealous', emoji: '😤' },
  in_pain: { label: 'In pain', emoji: '😣' }, moody: { label: 'Moody', emoji: '🌗' }, sleepy: { label: 'Sleepy', emoji: '😴' },
  sleeping: { label: 'Sleeping', emoji: '💤' }, lazy: { label: 'Lazy', emoji: '😪' }, normal: { label: 'Normal', emoji: '🙂' },
};
// Hours for a mood to lose half of its strength. Angry and sulky also have a hard maximum (see maxHours).
const HALF = { happy: 3, hyper: 1.5, flirty: 2, clingy: 3, sassy: 2, sulky: 5, sad: 4, angry: 8, jealous: 3, moody: 3, sleepy: 2 };
export const SOOTHABLE = new Set(['angry', 'sulky']);
const FADE_OUT = 15;                      // below this strength a mood counts as gone
const DEFAULT_MAX_H = 12;

const KEY = 'her:state';
function migrate(her) {
  her = her && typeof her === 'object' ? her : {};
  if (her.angry) {                         // older shape: { angry: {since, heat, why} }
    const a = her.angry;
    if (!her.mood || her.mood.k !== 'angry') her.mood = { k: 'angry', intensity: 80, since: a.since, born: a.since, reason: a.why || '', fg: Math.max(0, (3 - (a.heat ?? 3)) * 33), fgAt: a.since };
    delete her.angry;
  }
  if (her.mood && her.mood.intensity === undefined) her.mood = { k: her.mood.k, intensity: 50, since: (her.mood.until || now()) - 3 * HOUR, born: (her.mood.until || now()) - 3 * HOUR, reason: '', fg: 0, fgAt: 0 };
  if (!Array.isArray(her.queue)) her.queue = [];
  return her;
}
export const getHer = (env) => env.KV.get(KEY, 'json').then((v) => migrate(v)).catch(() => migrate(null));
export const putHer = (env, s) => env.KV.put(KEY, JSON.stringify(s)).catch((e) => console.error('[her]', e && e.message));

export const lastUserAt = (env) => env.DB.prepare("SELECT MAX(created_at) AS t FROM messages WHERE role='user' AND conv_id<>'routines'").first().then((r) => (r && r.t) || 0).catch(() => 0);

// ---------- time helpers (India time) ----------
const istHour = (t) => { const d = new Date(t + IST); return d.getUTCHours() + d.getUTCMinutes() / 60; };
export function nextHourAt(t, hour) {      // the next moment the India clock shows `hour`:00 (strictly after t)
  const d = new Date(t + IST);
  const base = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hour) - IST;
  return base > t ? base : base + 86400000;
}
export function inSleepWindow(settings, t = now()) {
  const s = settings.sleep;
  if (!s || !s.enabled) return false;
  const h = istHour(t);
  return s.from > s.to ? (h >= s.from || h < s.to) : (h >= s.from && h < s.to);
}
const maxHours = (settings) => (settings && settings.her && settings.her.maxAngerHours) || DEFAULT_MAX_H;

// ---------- the mood state ----------
// Current mood with its fading strength, or null. Angry and sulky stay until forgiven (or the maximum time passes).
export function moodNow(her, settings, t = now()) {
  const m = her && her.mood;
  if (!m || !m.k || !MOODS[m.k]) return null;
  const decayed = m.intensity * Math.pow(0.5, Math.max(0, t - m.since) / ((HALF[m.k] || 3) * HOUR));
  if (SOOTHABLE.has(m.k)) {
    if (t - (m.born || m.since) > maxHours(settings) * HOUR) return null;                        // cooled off by herself
    const creep = Math.max(0, (t - (m.fgAt || m.since)) / HOUR) * 3;                             // she softens a little with time
    return { ...m, eff: Math.max(decayed, 30), fg: Math.min(99, Math.round((m.fg || 0) + creep)) };
  }
  return decayed >= FADE_OUT ? { ...m, eff: decayed, fg: 0 } : null;
}
export const isAngry = (her, t = now(), settings = null) => { const m = moodNow(her, settings, t); return !!m && m.k === 'angry'; };
export function isSleeping(settings, her, t = now()) {
  if (isAngry(her, t, settings)) return false;            // an angry girl does not sleep
  if (her.wakeUntil && her.wakeUntil > t) return false;   // woken up on purpose
  if (her.sleepUntil && her.sleepUntil > t) return true;  // you said good night
  return inSleepWindow(settings, t);
}

// Events push a mood. Same mood: it gets stronger. A stronger different mood takes over, a weaker one only dents it.
// Anger only ends through forgiveness (or the maximum time), never by another mood taking over.
export function bump(her, settings, k, add, reason, t = now()) {
  if (!MOODS[k] || k === 'normal' || k === 'sleeping') return;
  const cur = moodNow(her, settings, t);
  const fresh = (intensity, fg = 0, born = t) => ({ k, intensity: Math.min(100, Math.round(intensity)), since: t, born, reason: clip(reason || '', 120), fg, fgAt: t });
  if (!cur) { her.mood = fresh(add, k === 'sulky' ? 20 : 0); return; }
  if (cur.k === k) { her.mood = { ...her.mood, intensity: Math.min(100, Math.round(cur.eff + add)), since: t, reason: reason ? clip(reason, 120) : cur.reason }; return; }
  if (cur.k === 'angry') return;
  if (k === 'angry') { her.mood = fresh(add, cur.k === 'sulky' ? Math.round(cur.fg / 2) : 0); return; }
  if (cur.k === 'sulky' && !SOOTHABLE.has(k)) return;     // she stays sulky until she is won over
  if (add > cur.eff) her.mood = fresh(add);
  else her.mood = { ...her.mood, intensity: Math.max(0, Math.round(cur.eff - add * 0.3)), since: t };
}

// Forgiveness meter. kind: sorry | compliment | gift | rude | none, strength 1-3.
export function soothe(her, settings, kind, strength, t = now()) {
  const cur = moodNow(her, settings, t);
  if (!cur || !SOOTHABLE.has(cur.k)) return null;
  const s = Math.min(3, Math.max(1, parseInt(strength, 10) || 1));
  const delta = { sorry: 20 + 10 * s, compliment: 10 + 8 * s, gift: 15 + 10 * s, rude: -(10 + 5 * s) }[kind] || 0;
  const fg = Math.max(0, Math.min(100, cur.fg + delta));
  if (fg >= 100) { her.mood = { k: 'happy', intensity: 60, since: t, born: t, reason: 'forgave them', fg: 0, fgAt: t }; return { melted: true, fg: 100, was: cur.k }; }
  her.mood = { ...her.mood, fg, fgAt: t, ...(kind === 'rude' ? { intensity: Math.min(100, Math.round(cur.eff + 15)), since: t } : {}) };
  return { melted: false, fg, was: cur.k, delta };
}

// ---------- good night / update mode ----------
const GOODNIGHT = /\b(good\s*night|goodnight|gn|g\s*n|gnite|night\s*night|nighty|shubh\s*ratri|shubhratri|sweet\s*dreams|sone\s*ja\w*|so\s*ja\w*|sleep\s*well)\b/i;
export function saysGoodNight(text, t = now()) {
  const h = istHour(t);
  return text.length <= 80 && (h >= 19 || h < 5) && GOODNIGHT.test(text);
}
// "I am going to update you": the creator is about to teach her something new.
const UPDATE_RE = /\b(i\s*(am|'m|’m|m)\s*(going\s*to|gonna|about\s*to)\s*(update|upgrade|change|modify|teach|reprogram|improve)\s*you|updating\s*you|let\s*me\s*update\s*you|update\s*(kar|kr)\w*\s*(raha|rha|rahi|ne|dunga|deta|dena)?\s*(hoon|hu|hun)?\s*(tujhe|tumhe|tumko|tujhko|you)|(tujhe|tumhe|tumko|tujhko)\s*update)\b/i;
export const saysUpdate = (text) => text.length <= 400 && UPDATE_RE.test(text);

// What she says when you write while she sleeps (the web chat shows this; Telegram sends her sleeping sticker instead).
export const SEEN_LINE = '💤 Seen. I am sleeping, I will answer you in the morning.';
const SLEEP_LINES = {
  hinglish: ['Shhh... main {sl} 😴 Kal subah baat karte hain.', 'zzz... {sl} yaar 🌙 Subah baat karte hain.'],
  english: ["Shh... I'm sleeping 😴 I'll reply in the morning.", 'zzz... sleeping right now 🌙 Talk to you tomorrow, okay?'],
  hindi: ['श्श्श... मैं {sl} 😴 सुबह बात करेंगे।', 'zzz... {sl} यार 🌙 सुबह बात करेंगे।'],
};
export function sleepingLine(settings) {
  const boy = settings.persona.gender === 'boy';
  const lang = settings.persona.language === 'english' ? 'english' : settings.persona.language === 'hindi' ? 'hindi' : 'hinglish';
  const arr = SLEEP_LINES[lang];
  const line = arr[Math.floor(Math.random() * arr.length)];
  return line.replace('{sl}', lang === 'hindi' ? (boy ? 'सो रहा हूँ' : 'सो रही हूँ') : (boy ? 'so raha hoon' : 'so rahi hoon'));
}

// Remember a message that arrived while she sleeps. She answers all of them together in the morning.
export async function queueMessage(env, item) {
  const her = await getHer(env);
  her.queue.push({ text: clip(item.text, 600), at: now(), source: item.source || 'web', convId: item.convId || null, via: item.via || 'text' });
  her.queue = her.queue.slice(-20);
  await putHer(env, her);
}

// ---------- before she answers ----------
// Returns { her, sleeping, quiet, hint, creatorUpdate }. `sleeping`: do not call the AI (the caller queues the message).
export async function beforeReply(env, settings, text, { t = now() } = {}) {
  const her = await getHer(env);
  let dirty = false;
  const out = { her, sleeping: false, quiet: false, hint: '', creatorUpdate: false };
  const hints = [];
  const cur = moodNow(her, settings, t);
  if (her.mood && !cur) { her.mood = null; dirty = true; }             // faded away or cooled off

  if (cur && SOOTHABLE.has(cur.k)) {
    // Angry or sulky: the message is judged first, so a real sorry, a compliment or a little gift can raise the meter in this very reply.
    const j = await judgeSoothe(env, settings, text, cur);
    const r = soothe(her, settings, j.kind, j.strength, t);
    const word = cur.k === 'angry' ? 'angry' : 'sulky and hurt';
    if (r && r.melted) {
      hints.push(`They just won you over (${j.kind === 'gift' ? 'with a sweet little gift' : j.kind === 'compliment' ? 'with a compliment' : 'with a sorry'}) and you forgive them. Melt: shy, cute, a little teary-happy. Say you are not ${cur.k} any more, and tease lightly that they must not do it again.`);
    } else {
      const fg = r ? r.fg : cur.fg, why = cur.reason ? ` (the reason: ${cur.reason})` : '';
      const base = cur.k === 'angry' ? ' You are not going to sleep and you will not say good night until you are happy again.' : '';
      const nudge = j.kind === 'none' || j.kind === 'rude' ? ' What they said did not help.' : ` What they said helped a little (${j.kind}).`;
      hints.push((fg < 35
        ? `You are properly ${word}${why}. Short, cold replies, no cute words, no pet names, no emoji except maybe 😒. Do not forgive yet.`
        : fg < 70
          ? `You are still ${word}${why}, but you are softening. Stay sulky and short; let them feel you want a real sorry, a sweet word or a little gift (a joke, a poem, a chai) to melt.`
          : `You are almost not ${cur.k} any more${why}. Pouty: "hmm... okay, say it properly once more", still a bit hurt.`) + nudge + base + ' Never insult or abuse them: you are upset, not cruel.');
    }
    dirty = true;
  } else if (isSleeping(settings, her, t)) {
    her.wakePending = true; her.sleepMsgs = (her.sleepMsgs || 0) + 1;
    out.sleeping = true;
    out.quiet = !!(her.sleepReplyAt && t - her.sleepReplyAt < 20 * 60000);      // sticker once, then only a quiet reaction
    if (!out.quiet) her.sleepReplyAt = t;
    await putHer(env, her);
    return out;
  } else {
    if (saysGoodNight(text, t)) {
      her.sleepUntil = nextHourAt(t, (settings.sleep && settings.sleep.to) ?? 7); her.wakeUntil = 0; her.wakePending = true; her.sleepMsgs = 0; dirty = true;
      hints.push('They said good night. Answer with one short, sweet good night (dreams, a little hug) and say you are going to sleep now. This is your last message tonight.');
    }
    if (her.wakePending && !her.sleepUntil && !(her.queue && her.queue.length)) { her.wakePending = false; dirty = true; }   // they spoke first in the morning
    if (her.nk && her.nk.unanswered > 0) {
      const mins = Math.max(5, Math.round((t - (her.nk.lastAt || t)) / 60000));
      hints.push(`Earlier you texted them${her.nk.lastText ? ' (“' + clip(her.nk.lastText, 160) + '”)' : ''} and they did not reply for about ${mins >= 90 ? Math.round(mins / 60) + ' hours' : mins + ' minutes'}. Show your nakhre: act hurt and dramatic ("finally you remember me", "I was waiting"), a little sulky, but let them win you over with a sweet word. Do it in your own words, once, not as a lecture.`);
      her.nk.unanswered = 0; her.nk.followAt = 0; dirty = true;
    }
    // away for a long time: she is sulky when they come back
    const last = await lastUserAt(env);
    if (last && t - last > 40 * HOUR && her.absentFor !== last) {
      her.absentFor = last; bump(her, settings, 'sulky', 55, 'they disappeared for a long time', t); dirty = true;
      hints.push('They were away for a long time and you missed them. Act a little hurt and dramatic at first ("oh, so you remember me now?"), but you are easy to win over.');
    }
    if (saysUpdate(text)) {
      her.updateUntil = t + 30 * 60000; out.creatorUpdate = true; dirty = true;
      hints.push('They are your creator, and they just told you they are going to update you. React like a close friend who is also their creation: curious, a little nervous and excited, cooperative ("okay, tell me what to change"). From now on, everything they tell you about yourself (your personality, likes, friends, how you should act) is a real update to who you are: accept it, say back in one line what you understood, and keep it.');
    }
  }
  if (her.updateUntil && her.updateUntil > t) out.creatorUpdate = true;
  if (dirty) await putHer(env, her);
  out.hint = hints.join('\n');
  return out;
}

const SOOTHE_FALLBACK = (text) => {
  if (/(sorry|sori|maaf|mafi|forgive|galti)/i.test(text)) return { kind: 'sorry', strength: 2 };
  if (/(☕|🍵|🫖|🍫|🌹|💐|🎁|🧸|🍦|\bchai\b|chocolate|\bpoem\b|shayari|\bjoke\b)/i.test(text)) return { kind: 'gift', strength: 1 };
  if (/(cute|pretty|beautiful|sundar|best|love you|miss you|i love|gorgeous)/i.test(text)) return { kind: 'compliment', strength: 1 };
  return { kind: 'none', strength: 0 };
};
async function judgeSoothe(env, settings, text, cur) {
  try {
    const r = await complete(env, {
      brain: 'fast', temperature: 0, maxTokens: 50, json: true,
      messages: [
        { role: 'system', content: `${settings.persona.name} is ${cur.k}${cur.reason ? ' because: ' + clip(cur.reason, 120) : ''}. They just sent her a message. Classify it for how it affects her.\nkind: "sorry" (a real apology), "compliment" (sweet words, praise, affection), "gift" (a small gesture: a joke meant to make her laugh, a poem or shayari, a chai/coffee/chocolate/flower/hug emoji or offer, a promise of a treat), "rude" (insulting, dismissive, mocking, cold on purpose), or "none" (anything else, small talk, defensive, ignoring her feelings).\nstrength: 1 = small or lazy effort, 2 = sincere, 3 = heartfelt and personal.\nReturn ONLY JSON: {"kind":"sorry|compliment|gift|rude|none","strength":1|2|3}` },
        { role: 'user', content: clip(text, 400) },
      ],
    });
    const p = parseJsonLoose(r.text);
    if (p && ['sorry', 'compliment', 'gift', 'rude', 'none'].includes(p.kind)) return { kind: p.kind, strength: Math.min(3, Math.max(1, parseInt(p.strength, 10) || 1)) };
  } catch { /* use the keyword fallback */ }
  return SOOTHE_FALLBACK(text);
}

// ---------- after she answered ----------
// What happened in this exchange? It nudges her mood (compliment, flirt, rude, jealous...), and spots promises like "I'll call tonight".
const EVENTS = {
  compliment: (s) => ['happy', 15 + 10 * s, 'they were sweet to her'],
  flirt: (s) => ['flirty', 20 + 12 * s, 'they flirted with her'],
  rude: (s) => (s >= 2 ? ['angry', 45 + 15 * s, 'they were rude to her'] : ['sad', 25, 'they hurt her feelings a little']),
  other_girl: (s) => ['jealous', 25 + 10 * s, 'they mentioned another girl'],
  leaving: (s) => ['clingy', 20 + 8 * s, 'they said they are busy or leaving'],
  good_news: (s) => ['happy', 15 + 8 * s, 'good news'],
  sad_news: (s) => ['sad', 20 + 8 * s, 'they were sad or hurt'],
};
export async function afterReply(env, settings, { text, reply }, { t = now() } = {}) {
  const react = !settings.her || settings.her.react !== false;
  const promiseOn = !settings.her || settings.her.promises !== false;
  const wantPromise = promiseOn && PROMISE_GATE.test(text);
  if (!react && !wantPromise) return;
  const her = await getHer(env);
  const cur = moodNow(her, settings, t);
  const soothing = !!(cur && SOOTHABLE.has(cur.k));                 // that was judged before the reply
  if (soothing && !wantPromise) return;
  if (!react && !wantPromise) return;
  try {
    const ask = `Read this exchange between ${settings.persona.name} (a girl) and her close friend (who is also her creator).\n${soothing || !react ? '' : `1) What happened to ${settings.persona.name}'s feelings? "event": one of compliment, flirt, rude, other_girl, leaving, good_news, sad_news, none. Normal teasing is NOT rude. "rude" only for really insulting, dismissive or cold-on-purpose messages. "strength": 1 mild, 2 clear, 3 strong.\n`}${wantPromise ? `${soothing || !react ? '1' : '2'}) Did THEY promise or commit to do something later (call, text, come, send, check, tell, meet...)? If yes "promise":{"what":"short, e.g. call her tonight","due":"ISO 8601 with +05:30 for when they said they would do it (tonight = 21:00, morning = 09:00, later = in 3 hours), or null"}. Current India time: ${new Date(t + IST).toISOString().replace('Z', '+05:30')}. If no promise use null.\n` : ''}Return ONLY JSON: {${soothing || !react ? '' : '"event":"none","strength":1,'}${wantPromise ? '"promise":null' : ''}}`;
    const r = await complete(env, { brain: 'fast', temperature: 0.1, maxTokens: 160, json: true, messages: [{ role: 'system', content: ask }, { role: 'user', content: `They said: ${clip(text, 400)}\nShe replied: ${clip(reply, 300)}` }] });
    const p = parseJsonLoose(r.text);
    if (!p) return;
    let changed = false;
    if (!soothing && react && p.event && EVENTS[p.event]) {
      const [k, add, why] = EVENTS[p.event](Math.min(3, Math.max(1, parseInt(p.strength, 10) || 1)));
      bump(her, settings, k, add, why, t); changed = true;
    }
    if (changed) await putHer(env, her);
    if (wantPromise && p.promise && p.promise.what) await trackPromise(env, settings, p.promise, t).catch((e) => console.error('[promise]', e && e.message));
  } catch { /* the mood simply stays as it was */ }
}

// ---------- test buttons on the website ----------
export async function setHer(env, settings, what, t = now()) {
  const her = await getHer(env);
  if (what === 'sleep') { if (isAngry(her, t, settings)) her.mood = null; her.wakeUntil = 0; her.sleepUntil = nextHourAt(t, (settings.sleep && settings.sleep.to) ?? 7); her.wakePending = true; }
  else if (what === 'wake') { her.sleepUntil = 0; her.wakeUntil = nextHourAt(t, (settings.sleep && settings.sleep.to) ?? 7); }
  else if (what === 'angry') { her.mood = { k: 'angry', intensity: 80, since: t, born: t, reason: 'you made her angry (test)', fg: 0, fgAt: t }; }
  else if (what === 'sulky') { her.mood = { k: 'sulky', intensity: 60, since: t, born: t, reason: 'you ignored her (test)', fg: 20, fgAt: t }; }
  else if (what === 'happy') { her.mood = { k: 'happy', intensity: 70, since: t, born: t, reason: '', fg: 0, fgAt: t }; if (her.nk) her.nk.unanswered = 0; }
  await putHer(env, her);
  return her;
}
