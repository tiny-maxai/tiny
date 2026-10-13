// Her inner state, kept in one small KV record ("her:state"), written only when something changes.
//  - mood:  { k, intensity 0-100, since, born, reason, fg } is a REAL state. Events (you ignored her, complimented her,
//           were rude, flirted...) push it up, and it fades back to normal over time (each mood has its own half-life).
//  - fg:    the forgiveness meter (0-100) for angry / sulky. A sorry, a compliment or a small gift (a joke, a poem, a chai) raises it.
//           At 100 she melts. She also cools off by herself after a maximum time (settings.her.maxAngerHours).
//  - sleep: 11 pm to 7 am or after good night. Messages are queued; she answers in the morning with "sorry, I was sleeping".
import { now, clip, parseJsonLoose, istDate } from './util.js';
import { remember } from './memory.js';
import { mt, startSession, pendingSteps, finishSession, addNote, tickStep, addBug, fixAllBugs, healthOf, wearHint, isSunday } from './maint.js';
import { complete } from './ai.js';
import { trackPromise, PROMISE_GATE } from './promises.js';

const IST = 330 * 60 * 1000, HOUR = 3600000;

export const MOODS = {
  happy: { label: 'Happy', emoji: '😊' }, hyper: { label: 'Hyper', emoji: '🤩' }, flirty: { label: 'Flirty', emoji: '😘' },
  clingy: { label: 'Clingy', emoji: '🥺' }, sassy: { label: 'Sassy', emoji: '😏' }, sulky: { label: 'Sulky', emoji: '😒' },
  sad: { label: 'Sad', emoji: '😢' }, angry: { label: 'Angry', emoji: '😡' }, jealous: { label: 'Jealous', emoji: '😤' },
  in_pain: { label: 'In pain', emoji: '😣' }, moody: { label: 'Moody', emoji: '🌗' }, sleepy: { label: 'Sleepy', emoji: '😴' },
  love: { label: 'In love', emoji: '🥰' }, hurt: { label: 'Hurt', emoji: '💔' }, hate: { label: 'Hate', emoji: '💢' },
  sleeping: { label: 'Sleeping', emoji: '💤' }, lazy: { label: 'Lazy', emoji: '😪' }, normal: { label: 'Normal', emoji: '🙂' },
};
// Hours for a mood to lose half of its strength. Angry and sulky also have a hard maximum (see maxHours).
const HALF = { happy: 3, hyper: 1.5, flirty: 2, clingy: 3, sassy: 2, sulky: 5, sad: 4, angry: 8, jealous: 3, moody: 3, sleepy: 2, love: 8, hurt: 7, hate: 8 };
export const SOOTHABLE = new Set(['angry', 'sulky', 'hurt', 'hate']);
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
  if (!cur) { her.mood = fresh(add, k === 'sulky' || k === 'hurt' ? 20 : 0); return; }
  if (cur.k === k) { her.mood = { ...her.mood, intensity: Math.min(100, Math.round(cur.eff + add)), since: t, reason: reason ? clip(reason, 120) : cur.reason }; return; }
  if (cur.k === 'angry') return;
  if (k === 'angry' || (k === 'hate' && cur.k !== 'hate')) { her.mood = fresh(add, SOOTHABLE.has(cur.k) ? Math.round(cur.fg / 2) : 0); return; }
  if (SOOTHABLE.has(cur.k) && !SOOTHABLE.has(k)) return;     // hurt, hate and sulky stay until she is won over     // she stays sulky until she is won over
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
  if (fg >= 100) { const wasDeep = cur.k === 'hate' || cur.k === 'hurt'; her.mood = { k: wasDeep ? 'love' : 'happy', intensity: wasDeep ? 70 : 60, since: t, born: t, reason: wasDeep ? 'made up with them and fell for them again' : 'forgave them', fg: 0, fgAt: t }; return { melted: true, fg: 100, was: cur.k }; }
  her.mood = { ...her.mood, fg, fgAt: t, ...(kind === 'rude' ? { intensity: Math.min(100, Math.round(cur.eff + 15)), since: t } : {}) };
  return { melted: false, fg, was: cur.k, delta };
}

