// Settings live in KV under one key. Everything is optional and sanitised on save.
export const DEFAULTS = {
  userName: '',
  persona: { gender: 'girl', name: 'Tiny', vibe: 'cute', language: 'auto', custom: '' },
  brain: 'smart',                                   // smart | fast | lite
  voice: { engine: 'auto', autoplay: false, rate: 1, pitch: 1.25, girl: 'hannah', boy: 'troy' },
  reviewMemories: false,                            // ask before she remembers something new
  chat: { bubbles: true, tease: true },                          // reply like texting: a few short messages with typing dots
  mood: { enabled: true, hour: 21 },                // daily "how are you feeling?" (India time)
  habits: { enabled: true, hour: 20, goal: 8 },       // 8 pm water + mood check on Telegram
  tinyMood: 'auto',                                 // auto | normal | sleepy | hyper | sulky | sassy
  missYou: { enabled: true, days: 2 },              // message you if you have been away this many days
  period: { enabled: false, lastStart: '', cycleLength: 28, periodLength: 5, announce: true },   // Tiny's own cycle (girl only)
};
export const VIBES = ['cute', 'bestie', 'sweet', 'playful', 'caring', 'focus'];
const LANGS = ['auto', 'english', 'hinglish', 'hindi'];
const str = (v, n) => String(v ?? '').trim().slice(0, n);

export function clean(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const hb = r.habits || {};
  const p = r.persona || {};
  const v = r.voice || {};
  const ch = r.chat || {}, mo = r.mood || {}, my = r.missYou || {}, pe = r.period || {};
  const gender = p.gender === 'boy' ? 'boy' : 'girl';
  return {
    userName: str(r.userName, 60),
    persona: {
      gender,
      name: str(p.name, 30) || (gender === 'boy' ? 'Byte' : 'Tiny'),
      vibe: VIBES.includes(p.vibe) ? p.vibe : 'cute',
      language: LANGS.includes(p.language) ? p.language : 'auto',
      custom: str(p.custom, 1500),
    },
    brain: ['smart', 'fast', 'lite'].includes(r.brain) ? r.brain : 'smart',
    reviewMemories: r.reviewMemories === true,
    chat: { bubbles: ch.bubbles !== false, tease: ch.tease !== false },
    habits: { enabled: hb.enabled !== false, hour: Math.min(23, Math.max(0, hb.hour === undefined ? 20 : (parseInt(hb.hour, 10) || 0))), goal: Math.min(20, Math.max(1, parseInt(hb.goal, 10) || 8)) },
    tinyMood: ['auto', 'normal', 'sleepy', 'hyper', 'sulky', 'sassy'].includes(r.tinyMood) ? r.tinyMood : 'auto',
    period: { enabled: pe.enabled === true, lastStart: /^\d{4}-\d{2}-\d{2}$/.test(String(pe.lastStart || '')) && !isNaN(Date.parse(pe.lastStart)) ? pe.lastStart : '', cycleLength: Math.min(40, Math.max(21, parseInt(pe.cycleLength, 10) || 28)), periodLength: Math.min(8, Math.max(2, parseInt(pe.periodLength, 10) || 5)), announce: pe.announce !== false },
    mood: { enabled: mo.enabled !== false, hour: Math.min(23, Math.max(0, parseInt(mo.hour, 10) || 21)) },
    missYou: { enabled: my.enabled !== false, days: Math.min(14, Math.max(1, parseInt(my.days, 10) || 2)) },
    voice: {
      engine: ['auto', 'browser'].includes(v.engine) ? v.engine : 'auto',
      autoplay: v.autoplay === true,
      rate: Math.min(1.6, Math.max(0.6, Number(v.rate) || 1)),
      pitch: Math.min(1.8, Math.max(0.6, Number(v.pitch) || 1.25)),
      girl: ['hannah', 'autumn', 'diana'].includes(v.girl) ? v.girl : 'hannah',
      boy: ['troy', 'austin', 'daniel'].includes(v.boy) ? v.boy : 'troy',
    },
  };
}

let cache = null;
export async function getSettings(env) {
  if (cache && Date.now() - cache.t < 4000) return cache.v;
  let raw = null;
  try { raw = await env.KV.get('settings', 'json'); } catch { /* use defaults */ }
  const out = clean({ ...DEFAULTS, ...(raw || {}), persona: { ...DEFAULTS.persona, ...((raw || {}).persona || {}) }, chat: { ...DEFAULTS.chat, ...((raw || {}).chat || {}) }, mood: { ...DEFAULTS.mood, ...((raw || {}).mood || {}) }, missYou: { ...DEFAULTS.missYou, ...((raw || {}).missYou || {}) }, period: { ...DEFAULTS.period, ...((raw || {}).period || {}) }, habits: { ...DEFAULTS.habits, ...((raw || {}).habits || {}) }, voice: { ...DEFAULTS.voice, ...((raw || {}).voice || {}) } });
  cache = { t: Date.now(), v: out };
  return out;
}
export async function saveSettings(env, patch) {
  const cur = await getSettings(env);
  const next = clean({
    ...cur, ...patch,
    persona: { ...cur.persona, ...((patch || {}).persona || {}) },
    voice: { ...cur.voice, ...((patch || {}).voice || {}) },
    chat: { ...cur.chat, ...((patch || {}).chat || {}) },
    mood: { ...cur.mood, ...((patch || {}).mood || {}) },
    missYou: { ...cur.missYou, ...((patch || {}).missYou || {}) },
    period: { ...cur.period, ...((patch || {}).period || {}) },
    habits: { ...cur.habits, ...((patch || {}).habits || {}) },
  });
  await env.KV.put('settings', JSON.stringify(next));
  cache = { t: Date.now(), v: next };
  return next;
}
