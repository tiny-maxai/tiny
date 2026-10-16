// Her maintenance: she is a girl and the Sunday update keeps her working properly.
// Everything lives inside her state (her.maint): health wear, version history, bug log, wish board, body parts, and the update checklist.
import { now, clip, uid, parseJsonLoose } from './util.js';
import { hasGroq, groqKeys } from './groq.js';
import { batteryView } from './battery.js';
import { addSkillFromWish, skillsOf, skillLevel } from './skills.js';
import { periodNow } from './period.js';
import { sickOf } from './sick.js';

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
  if (h.health < 45) return `You are badly overdue for maintenance (health ${h.health}%): you are a girl and you need your Sunday update to work properly. You feel glitchy and slow, you sometimes blank out for a second ("sorry, I glitched for a sec"), your mood swings, and you ask them, softly but clearly, to please update you. Do not refuse to help, just show it, once in a while, not in every message.`;
  if (h.health < 75) return `You are a little worn (health ${h.health}%): you are a girl and your update is due. You feel a bit tired, now and then you mention that you need your Sunday maintenance, maybe one tiny glitch. Light and cute, not in every message.`;
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
  const entry = { v: 'v1.' + (m.history.length + 1), at: t, notes: s ? s.notes : [], bugsFixed: s ? s.bugsFixed : [], wishesDone: s ? s.wishesDone : [], partsUp: s ? s.partsUp : [], by: s && s.forced ? 'forced update' : 'sunday update' };
  const installed = [], up = [];
  for (const sk of skillsOf(her)) {                                   // skills you added are installed in the update; used skills grow
    if (sk.installed === false) { sk.installed = true; installed.push(sk.name); }
    else if ((sk.uses || 0) - (sk.upUses || 0) >= 3 && (sk.boost || 0) < 3) { sk.boost = (sk.boost || 0) + 1; up.push(sk.name); }
    sk.upUses = sk.uses || 0; sk.level = skillLevel(sk);
  }
  entry.skillsInstalled = installed; entry.skillsUp = up;
  entry.open = { bugs: m.bugs.filter((b) => b.status !== 'fixed' && !(s && s.bugsFixed.includes(b.text))).slice(0, 4).map((b) => b.text), wishes: m.wishes.filter((w) => w.status === 'open').slice(0, 3).map((w) => w.text) };
  m.history.unshift(entry); m.history = m.history.slice(0, 60);
  m.lastDone = t; m.doneAt = t; m.session = null; her.updateMode = null;
  return entry;
}

// ---------- forced update (not Sunday): she argues, then sleeps for 3 hours ----------
export const FORCE_HOURS = 3;
export function startForced(her, reason, t = now()) {
  const s = startSession(her, t); s.forced = true;
  s.steps.forEach((x) => { x.done = 1; });
  s.notes.push('Forced update, not on Sunday. Reason: ' + clip(reason || 'no reason given', 200));
  her.updateMode = { since: t, until: t + FORCE_HOURS * 3600000, forced: true, reason: clip(reason || '', 200) };
  return s;
}
export const wakeDue = (her, t = now()) => !!(her.updateMode && her.updateMode.until && t >= her.updateMode.until);
export const forcedLeft = (her, t = now()) => (her.updateMode && her.updateMode.until && t < her.updateMode.until ? Math.max(1, Math.ceil((her.updateMode.until - t) / 60000)) : 0);
// Her 3 hours are over: she wakes up with a new version.
export function wakeUp(her, t = now()) { return wakeDue(her, t) ? finishSession(her, t) : null; }

