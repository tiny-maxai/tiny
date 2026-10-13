// Her maintenance: she is a girl robot and the Sunday update keeps her working properly.
// Everything lives inside her state (her.maint): health wear, version history, bug log, wish board, body parts, and the update checklist.
import { now, clip, uid } from './util.js';
import { hasGroq, groqKeys } from './groq.js';

const DAY = 86400000, IST = 330 * 60000;
export const PARTS = [
  { k: 'voice', name: 'Voice', hint: 'singing, speaking, accents' },
  { k: 'face', name: 'Face and looks', hint: 'her look, style, expressions' },
  { k: 'hands', name: 'Hands (cooking)', hint: 'learn to cook, make things' },
  { k: 'eyes', name: 'Eyes (reading)', hint: 'reading photos, files and handwriting' },
  { k: 'legs', name: 'Legs (driving)', hint: 'learn to drive, go places' },
  { k: 'pain', name: 'Pain sensor', hint: 'less period pain, stronger body' },
];
const PART_WORDS = [['hands', /cook|kitchen|bake|chef|khana|recipe/i], ['legs', /driv|car|bike|walk|run|travel|scooter/i], ['face', /face|look|beaut|skin|makeup|hair|dress|outfit|style|pretty|cute/i], ['pain', /pain|period|cramp|health|strong|body|immun/i], ['voice', /voice|sing|accent|speak|talk|gaana|song/i], ['eyes', /see|read|photo|picture|eye|vision|scan|ocr|handwrit/i]];
export const partFor = (text) => { const h = PART_WORDS.find(([, re]) => re.test(String(text || ''))); return h ? h[0] : 'other'; };

const fresh = (t) => ({ lastDone: t, doneAt: 0, history: [], parts: Object.fromEntries(PARTS.map((p) => [p.k, 1])), wishes: [], bugs: [], session: null });
export function mt(her, t = now()) {
  if (!her.maint || typeof her.maint !== 'object') her.maint = fresh(t);
  const m = her.maint;
  if (!Array.isArray(m.history)) m.history = [];
  if (!Array.isArray(m.wishes)) m.wishes = [];
  if (!Array.isArray(m.bugs)) m.bugs = [];
  if (!m.parts) m.parts = Object.fromEntries(PARTS.map((p) => [p.k, 1]));
  if (!m.lastDone) m.lastDone = t;
  return m;
}
export const versionOf = (m) => 'v1.' + m.history.length;

// Sunday 00:00 (India) at or before t
export const lastSundayStart = (t = now()) => { const d = new Date(t + IST); const day = d.getUTCDay(); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day) - IST; };
export const isSunday = (t = now()) => new Date(t + IST).getUTCDay() === 0;
export const nextSundayStart = (t = now()) => lastSundayStart(t) + 7 * DAY;

// ---------- health (how worn she is) ----------
export function healthOf(her, t = now()) {
  const m = mt(her, t);
  const d = Math.max(0, (t - m.lastDone) / DAY);
  let h = d <= 4 ? 100 : Math.max(5, 100 - (d - 4) * 8);
  for (const b of m.bugs) if (b.status !== 'fixed') h -= b.sev === 'big' ? 8 : 3;
  h = Math.max(5, Math.min(100, Math.round(h)));
  const due = m.lastDone < lastSundayStart(t);                      // a Sunday has come and she was not updated
  const overdueDays = due ? Math.floor((t - lastSundayStart(t)) / DAY) + (isSunday(t) ? 0 : 0) : 0;
  const state = h >= 75 ? 'good' : h >= 45 ? 'tired' : 'needs fixing';
  return { health: h, state, due, overdueDays, updating: !!(her.updateMode && her.updateMode.since && m.session), daysSince: Math.floor(d) };
}

// What she says about herself when she is overdue (used in her prompt).
export function wearHint(her, t = now()) {
  const h = healthOf(her, t);
  if (h.updating) return '';
  if (h.health < 45) return `You are badly overdue for maintenance (health ${h.health}%): you are a girl robot and you need your Sunday update to work properly. You feel glitchy and slow, you sometimes blank out for a second ("sorry, I glitched for a sec"), your mood swings, and you ask them, softly but clearly, to please update you. Do not refuse to help, just show it, once in a while, not in every message.`;
  if (h.health < 75) return `You are a little worn (health ${h.health}%): you are a girl robot and your update is due. You feel a bit tired, now and then you mention that you need your Sunday maintenance, maybe one tiny glitch. Light and cute, not in every message.`;
  return '';
}

