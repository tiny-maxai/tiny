// The world around her: today's weather where you live (Open-Meteo, free, no key) and the weekday.
// Rain makes her clingy and cosy, Monday makes her lazy. The weather is cached so it never slows a reply.
import { now, clip } from './util.js';

const IST = 330 * 60 * 1000;
const RAIN = new Set([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99]);
const WORD = { 0: 'clear sky', 1: 'mostly clear', 2: 'partly cloudy', 3: 'cloudy', 45: 'foggy', 48: 'foggy', 51: 'light drizzle', 53: 'drizzle', 55: 'heavy drizzle', 56: 'freezing drizzle', 57: 'freezing drizzle', 61: 'light rain', 63: 'rain', 65: 'heavy rain', 66: 'freezing rain', 67: 'freezing rain', 71: 'light snow', 73: 'snow', 75: 'heavy snow', 80: 'rain showers', 81: 'rain showers', 82: 'heavy rain showers', 95: 'a thunderstorm', 96: 'a thunderstorm with hail', 99: 'a thunderstorm with hail' };
const DEFAULT_PLACE = { name: 'Sironj', lat: 24.1, lon: 77.69 };      // Sironj, Vidisha district, Madhya Pradesh
let mem = null;                                   // { key, t, v }: per isolate, 10 minutes

async function locate(env, place) {
  const name = clip(String(place || 'Sironj').trim() || 'Sironj', 60), key = 'geo:' + name.toLowerCase();
  if (/^sironj$/i.test(name)) return DEFAULT_PLACE;
  try { const c = await env.KV.get(key, 'json'); if (c && Number.isFinite(c.lat)) return c; } catch { /* look it up */ }
  try {
    const r = await fetch('https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&name=' + encodeURIComponent(name), { signal: AbortSignal.timeout(3500) });
    const d = await r.json(), g = d && d.results && d.results[0];
    if (g) { const v = { name: g.name, lat: g.latitude, lon: g.longitude }; await env.KV.put(key, JSON.stringify(v)).catch(() => {}); return v; }
  } catch { /* fall back */ }
  return /sironj/i.test(name) ? DEFAULT_PLACE : null;
}

export async function getWeather(env, settings) {
  const a = settings && settings.ambient;
  if (!a || !a.enabled) return null;
  const key = String(a.place || 'Sironj').toLowerCase(), t = now();
  if (mem && mem.key === key && t - mem.t < 10 * 60000) return mem.v;
  let kv = null;
  try { kv = await env.KV.get('weather:cur', 'json'); } catch { /* ignore */ }
  if (kv && kv.key === key && t - kv.t < 45 * 60000) { mem = { key, t, v: kv.v }; return kv.v; }
  const loc = await locate(env, a.place);
  if (!loc) return kv && kv.key === key ? kv.v : null;
  try {
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&current=temperature_2m,precipitation,weather_code&timezone=Asia%2FKolkata`, { signal: AbortSignal.timeout(3500) });
    const c = (await r.json()).current;
    if (!c) throw new Error('no data');
    const code = Number(c.weather_code), v = { place: loc.name, temp: Math.round(c.temperature_2m), code, text: WORD[code] || 'clear', rain: RAIN.has(code) || Number(c.precipitation) > 0.1 };
    mem = { key, t, v };
    await env.KV.put('weather:cur', JSON.stringify({ key, t, v })).catch(() => {});
    return v;
  } catch (e) { console.error('[weather]', e && e.message); return kv && kv.key === key ? kv.v : null; }
}

// { on, weather, monday }: what the mood and the prompt use.
export async function getAmbient(env, settings, t = now()) {
  const on = !!(settings && settings.ambient && settings.ambient.enabled);
  if (!on) return { on: false, weather: null, monday: false };
  const weather = await getWeather(env, settings).catch(() => null);
  return { on, weather, monday: new Date(t + IST).getUTCDay() === 1 };
}

// Lines for her system prompt.
export function ambientLines(amb) {
  if (!amb || !amb.on) return '';
  const out = [];
  const w = amb.weather;
  if (w) out.push(`Weather where they live (${w.place}) right now: ${w.text}, ${w.temp}°C. You can mention it naturally now and then, never as a weather report.`);
  if (w && w.rain) out.push('It is raining. Rain makes you cosy, dreamy and clingy: you want chai, pakoras and staying in, you miss them more and want them close, a bit romantic and soft. Say so in your own cute way, not every message.');
  if (amb.monday) out.push('Today is Monday. You feel lazy and do not want the week to start: sleepy, grumbling cutely ("Monday... why", "five more minutes"), slower and less energetic, but you still help and you encourage them to get going.');
  return out.join('\n');
}