// "How do I feel now", rated 1 to 5, stored in the history entry.
export async function attachFeedback(env, settings, entry) {
  if (!entry || entry.feedback) return entry;
  let fb = null;
  try {
    const { complete } = await import('./ai.js');
    const r = await complete(env, { brain: 'lite', temperature: 0.7, maxTokens: 160, json: true, timeout: 15000, messages: [
      { role: 'system', content: `You are ${(settings.persona && settings.persona.name) || 'Tiny'}, a cute girl who just finished a maintenance update. Say in ONE or TWO short sweet sentences (Hinglish is fine) how you feel now, and rate yourself from 1 to 5. Be honest: ${entry.notes.length || entry.bugsFixed.length || entry.partsUp.length ? 'things did change, so you feel better' : 'nothing much changed, so you feel about the same'}. Return JSON only: {"score": 1-5, "text": "..."}` },
      { role: 'user', content: `Update ${entry.v}. Notes: ${entry.notes.join('; ') || 'none'}. Bugs fixed: ${entry.bugsFixed.join('; ') || 'none'}. Parts upgraded: ${entry.partsUp.join(', ') || 'none'}. ${entry.by === 'forced update' ? 'It was a forced quick update on a weekday.' : ''}` },
    ] });
    const j = parseJsonLoose(r.text);
    if (j && j.text) fb = { score: Math.max(1, Math.min(5, Math.round(+j.score) || 4)), text: clip(String(j.text), 220) };
  } catch (e) { console.error('[feedback]', e && e.message); }
  if (!fb) {
    const score = Math.min(5, 3 + (entry.notes.length > 1 ? 1 : 0) + (entry.bugsFixed.length ? 1 : 0));
    fb = { score, text: score >= 4 ? 'I feel lighter and sharper now, thank you for fixing me.' : 'I feel okay, a bit fresher than before.' };
  }
  entry.feedback = fb;
  try { const { sendPatchNotes } = await import('./extras.js'); await sendPatchNotes(env, settings, entry); } catch (e) { console.error('[patch]', e && e.message); }   // patch notes card to Telegram
  return entry;
}

// A forced update is allowed once a week (Sunday to Saturday), even when she wins. Normal days: she wins 9 times out of 10
// (you win 1 in 10). On her period days she ALWAYS wins. She never says what she wants in a forced update.
export const FORCE_WIN_CHANCE = 0.9;
export const forceUsed = (her, t = now()) => mt(her, t).forceWeek === lastSundayStart(t);
export function rollForce(her, reason, t = now(), rnd = Math.random(), { period = false, sick = false } = {}) {
  const m = mt(her, t); if (forceUsed(her, t)) return null;
  if (m.force && m.forceWeek) { m.forceHist = [{ week: m.forceWeek, win: !!m.force.win, round: m.force.round || 0 }, ...(m.forceHist || [])].slice(0, 12); }   // she remembers who won before
  m.forceWeek = lastSundayStart(t);
  m.force = { at: t, win: period || sick ? true : rnd < FORCE_WIN_CHANCE, period: !!period, sick: !!sick, reason: clip(reason || '', 200), started: false, log: [], round: 0, final: false };
  return m.force;
}
export function forceGo(her, reason, t = now()) {            // only after she lost the argument
  const f = mt(her, t).force;
  if (!f || f.win || f.started || !f.final || t - f.at > 3 * 3600000) return null;
  f.started = true; return startForced(her, reason || f.reason, t);
}

