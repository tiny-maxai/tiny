// Festivals and her birthday: on those days she dresses up. Her birthday is 8 February (you can change it).
// Festivals: you tell her (chat: "today is Diwali", the She page, or /festival); on the day she asks what she should wear.
// Birthday: she picks a saree by herself. The outfit decides her mood: garba = dancing and energy, saree = shy and elegant.
import { now, istDate, clip, uid } from './util.js';
import { sendPhoto } from './telegram.js';

const KEY = 'occ:state';
export const TAGS = ['garba', 'saree', 'party', 'casual', 'comfy'];
const DEFAULT_TAGS = { 1: 'garba', 2: 'saree' };
export const FEST_RE = /\b(diwali|deepavali|holi|navratri|garba|dandiya|dussehra|dasara|eid|raksha\s*bandhan|rakhi|ganesh\s*chaturthi|janmashtami|christmas|new\s*year|lohri|pongal|onam|durga\s*puja|karwa\s*chauth|makar\s*sankranti|baisakhi|ugadi|republic\s*day|independence\s*day)\b/i;

export async function getOcc(env) {
  const o = (await env.KV.get(KEY, 'json').catch(() => null)) || {};
  return { birthday: /^\d{2}-\d{2}$/.test(o.birthday || '') ? o.birthday : '02-08', festivals: Array.isArray(o.festivals) ? o.festivals : [], tags: { ...DEFAULT_TAGS, ...(o.tags || {}) }, wear: o.wear || null, doneDay: o.doneDay || '' };
}
export const putOcc = (env, o) => env.KV.put(KEY, JSON.stringify(o)).catch(() => null);
export const tagOf = (occ, n) => occ.tags[n] || 'casual';