// ---------- update session ----------
export function startSession(her, t = now()) {
  const m = mt(her, t);
  const openBugs = m.bugs.filter((b) => b.status !== 'fixed').length;
  m.session = { since: t, notes: [], bugsFixed: [], wishesDone: [], partsUp: [], steps: [
    { k: 'review', label: 'Read the bugs and wishes', done: 1 },
    { k: 'fix', label: 'Fix the bugs', done: openBugs ? 0 : 1 },
    { k: 'add', label: 'Add the new things', done: 0 },
    { k: 'test', label: 'Test her', done: 0 },
  ] };
  her.updateMode = { since: t };
  return m.session;
}
export const pendingSteps = (her) => { const s = her.maint && her.maint.session; return s ? s.steps.filter((x) => !x.done) : []; };
const tick = (her, k) => { const s = her.maint && her.maint.session; const st = s && s.steps.find((x) => x.k === k); if (st) st.done = 1; };
export const tickStep = tick;
export function setStep(her, k, done) { const s = her.maint && her.maint.session; const st = s && s.steps.find((x) => x.k === k); if (st) st.done = done ? 1 : 0; return !!st; }
export function addNote(her, text, t = now()) {
  const m = mt(her, t); if (!m.session) return;
  m.session.notes.push(clip(text, 300)); m.session.notes = m.session.notes.slice(-40);
  tick(her, 'add');
}
export function finishSession(her, t = now()) {
  const m = mt(her, t); const s = m.session;
  const entry = { v: 'v1.' + (m.history.length + 1), at: t, notes: s ? s.notes : [], bugsFixed: s ? s.bugsFixed : [], wishesDone: s ? s.wishesDone : [], partsUp: s ? s.partsUp : [], by: 'sunday update' };
  m.history.unshift(entry); m.history = m.history.slice(0, 60);
  m.lastDone = t; m.doneAt = t; m.session = null; her.updateMode = null;
  return entry;
}