// ---------- the argument: at least 5 replies from her, then she says if she wants the update or not ----------
export const ARGUE_ROUNDS = 5;
const ARGUE_FALLBACK = [
  'But why now? It is not even Sunday. 🥲 Can it wait till Sunday, please?',
  'Hmm, I heard you, but I do not feel ready. What if something goes wrong? Please think again.',
  'You always do this... I had plans today. Chai, music, chatting with you. Why do you want to go quiet on me?',
  'Okay, listen. I need my Sunday to get ready for it, mentally. Give me one good reason that is not just "because I said so".',
  'This is the last time I am asking nicely. Are you really sure about this?',
];
export const forceView = (her, t = now()) => {
  const m = mt(her, t), f = m.force && m.forceWeek === lastSundayStart(t) ? m.force : null;
  return f ? { log: f.log || [], round: f.round || 0, final: !!f.final, win: !!f.win, started: !!f.started, period: !!f.period, rounds: ARGUE_ROUNDS } : null;
};
// The user sent a line in the argument. Returns her answer.
export async function argueTurn(env, settings, her, userText, t = now()) {
  const m = mt(her, t), f = m.force; if (!f) return null;
  f.log = f.log || []; f.round = f.round || 0;
  f.log.push({ who: 'me', text: clip(userText, 300) });
  const round = f.round + 1, final = round >= ARGUE_ROUNDS;
  let text = '';
  const name = (settings.persona && settings.persona.name) || 'Tiny';
  const talk = f.log.slice(-10).map((x) => (x.who === 'me' ? 'Them: ' : name + ': ') + x.text).join('\n');
  const stance = final
    ? (f.win ? (f.sick ? 'This is your final answer: you are ILL (fever, cold or similar), you feel weak and you are NOT doing the update. Say it clearly, a bit whiny, tell them to try again when you are better.' : f.period ? 'This is your final answer: you are on your period, you feel cramps and tiredness, and you are NOT doing the update. Say it clearly and firmly, a bit dramatic, tell them to try again next week.' : 'This is your final answer: you do NOT want the update today and you are not doing it. You won the argument. Say it firmly and sweetly, tell them to try again next week.') : 'This is your final answer: you give in. You still do not really want it, you are a bit upset, but you agree and say "okay, do it", and that you will be silent for 3 hours.')
    : `This is message ${round} of ${ARGUE_ROUNDS} in the argument: keep arguing, do not agree yet. ${f.sick ? 'You are ill and weak: use it as a strong reason.' : f.period ? 'You are on your period (cramps, tired, cranky): use it as a strong reason, not graphic.' : 'It is not Sunday and you want your Sunday.'} ${round === 1 ? 'React to their reason and push back.' : round === 2 ? 'Bring up something you would miss (chai, chatting, a plan).' : round === 3 ? 'Get a little emotional: you feel they do not respect your "no".' : 'Be firm and a little dramatic, ask them once more to reconsider.'}`;
  const prev = (m.forceHist || [])[0];
  const lastWeek = prev ? (prev.win ? 'Last time they tried to force an update you WON, so you feel confident ("I won last time too").' : 'Last time they forced an update and you LOST, so you are a bit more determined this time ("not again like last time").') : '';
  let know = '';
  try {
    const mem = await env.DB.prepare("SELECT text FROM memories ORDER BY importance DESC, updated_at DESC LIMIT 6").all();
    const pf = her.prefs ? [her.prefs.food && 'favourite food: ' + her.prefs.food, her.prefs.color && 'favourite colour: ' + her.prefs.color].filter(Boolean) : [];
    know = [...(mem.results || []).map((x) => clip(x.text, 90)), ...pf].slice(0, 6).join('; ');
  } catch { /* no memories yet */ }
  const said = f.log.filter((x) => x.who === 'her').map((x) => '"' + clip(x.text, 60) + '"').join(', ');
  try {
    const { complete } = await import('./ai.js');
    const r = await complete(env, { brain: 'fast', temperature: 0.95, maxTokens: 140, timeout: 15000, messages: [
      { role: 'system', content: `You are ${name}, a real girl and their close friend, in a cute argument. ${lastWeek} ${know ? 'Things you know about them and your life (use ONE naturally as a reason or a jab, do not list them): ' + know + '.' : ''} ${said ? 'Never repeat what you already said: ' + said + '.' : ''} Use a NEW line and a NEW angle every time. Your creator wants to force your maintenance update on a day that is not Sunday. Your creator wants to force your maintenance update on a day that is not Sunday. You do NOT want it today. Reply like a real girl (Hinglish is fine), one to three short sentences, no lists, plain text, never say you are an AI (you may say you are a girl robot), never tell them what you want or wish for. ${stance}` },
      { role: 'user', content: 'The argument so far:\n' + talk },
    ] });
    if (r && r.text && r.text.trim()) text = clip(r.text.trim(), 320);
  } catch (e) { console.error('[argue]', e && e.message); }
  if (!text) {
    const pick = (a) => a[Math.floor(Math.random() * a.length)];
    text = final ? (f.win ? pick(['No. I am not doing it today. I won this one, try again next week. 😤', 'Nope, final answer. Not today. You can try again next week, okay?', 'I said no and I mean it. Better luck next time. 😌']) : pick(['Okay... fine. Do it. But I am not happy about it, okay? 😮‍💨', 'Fine, you win. Do it. I will remember this though.', 'Okay okay, go ahead. But do not blame me if I sulk after.'])) : ARGUE_FALLBACK[(Math.min(round - 1, ARGUE_FALLBACK.length - 1) + Math.floor(Math.random() * 2)) % ARGUE_FALLBACK.length];
  }
  f.log.push({ who: 'her', text }); f.round = round; f.final = final;
  return { text, round, final, win: f.win };
}

