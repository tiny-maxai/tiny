// Outfit of the day: every morning she picks one of the outfit pictures (public/images/outfits/outfit-1.webp, outfit-2.webp, ...)
// and says a line about it. Add as many pictures as you like, numbered from 1 with no gaps.
import { now, istDate, clip } from './util.js';
import { complete } from './ai.js';
import { moodKindNow } from './tinymood.js';
import { periodNow } from './period.js';
import { sendPhoto } from './telegram.js';
import { getOcc, tagOf } from './occasion.js';
import { getWeather } from './ambient.js';

const h32 = (str) => { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
export const outfitPath = (n) => `/images/outfits/outfit-${n}.webp`;

export async function outfitCount(env) {
  const c = await env.KV.get('outfit:count', 'json').catch(() => null);
  if (c && now() - c.at < (c.n ? 3600000 : 300000)) return c.n;
  let n = 0;
  for (let i = 1; i <= 60; i++) {
    const r = await env.ASSETS.fetch(new Request('https://assets.local' + outfitPath(i), { method: 'HEAD' })).catch(() => null);
    if (!r || !r.ok || /text\/html/.test(r.headers.get('content-type') || '')) break;
    n = i;
  }
  await env.KV.put('outfit:count', JSON.stringify({ n, at: now() })).catch(() => null);
  return n;
}

export async function outfitToday(env, settings, { t = now(), force = false } = {}) {
  const count = await outfitCount(env);
  if (!count) return null;
  const today = istDate(t);
  const cur = await env.KV.get('outfit:today', 'json').catch(() => null);
  if (cur && cur.date === today && !force && cur.n <= count) return cur;
  const occ = await getOcc(env), pr0 = periodNow(settings);
  let pool = Array.from({ length: count }, (_, i) => i + 1).filter((i) => !['garba', 'lehenga', 'saree', 'party', 'night'].includes(tagOf(occ, i)));   // festive outfits only for festivals
  if (pr0 && pr0.phase === 'period') { const cozy = pool.filter((i) => tagOf(occ, i) === 'comfy'); if (cozy.length) pool = cozy; }
  if (!pool.length) pool = Array.from({ length: count }, (_, i) => i + 1);
  if (!(pr0 && pr0.phase === 'period')) {            // the morning outfit follows the weather: rain, cold, heat, otherwise coffee time
    const wx = await getWeather(env, settings).catch(() => null);
    const want = wx && wx.rain ? 'rainy' : wx && wx.temp <= 14 ? 'winter' : wx && wx.temp >= 35 ? 'summer' : h32(today + ':c') % 3 !== 0 ? 'coffee' : '';
    const w = want ? pool.filter((i) => tagOf(occ, i) === want) : [];
    if (w.length) pool = w;
  }
  let n = pool[h32(today + (force ? ':' + t : '')) % pool.length];
  if (cur && cur.n === n && pool.length > 1) n = pool[(pool.indexOf(n) + 1) % pool.length];                         // never the same two times in a row
  const name = (settings.persona && settings.persona.name) || 'Tiny';
  let line = '';
  try {
    const mood = await moodKindNow(env, settings).catch(() => 'normal'), pr = periodNow(settings);
    const r = await complete(env, { brain: 'lite', temperature: 0.9, maxTokens: 70, timeout: 12000, messages: [
      { role: 'system', content: `You are ${name}, a cute girl. You just picked your outfit for today and you show it. Say ONE short, happy sentence about it, like a girl sending a photo ("today I am wearing this, how is it?"). Do not describe clothes in detail (you cannot be sure what it looks like). ${settings.persona && settings.persona.language === 'english' ? 'English.' : 'Hinglish in Roman letters.'} Your mood: ${mood}.${pr && pr.phase === 'period' ? ' You are on your period, so you picked something comfy.' : ''} The person you show it to is a boy. Plain text, at most one emoji.` },
      { role: 'user', content: 'Show today\'s outfit.' },
    ] });
    line = clip(String(r.text || '').trim(), 160);
  } catch { /* fallback below */ }
  if (!line) line = 'Today I am wearing this. How is it?';
  const out = { date: today, n, line };
  await env.KV.put('outfit:today', JSON.stringify(out)).catch(() => null);
  return out;
}

export async function sendOutfitToOwner(env, o) {
  if (!o || !env.OWNER_TG_ID || !env.TELEGRAM_BOT_TOKEN) return false;
  const origin = await env.KV.get('origin').catch(() => null);
  if (!origin) return false;
  return sendPhoto(env, env.OWNER_TG_ID, origin + outfitPath(o.n), o.line);
}