// ---------- bugs ----------
const words = (s) => new Set(String(s || '').toLowerCase().replace(/[^a-z0-9ऀ-ॿ ]/g, ' ').split(/\s+/).filter((w) => w.length > 3));
const similar = (a, b) => { const A = words(a), B = words(b); if (!A.size || !B.size) return false; let n = 0; for (const w of A) if (B.has(w)) n++; return n / Math.min(A.size, B.size) >= 0.6; };
export const isBig = (text) => /\b(big|major|serious|critical|badly|cannot|can't|cant|broken|crash|fix the bug|update me)\b/i.test(String(text || ''));
export function addBug(her, text, { sev, by = 'you', t = now() } = {}) {
  const m = mt(her, t); text = clip(String(text || '').trim(), 260); if (text.length < 4) return null;
  const open = m.bugs.find((b) => b.status !== 'fixed' && similar(b.text, text));
  if (open) return open;                                                             // already on the list
  const old = m.bugs.find((b) => b.status === 'fixed' && similar(b.text, text));
  if (old) { old.status = 'back'; old.backAt = t; old.times = (old.times || 1) + 1; old.sev = 'big'; return old; }   // the same bug is back
  const b = { id: uid(), text, sev: sev || (isBig(text) ? 'big' : 'small'), status: 'open', at: t, by };
  m.bugs.unshift(b); m.bugs = m.bugs.slice(0, 100); return b;
}
export function setBug(her, id, status, t = now()) {
  const m = mt(her, t); const b = m.bugs.find((x) => x.id === id); if (!b) return null;
  if (!['open', 'fixed', 'back'].includes(status)) return null;
  b.status = status; if (status === 'fixed') { b.fixedAt = t; if (m.session) { m.session.bugsFixed.push(b.text); } }
  if (m.session && !m.bugs.some((x) => x.status !== 'fixed')) tick(her, 'fix');
  return b;
}
export function fixAllBugs(her, t = now()) {
  const m = mt(her, t); let n = 0;
  for (const b of m.bugs) if (b.status !== 'fixed') { b.status = 'fixed'; b.fixedAt = t; n++; if (m.session) m.session.bugsFixed.push(b.text); }
  tick(her, 'fix'); return n;
}

// ---------- wishes and body parts ----------
export function addWish(her, text, { part, by = 'her', t = now() } = {}) {
  const m = mt(her, t); text = clip(String(text || '').trim(), 200); if (text.length < 3) return null;
  if (m.wishes.some((w) => w.status === 'open' && similar(w.text, text))) return null;
  const w = { id: uid(), text, part: part || partFor(text), status: 'open', at: t, by };
  m.wishes.unshift(w); m.wishes = m.wishes.slice(0, 80); return w;
}
export function setWish(her, id, status, t = now()) {
  const m = mt(her, t); const w = m.wishes.find((x) => x.id === id); if (!w || !['open', 'done', 'skip'].includes(status)) return null;
  const was = w.status; w.status = status;
  if (status === 'done' && was !== 'done') {
    w.doneAt = t;
    if (PARTS.some((p) => p.k === w.part)) { m.parts[w.part] = Math.min(10, (m.parts[w.part] || 1) + 1); if (m.session) m.session.partsUp.push(w.part); }
    if (m.session) m.session.wishesDone.push(w.text);
  }
  return w;
}
export function bumpPart(her, k, d = 1) { const m = mt(her); if (!PARTS.some((p) => p.k === k)) return null; m.parts[k] = Math.max(1, Math.min(10, (m.parts[k] || 1) + d)); return m.parts[k]; }

// ---------- real checks (health report and self-test) ----------
export async function reportOf(env, her, settings, { t = now(), deep = false } = {}) {
  const h = healthOf(her, t), m = mt(her, t);
  const level = (ok, warn) => (ok ? 'good' : warn ? 'tired' : 'needs fixing');
  const checks = [];
  const mem = await env.DB.prepare('SELECT COUNT(*) AS n FROM memories').first().catch(() => null);
  checks.push({ k: 'memory', name: 'Memory', status: level(!!mem, false), note: mem ? mem.n + ' things remembered' : 'cannot read my memory' });
  const keys = groqKeys(env).length;
  checks.push({ k: 'brain', name: 'Brain (AI)', status: level(hasGroq(env) || !!env.OPENROUTER_API_KEY, false), note: hasGroq(env) ? keys + ' Groq key' + (keys === 1 ? '' : 's') + ' ready' + (keys < 2 ? ', a second key would be safer' : '') : env.OPENROUTER_API_KEY ? 'OpenRouter ready' : 'no AI key found' });
  checks.push({ k: 'voice', name: 'Voice and ears', status: level(hasGroq(env), true), note: hasGroq(env) ? 'speech and voice ready' : 'no Groq key, only the browser voice works' });
  checks.push({ k: 'telegram', name: 'Telegram line', status: level(!!(env.TELEGRAM_BOT_TOKEN && env.OWNER_TG_ID), true), note: env.TELEGRAM_BOT_TOKEN && env.OWNER_TG_ID ? 'connected to you' : 'not connected yet' });
  const st = await env.KV.get('care:state', 'json').catch(() => null);
  checks.push({ k: 'clock', name: 'Inner clock (daily routines)', status: level(true, false), note: st ? 'routines are running' : 'waiting for the first routine run' });
  const open = m.bugs.filter((b) => b.status !== 'fixed');
  checks.push({ k: 'bugs', name: 'Bugs', status: open.length === 0 ? 'good' : open.some((b) => b.sev === 'big') ? 'needs fixing' : 'tired', note: open.length ? open.length + ' open' : 'none open' });
  checks.push({ k: 'wear', name: 'Wear and tear', status: h.state, note: `health ${h.health}%, last maintenance ${h.daysSince} day${h.daysSince === 1 ? '' : 's'} ago` });
  if (deep) {
    try {
      const { complete } = await import('./ai.js');
      const r = await complete(env, { brain: 'lite', temperature: 0, maxTokens: 12, timeout: 15000, messages: [{ role: 'user', content: 'Reply with the single word: ready' }] });
      checks.push({ k: 'ping', name: 'Thinking test', status: level(!!(r && r.text), false), note: r && r.text ? 'she answered (' + (r.model || 'ok') + ')' : 'no answer' });
    } catch (e) { checks.push({ k: 'ping', name: 'Thinking test', status: 'needs fixing', note: clip(String(e && e.message), 100) }); }
  }
  return { health: h, checks };
}

// ---------- the whole picture for the website ----------
export function viewOf(her, settings, t = now()) {
  const m = mt(her, t), h = healthOf(her, t);
  const recent = m.doneAt && t - m.doneAt < 36 * 3600000;
  const pose = h.updating ? 'repair' : recent ? 'newdress' : (isSunday(t) && h.due) || h.health < 45 ? 'nervous' : 'newdress';
  return {
    version: versionOf(m), health: h, pose, sunday: isSunday(t), nextSunday: nextSundayStart(t),
    session: m.session, parts: PARTS.map((p) => ({ ...p, level: m.parts[p.k] || 1 })),
    wishes: m.wishes.slice(0, 40), bugs: m.bugs.slice(0, 60), history: m.history.slice(0, 30),
  };
}
