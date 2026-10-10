// Settings live in KV under one key. Everything is optional and sanitised on save.
export const DEFAULTS = {
  userName: '',
  persona: { gender: 'girl', name: 'Tiny', vibe: 'cute', language: 'auto', custom: '' },
  brain: 'smart',                                   // smart | fast | lite
  voice: { engine: 'auto', autoplay: false, rate: 1, pitch: 1.25, girl: 'hannah', boy: 'troy' },
  reviewMemories: false,                            // ask before she remembers something new
  chat: { bubbles: true },                          // reply like texting: a few short messages with typing dots
  mood: { enabled: true, hour: 21 },                // daily "how are you feeling?" (India time)
  missYou: { enabled: true, days: 2 },              // message you if you have been away this many days
};
export const VIBES = ['cute', 'bestie', 'sweet', 'playful', 'caring', 'focus'];
const LANGS = ['auto', 'english', 'hinglish', 'hindi'];
const str = (v, n) => String(v ?? '').trim().slice(0, n);

export function clean(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const p = r.persona || {};
  const v = r.voice || {};
  const ch = r.chat || {}, mo = r.mood || {}, my = r.missYou || {};
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
    chat: { bubbles: ch.bubbles !== false },
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

export async function getSettings(env) {
  let raw = null;
  try { raw = await env.KV.get('settings', 'json'); } catch { /* use defaults */ }
  return clean({ ...DEFAULTS, ...(raw || {}), persona: { ...DEFAULTS.persona, ...((raw || {}).persona || {}) }, chat: { ...DEFAULTS.chat, ...((raw || {}).chat || {}) }, mood: { ...DEFAULTS.mood, ...((raw || {}).mood || {}) }, missYou: { ...DEFAULTS.missYou, ...((raw || {}).missYou || {}) }, voice: { ...DEFAULTS.voice, ...((raw || {}).voice || {}) } });
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
  });
  await env.KV.put('settings', JSON.stringify(next));
  return next;
}