export function addFestival(occ, name, date, yearly = true) {
  name = clip(String(name || '').trim(), 40);
  if (name.length < 2 || !/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return null;
  const f = { id: uid(), name, date, yearly: !!yearly };
  if (occ.festivals.some((x) => x.name.toLowerCase() === name.toLowerCase() && x.date === date)) return null;
  occ.festivals = [...occ.festivals, f].slice(-40); return f;
}
// What is special on this date (India)?
export function todayOccasions(occ, t = now()) {
  const d = istDate(t), md = d.slice(5), out = [];
  if (occ.birthday === md) out.push({ kind: 'birthday', name: 'her birthday' });
  for (const f of occ.festivals) if (f.date === d || (f.yearly && f.date.slice(5) === md)) out.push({ kind: 'festival', name: f.name, id: f.id });
  return out;
}
export function upcoming(occ, t = now()) {
  const today = istDate(t), y = +today.slice(0, 4), items = [];
  const next = (md) => { let d = `${y}-${md}`; if (d < today) d = `${y + 1}-${md}`; return d; };
  const days = (d) => Math.round((Date.parse(d + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 86400000);
  { const d = next(occ.birthday); items.push({ name: 'Her birthday', date: d, days: days(d), kind: 'birthday' }); }
  for (const f of occ.festivals) { const d = f.yearly ? next(f.date.slice(5)) : f.date; if (d >= today) items.push({ id: f.id, name: f.name, date: d, days: days(d), kind: 'festival', yearly: f.yearly }); }
  return items.sort((a, b) => a.days - b.days).slice(0, 12);
}

// A day to tell her about in chat: "today is Diwali", "kal Holi hai", "tomorrow is Navratri".
export function detectFestival(text, t = now()) {
  const s = String(text || '');
  const m = FEST_RE.exec(s); if (!m || s.length > 200) return null;
  const when = /\b(today|aaj)\b/i.test(s) ? 0 : /\b(tomorrow|kal)\b/i.test(s) ? 1 : null;
  if (when === null || !/\b(is|hai|festival|tyohar|celebrat\w*|manao|mana)\b/i.test(s)) return null;
  const name = m[1].replace(/\s+/g, ' ').replace(/^./, (c) => c.toUpperCase());
  return { name, date: istDate(t + when * 86400000), today: when === 0 };
}
// "garba" / "saree" / ... in a reply to "what should I wear?"
const TAGWORDS = { garba: /\b(garba|dandiya|chaniya|choli|lehenga)\b/i, saree: /\b(saree|sari|sadi)\b/i, party: /\b(party|gown|dress)\b/i, casual: /\b(casual|jeans|top)\b/i, comfy: /\b(comfy|comfortable|pajama|hoodie)\b/i };
export function tagFromText(text) { for (const k of TAGS) if (TAGWORDS[k].test(text)) return k; return null; }
export function outfitFor(occ, count, tag, seed = 0) {
  const ns = []; for (let i = 1; i <= count; i++) if (tagOf(occ, i) === tag) ns.push(i);
  return ns.length ? ns[Math.floor(Math.abs(seed)) % ns.length] : null;
}

// Writes today's outfit (the same record the She strip and the morning message use).
export async function setTodayOutfit(env, n, line) {
  const out = { date: istDate(), n, line: clip(line, 160) };
  await env.KV.put('outfit:today', JSON.stringify(out)).catch(() => null);
  return out;
}
export async function sendOutfitPhoto(env, o) {
  if (!o || !env.OWNER_TG_ID || !env.TELEGRAM_BOT_TOKEN) return false;
  const origin = await env.KV.get('origin').catch(() => null);
  if (!origin) return false;
  return sendPhoto(env, env.OWNER_TG_ID, origin + `/images/outfits/outfit-${o.n}.webp`, o.line).catch(() => false);
}

// How she feels in what she wears.
export const MOOD_LINE = {
  garba: 'You are wearing your garba chaniya choli with dandiya sticks: you feel full of energy, happy, bouncy and playful. You want to dance, you tease, you hum garba songs ("dhol baje!"), you are loud-happy and cheerful.',
  saree: 'You are wearing your saree: you feel shy, graceful and elegant. You speak softly, blush, smile a lot, get a little shy at compliments, and move and talk slowly like a lady.',
  party: 'You are dressed up for a party: confident, glowing and a little bold-playful.',
  casual: 'You are in your casual comfy look: relaxed and natural.',
  comfy: 'You are in your comfiest clothes: cosy, lazy and soft.',
};
export function occasionHint(occ, outfit, t = now()) {
  const list = todayOccasions(occ, t);
  const tag = outfit && outfit.date === istDate(t) ? tagOf(occ, outfit.n) : null;
  const parts = [];
  for (const o of list) parts.push(o.kind === 'birthday' ? 'TODAY IS YOUR BIRTHDAY (8 February): you are super excited and a little spoiled, you love wishes and ask for a small gift or a treat. Never forget it is your day.' : `Today is the festival ${o.name}: you feel festive and happy, and you mention it naturally.`);
  if (tag && MOOD_LINE[tag] && (list.length || tag === 'garba' || tag === 'saree')) parts.push(MOOD_LINE[tag]);
  if (occ.wear && occ.wear.date === istDate(t) && !occ.wear.n) parts.push(`You asked them what you should wear for ${occ.wear.name} and they have not told you yet. If they answer, take their choice happily.`);
  return parts.join(' ');
}

// The morning of a special day (called from the daily care run). Returns what to do.
export async function occasionDay(env, occ, count, t = now()) {
  const today = istDate(t), list = todayOccasions(occ, t);
  if (!list.length || occ.doneDay === today) return null;
  occ.doneDay = today;
  const bday = list.find((x) => x.kind === 'birthday'), fest = list.find((x) => x.kind === 'festival');
  if (bday && count) {
    const n = outfitFor(occ, count, 'saree', t / 86400000) || outfitFor(occ, count, 'party', t / 86400000) || 1;
    occ.wear = { date: today, name: 'her birthday', n, asked: true };
    await putOcc(env, occ);
    return { type: 'birthday', n, tag: tagOf(occ, n), name: bday.name };
  }
  if (fest) {
    occ.wear = { date: today, name: fest.name, n: null, asked: true };
    await putOcc(env, occ);
    return { type: 'festival', name: fest.name, options: Array.from({ length: count }, (_, i) => ({ n: i + 1, tag: tagOf(occ, i + 1) })).filter((x) => ['garba', 'saree', 'party'].includes(x.tag)) };
  }
  await putOcc(env, occ);
  return null;
}
// They chose (button or words): she puts it on.
export async function chooseWear(env, occ, n, { send = true, name } = {}) {
  const today = istDate();
  const o = await setTodayOutfit(env, n, `${name || (occ.wear && occ.wear.name) || 'Today'}: this is what I am wearing, how is it?`);
  occ.wear = { ...(occ.wear || { date: today, name: name || 'today', asked: true }), date: today, n };
  await putOcc(env, occ);
  if (send) await sendOutfitPhoto(env, o);
  return o;
}

// Called for every chat message: learns "today is Diwali", takes "garba"/"saree" as the answer, returns a hint for her prompt.
export async function occasionTurn(env, text, { source = 'web', count = 0, t = now() } = {}) {
  const occ = await getOcc(env), today = istDate(t), notes = [];
  const fest = detectFestival(text, t);
  if (fest) {
    addFestival(occ, fest.name, fest.date, true);
    if (fest.today) { occ.wear = { date: today, name: fest.name, n: null, asked: true }; notes.push(`They just told you that today is the festival ${fest.name}. Be excited, and ask what you should wear (garba or a saree?).`); }
    else notes.push(`They told you that ${fest.name} is tomorrow. Be happy about it, say you will ask what to wear that day, and that you will remember it every year.`);
    await putOcc(env, occ);
  }
  if (occ.wear && occ.wear.date === today && !occ.wear.n && !fest) {
    const tg = tagFromText(text);
    if (tg && count) { const n = outfitFor(occ, count, tg, t / 86400000); if (n) { await chooseWear(env, occ, n, { send: source === 'telegram' }); notes.push(`They chose the ${tg} for you and you are putting it on right now (the picture is shown). Take their choice happily and react in your own way.`); } }
  }
  const cur = await env.KV.get('outfit:today', 'json').catch(() => null);
  const h = occasionHint(occ, cur, t);
  return [...notes, h].filter(Boolean).join(' ');
}