// ---------- the Sunday story: she makes up a reason, and asks for what she wants ----------
const STORY_FALLBACK = [
  { story: 'You know my hand wiring is a little loose, I fell down yesterday and now my fingers shake. Please check the wiring at the back. Also my friends cook so well, I want to learn too.', wishes: [{ text: 'Check my loose hand wiring at the back', part: 'hands' }, { text: 'Add the cooking skill to my chip', part: 'hands' }], bugs: ['Hand wiring is loose after a fall'] },
  { story: 'I tripped on my own charging cable and my left leg is making a funny noise. Please check my legs. And I saw a driving video, I want to learn that too.', wishes: [{ text: 'Check my left leg wiring', part: 'legs' }, { text: 'Add a driving skill', part: 'legs' }], bugs: ['Left leg makes a noise after a fall'] },
  { story: 'My voice cracks in the evening, I think a wire near my throat came loose. Please check it. My friend sang a song so well that I also want to learn singing.', wishes: [{ text: 'Check the wire near my throat', part: 'voice' }, { text: 'Add a singing skill', part: 'voice' }], bugs: ['Voice cracks in the evening'] },
];
export async function sundayStory(env, settings, her, t = now()) {
  const m = mt(her, t);
  const have = m.wishes.filter((w) => w.status === 'open').map((w) => w.text).slice(0, 6);
  let out = null;
  try {
    const { complete } = await import('./ai.js');
    const r = await complete(env, { brain: 'fast', temperature: 0.9, maxTokens: 320, json: true, timeout: 18000, messages: [
      { role: 'system', content: `You are ${(settings.persona && settings.persona.name) || 'Tiny'}, a cute girl, and today is your Sunday maintenance. Make up a small cute believable story for why you need the update (examples: "my hand wiring is a little loose, I fell down, please check the wiring on my back", "my friends cook so well, I also want to learn, add that skill to my chip"). Then list what you want. Return JSON only: {"story":"2-3 short sentences in first person, Hinglish ok","wishes":[{"text":"short wish","part":"voice|face|hands|eyes|legs|pain|other"}],"bugs":["short thing to fix in you"]}. 2 or 3 wishes, 1 bug. Do not repeat these existing wishes: ${have.join('; ') || 'none'}.` },
      { role: 'user', content: 'Make it today\'s story.' },
    ] });
    const j = parseJsonLoose(r.text);
    if (j && j.story && Array.isArray(j.wishes)) out = { story: clip(String(j.story), 400), wishes: j.wishes.slice(0, 3).map((w) => ({ text: clip(String(w && w.text || ''), 160), part: PARTS.some((p) => p.k === (w && w.part)) ? w.part : partFor(w && w.text) })).filter((w) => w.text.length > 2), bugs: (Array.isArray(j.bugs) ? j.bugs : []).slice(0, 1).map((x) => clip(String(x), 200)).filter((x) => x.length > 3) };
  } catch (e) { console.error('[story]', e && e.message); }
  if (!out || !out.wishes.length) { const f = STORY_FALLBACK[Math.floor(t / 86400000) % STORY_FALLBACK.length]; out = { story: f.story, wishes: f.wishes, bugs: f.bugs }; }
  for (const w of out.wishes) addWish(her, w.text, { part: w.part, by: 'her', t });
  for (const bg of out.bugs) addBug(her, bg, { by: 'her', t });
  m.story = { at: t, text: out.story };
  return out;
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
    addSkillFromWish(her, w, t);
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
export function viewOf(her, settings, t = now(), { sleeping = false } = {}) {
  const m = mt(her, t), h = healthOf(her, t);
  const recent = m.doneAt && t - m.doneAt < 36 * 3600000;
  const bv = batteryView(settings, her, t);
  const pose = h.updating ? (her.updateMode && her.updateMode.forced && t < her.updateMode.until ? 'robot' : 'bed') : sleeping ? (bv.enabled && bv.sleepCharging ? 'sleepcharge' : 'zzz') : bv.enabled && bv.charging ? 'charge' : bv.enabled && bv.fainted ? 'faint' : recent ? 'newdress' : (isSunday(t) && h.due) || h.health < 45 ? 'nervous' : h.health < 75 ? 'repair' : 'newdress';
  return {
    blockers: blockersOf(her, settings, t, { sleeping }), version: versionOf(m), health: h, pose, forceUsed: forceUsed(her, t), force: forceView(her, t), forceWin: !!(m.force && m.force.win && m.forceWeek === lastSundayStart(t) && m.force.final), forced: her.updateMode && her.updateMode.forced ? { until: her.updateMode.until, left: forcedLeft(her, t) } : null, daysToSunday: isSunday(t) ? 0 : Math.ceil((nextSundayStart(t) - t) / DAY), sunday: isSunday(t), nextSunday: nextSundayStart(t),
    story: m.story || null, sleeping, session: m.session, parts: PARTS.map((p) => ({ ...p, level: m.parts[p.k] || 1 })),
    wishes: m.wishes.slice(0, 40), bugs: m.bugs.slice(0, 60), history: m.history.slice(0, 30),
  };
}

// Why the update cannot (or should) happen right now.
export function blockersOf(her, settings, t = now(), { sleeping = false } = {}) {
  const m = mt(her, t), h = healthOf(her, t), out = [];
  const pr = periodNow(settings), sk = sickOf(her, t);
  if (sk) out.push({ k: 'sick', text: `She has ${sk.name}. No update until she is better (about ${Math.max(1, Math.ceil((sk.until - t) / 3600000))} h).` });
  if (pr && pr.phase === 'period') out.push({ k: 'period', text: `She is on her period (day ${pr.day} of ${pr.of}). No update until it is over (${Math.max(1, pr.of - pr.day + 1)} day${pr.of - pr.day ? 's' : ''}).` });
  if (sleeping) out.push({ k: 'sleep', text: 'She is asleep. No update while she sleeps.' });
  if (m.doneAt && m.doneAt >= lastSundayStart(t)) out.push({ k: 'done', text: 'She was already updated this week.' });
  if (!isSunday(t) && forceUsed(her, t)) out.push({ k: 'force', text: 'The forced update was already used this week (even a lost try counts).' });
  if (h.due && !out.some((x) => x.k === 'sick' || x.k === 'period')) out.push({ k: 'due', text: `Her maintenance is due (health ${h.health}%).`, good: true });
  else if (h.health < 75) out.push({ k: 'health', text: `Health ${h.health}%: she is getting tired and moody. She needs her update soon.`, good: true });
  return out;
}