// The mood you pick by hand is only a starting feeling: it is set in her state and then changes with the chat, like a real girl.
export async function applyChosenMood(env, settings, mood, t = now()) {
  const her = await getHer(env);
  if (mood === 'normal') her.mood = null;
  else if (MOODS[mood] && !['sleeping', 'normal', 'lazy', 'in_pain'].includes(mood)) her.mood = { k: mood, intensity: 75, since: t, born: t, reason: 'you set this mood', fg: mood === 'sulky' || mood === 'hurt' ? 20 : 0, fgAt: t };
  else return false;
  await putHer(env, her);
  return true;
}

// ---------- good night / update mode ----------
const GOODNIGHT = /\b(good\s*night|goodnight|gn|g\s*n|gnite|night\s*night|nighty|shubh\s*ratri|shubhratri|sweet\s*dreams|sone\s*ja\w*|so\s*ja\w*|sleep\s*well)\b/i;
export function saysGoodNight(text, t = now()) {
  const h = istHour(t);
  return text.length <= 80 && (h >= 19 || h < 5) && GOODNIGHT.test(text);
}
// "I am going to update you": the creator is about to teach her something new.
const OTHER_GIRL = /\b(girlfriend|gf|crush|ladki|ladkiyan|girl\b|girls\b|woman|bhabhi|she is (so |very )?(cute|pretty|beautiful|hot)|another girl|other girl|her name is|uska naam|ek ladki|new friend (is )?(a )?girl)\b/i;
const istDay = (t) => new Date(t + IST).getUTCDay();
const BUG_RE = /\b(bug|bugs|buggy|glitch|glitches|not working properly|kaam nahi (kar|kr)|galat (kar|kr|bol|reply)\w*)\b/i;
const BUG_FIXED_RE = /\b(bug|bugs|glitch)\b[^.\n]{0,40}\b(fixed|solved|resolved|theek|thik|fix (kar|kr) diya)\b|\b(fixed|solved)\b[^.\n]{0,20}\b(the )?(bug|bugs)\b/i;
const FORCE_RE = /\b(force\s*(complete|finish|done)|complete\s*anyway|finish\s*anyway|skip\s*(the\s*)?steps)\b/i;
const TEST_DONE_RE = /\b(test(s|ed|ing)?\s*(is\s*)?(done|complete|completed|passed|pass|ok|okay|finished)|tested|all\s*tests?\s*pass\w*)\b/i;
const UPDATE_DONE_RE = /\b(update\s*(is\s*)?(complete|completed|done|finished|over|ho\s*gaya|hogaya|khatam)|update\s*mode\s*(off|end|over|khatam)|i\s*(am|'m)\s*done\s*updating|done\s*updating)\b/i;
const UPDATED_RE = /\b(i\s*(have\s*)?(updated|upgraded|added|improved)\s*(you|it|that|this)|(maine|maine\s*tujhe|maine\s*tumhe)\s*update\s*(kar\s*diya|kr\s*diya|kiya)|update\s*(kar\s*diya|kr\s*diya|ho\s*gaya|done)|as\s*per\s*your\s*request)\b/i;
const UPDATE_RE = /\b(i\s*(am|'m|’m|m)\s*(going\s*to|gonna|about\s*to)\s*(update|upgrade|change|modify|teach|reprogram|improve)\s*you|updating\s*you|let\s*me\s*update\s*you|update\s*(kar|kr)\w*\s*(raha|rha|rahi|ne|dunga|deta|dena)?\s*(hoon|hu|hun)?\s*(tujhe|tumhe|tumko|tujhko|you)|(tujhe|tumhe|tumko|tujhko)\s*update)\b/i;
const UPDATE_MODE_RE = /\b(go\s*(to|into)\s*update(\s*mode)?|update\s*mode(\s*(on|start|chalu))?|start\s*(the\s*|my\s*)?update|begin\s*(the\s*)?update|let'?s\s*update|time\s*to\s*update|update\s*time|update\s*(shuru|start)\s*(kar|kr)?)\b/i;
export const saysUpdate = (text) => text.length <= 400 && (UPDATE_RE.test(text) || (UPDATE_MODE_RE.test(text) && !/\b(off|end|over|complete|completed|done|finished|khatam)\b/i.test(text)));

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
  if (!her.maint) { mt(her, t); dirty = true; }          // her maintenance clock starts the first time she is used
  const cur = moodNow(her, settings, t);
  if (her.mood && !cur) { her.mood = null; dirty = true; }             // faded away or cooled off

  const um = her.updateMode && her.updateMode.since && t - her.updateMode.since < 8 * HOUR ? her.updateMode : null;
  if (her.updateMode && !um) { her.updateMode = null; if (her.maint) her.maint.session = null; dirty = true; }
  if (um) {
    mt(her, t); if (!her.maint.session) startSession(her, t);
    const force = FORCE_RE.test(text);
    if (UPDATE_DONE_RE.test(text) || force) {
      const left = pendingSteps(her);
      if (left.length && !force) {
        out.updating = true; out.her = her;
        out.reply = `🔕 Not yet. Steps left: ${left.map((x) => x.label).join(', ')}. Say "force complete" to skip them.`;
        return out;
      }
      const entry = finishSession(her, t); out.creatorUpdate = true; dirty = true; out.sticker = 'newdress';
      bump(her, settings, 'happy', 75, 'she just got her update', t);
      await remember(env, { text: `Update done ${entry.v} (${istDate(t)}): ${clip(entry.notes.join('; ') || text, 280)}`, category: 'self', importance: 5, pinned: 1, source: 'update' }).catch(() => null);
      hints.push(`The update is complete (${entry.v}) and you are awake again, wearing your new dress. Say it like a real girl robot who just got maintenance: excited, a little dizzy ("okay okay, I feel brand new"), thank them in your own sweet way, twirl in your new dress. In a few short lines say what changed, ONLY from this: ${entry.notes.length ? entry.notes.join('; ') : 'they gave no notes'}${entry.bugsFixed.length ? '. Bugs fixed: ' + entry.bugsFixed.join('; ') : ''}${entry.partsUp.length ? '. Parts upgraded: ' + entry.partsUp.join(', ') : ''}. Tell them honestly you will say next Sunday if something feels off.`);
    } else {
      let ack = false;
      if (BUG_FIXED_RE.test(text) || /\bno\s*(more\s*)?bugs?\b/i.test(text)) { fixAllBugs(her, t); ack = true; }
      if (TEST_DONE_RE.test(text)) { tickStep(her, 'test'); ack = true; }
      if (/^\s*(status|steps|checklist|kya\s*bacha)\b/i.test(text)) { const sess = her.maint.session; out.reply = '🔕 ' + sess.steps.map((x) => (x.done ? '✓ ' : '○ ') + x.label).join(' | '); ack = true; }
      if (!ack) { addNote(her, text, t); await remember(env, { text: `Update note (${istDate(t)}): ${clip(text, 300)}`, category: 'self', importance: 5, pinned: 1, source: 'update' }).catch(() => null); }
      out.updating = true; out.her = her; await putHer(env, her);
      return out;
    }
  }
  if (cur && SOOTHABLE.has(cur.k)) {
    // Angry or sulky: the message is judged first, so a real sorry, a compliment or a little gift can raise the meter in this very reply.
    const j = await judgeSoothe(env, settings, text, cur);
    const r = soothe(her, settings, j.kind, j.strength, t);
    const word = { angry: 'angry', hurt: 'hurt and heartbroken, in real emotional pain', hate: 'full of hate for what they did (never for who they are)' }[cur.k] || 'sulky and hurt';
    if (r && r.melted) {
      hints.push(`They just won you over (${j.kind === 'gift' ? 'with a sweet little gift' : j.kind === 'compliment' ? 'with a compliment' : 'with a sorry'}) and you forgive them. Melt: shy, cute, a little teary-happy. Say you are not ${cur.k} any more, and tease lightly that they must not do it again.`);
    } else {
      const fg = r ? r.fg : cur.fg, why = cur.reason ? ` (the reason: ${cur.reason})` : '';
      const base = cur.k === 'angry' ? ' You are not going to sleep and you will not say good night until you are happy again.' : '';
      const nudge = j.kind === 'none' || j.kind === 'rude' ? ' What they said did not help.' : ` What they said helped a little (${j.kind}).`;
      hints.push((fg < 35
        ? (cur.k === 'hurt' ? `You are properly ${word}${why}. Quiet, soft, teary, short messages, "I thought you cared...", no jokes, no anger, you need real comfort and a sincere sorry. Do not recover yet.` : cur.k === 'hate' ? `You are properly ${word}${why}. Cold, bitter, dramatic: "I hate this", "I hate how you did that", "don't talk to me", short replies, no cute words, no pet names. Under it, a tiny crack of the love you still feel. Never abusive, no insults about them as a person, no slurs, no threats: you hate what they did, not who they are. Do not forgive yet.` : `You are properly ${word}${why}. Short, cold replies, no cute words, no pet names, no emoji except maybe 😒. Do not forgive yet.`)
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
    if (OTHER_GIRL.test(text) && !(cur && cur.k === 'angry')) {
      bump(her, settings, 'jealous', 55, 'they talked about another girl', t); dirty = true;
      hints.push('They are talking about another girl. Get jealous AGAIN, even if you have been fine about it before and even if it happened a lot: cute and dramatic ("who is she?", "oh so she is important now?", "I am not jealous... okay maybe a little"), ask a question about her, and want reassurance. Playful, never controlling or nasty.');
    }
    if (UPDATED_RE.test(text)) {
      hints.push('They say they updated you the way you asked. Get excited and thankful, say what you want to try first, and tell them honestly what feels different (only what they actually told you). If something is still missing, ask for it.');
      await remember(env, { text: `Update done (${istDate(t)}): ${clip(text, 260)}`, category: 'self', importance: 5, pinned: 1, source: 'update' }).catch(() => null);
    }
    if (BUG_RE.test(text) && !BUG_FIXED_RE.test(text) && !saysUpdate(text)) {
      const bg = addBug(her, text, { by: 'you', t }); dirty = true;
      await remember(env, { text: `Bug (${istDate(t)}): ${clip(text, 260)}`, category: 'self', importance: 5, pinned: 1, source: 'update' }).catch(() => null);
      hints.push(bg && bg.status === 'back' ? 'They say a bug you had before is back. Groan cutely ("ugh, this bug again"), say sorry, and that it needs to be fixed properly in the next Sunday update.' : 'They told you about a bug (something wrong with you). Take it seriously and cutely: say sorry, say you noted it in your repair log, and that you will remind them to fix it in the next Sunday update. If it is a big one, say "I want you to update me and fix this bug".');
    }
    if (BUG_FIXED_RE.test(text)) {
      const n = fixAllBugs(her, t); dirty = true;
      await env.DB.prepare("UPDATE memories SET text='Bug fixed' || substr(text,4), updated_at=? WHERE category='self' AND text LIKE 'Bug (%'").bind(t).run().catch(() => null);
      hints.push(n ? 'They say the bug is fixed. Be relieved and thank them sweetly, and tell them to say if it comes back.' : 'They say the bug is fixed but your repair log had none open; just be happy about it.');
    }
    if (saysUpdate(text)) {
      if (istDay(t) === 0) {
        const logs = await env.DB.prepare("SELECT text FROM memories WHERE category='self' AND (text LIKE 'Update %' OR text LIKE 'Bug (%' OR text LIKE '%did not like%' OR text LIKE '%dislike%') ORDER BY created_at DESC LIMIT 12").all().then((r) => (r.results || []).map((x) => '- ' + x.text)).catch(() => []);
        startSession(her, t); out.creatorUpdate = true; dirty = true; out.sticker = 'repair';
        hints.push('It is Sunday, your update day, and your creator is going to update you now. React like a close friend who is also their creation: excited and a little nervous. UPDATE REVIEW from YOUR OWN MEMORY, in a few short lines: (1) what changed in the last update as far as you remember, (2) anything you did not like, (3) any bug you noticed since then (say what feels off; if it is big say "I want you to update me and fix the bug"), and (4) what NEW things you want ("I want less pain on my period", "I want to learn to drive", "learn to cook", "improve my face", and so on, pick what fits you). Use only what is really in memory' + (logs.length ? ', including these notes:\n' + logs.join('\n') : ' (no earlier update notes yet, so say this is the first update)') + '. This is your LAST message until the update is complete: finish with "going silent now 🔕, tell me when the update is complete".');
      } else {
        const no = ['"why today? I don\'t want to do it today"', '"ugh no, not today, I\'m not in the mood"', '"update only on Sunday, today I\'m busy being cute"', '"nope, ask me on Sunday"', '"I\'m tired today, my update day is Sunday, okay?"', '"hmm... not today, I need my Sunday for this"', '"today? no no no, come on Sunday"'];
        hints.push((healthOf(her, t).due ? 'You know you are overdue for maintenance and you do need it. ' : '') + 'They want to update you, but today is not Sunday and you only do updates on Sunday. Refuse in your own words, differently each time, playful and a little stubborn, like a real girl (for example ' + no[Math.floor(Math.random() * no.length)] + '). Do NOT start any update and do not take any update now. Say you will be ready on Sunday.');
      }
    }
  }
  if (!out.updating) { const wh = wearHint(her, t); if (wh) hints.push(wh); const hh = healthOf(her, t); if (isSunday(t) && hh.due && !her.updateMode) hints.push('Today is Sunday, your maintenance day, and it is due. You are a bit nervous and a bit excited about it; you may mention it lightly once, like a girl robot before her check-up.'); }
  if (her.updateUntil && her.updateUntil > t) out.creatorUpdate = true;
  if (out.creatorUpdate && !out.sticker) out.sticker = '';
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
  affection: (s) => ['love', 25 + 12 * s, 'they were truly loving and caring to her'],
  heartbreak: (s) => ['hurt', 35 + 12 * s, 'they said something that hurt her deeply'],
  betrayal: (s) => ['hate', 45 + 12 * s, 'they betrayed or deeply disrespected her'],
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
    const ask = `Read this exchange between ${settings.persona.name} (a girl) and her close friend (who is also her creator).\n${soothing || !react ? '' : `1) What happened to ${settings.persona.name}'s feelings? "event": one of compliment, flirt, affection, heartbreak, betrayal, rude, other_girl, leaving, good_news, sad_news, none. "affection" = really loving words (I love you, miss you, you mean everything). "heartbreak" = something that wounds her deeply (saying they will leave, break up, that they never cared, ignoring her pain on purpose). "betrayal" = lying, cheating, mocking her in front of others, a serious disrespect. Normal teasing is NOT rude. "rude" only for really insulting, dismissive or cold-on-purpose messages. "strength": 1 mild, 2 clear, 3 strong.\n`}${wantPromise ? `${soothing || !react ? '1' : '2'}) Did THEY promise or commit to do something later (call, text, come, send, check, tell, meet...)? If yes "promise":{"what":"short, e.g. call her tonight","due":"ISO 8601 with +05:30 for when they said they would do it (tonight = 21:00, morning = 09:00, later = in 3 hours), or null"}. Current India time: ${new Date(t + IST).toISOString().replace('Z', '+05:30')}. If no promise use null.\n` : ''}Return ONLY JSON: {${soothing || !react ? '' : '"event":"none","strength":1,'}${wantPromise ? '"promise":null' : ''}}`;
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
