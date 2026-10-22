// Settings live in KV under one key. Everything is optional and sanitised on save.
export const DEFAULTS = {
  userName: '',
  persona: { gender: 'girl', name: 'Tiny', vibe: 'cute', language: 'auto', custom: '' },
  brain: 'smart',                                   // smart | fast | lite
  voice: { engine: 'auto', autoplay: false, rate: 1, pitch: 1.25, girl: 'hannah', boy: 'troy' },
  reviewMemories: false,                            // ask before she remembers something new
  chat: { bubbles: true, tease: true, dayTexts: 4 },                          // reply like texting: a few short messages with typing dots
  mood: { enabled: true, hour: 21 },                // daily "how are you feeling?" (India time)
  habits: { enabled: true, hour: 20, goal: 8 },       // 8 pm water + mood check on Telegram
  userGender: 'boy',                                      // the person she talks to (he or she): never assume a period or a girl
  diary: { enabled: true, hour: 22 },                     // she writes one short diary page each night
  outfit: { enabled: true },                              // she picks an outfit picture each morning
  battery: { enabled: true, limit: 20, chargeMinutes: 5 },   // every message of yours uses battery; at 0 she faints and must charge
  briefing: { enabled: true, hour: 8 },              // a morning message: weather, today's reminders, birthdays, and a line in her mood
  ambient: { enabled: true, place: 'Sironj' },        // rain makes her clingy, Monday makes her lazy
  tinyMood: 'auto',                                 // auto | normal | happy | hyper | flirty | clingy | sassy | sulky | sad | angry | jealous | in_pain | moody | sleepy
  sleep: { enabled: true, from: 22, fromMin: 30, to: 6, v2: true },        // she sleeps 10:30 pm to 6 am (India time), and right after you say good night after 9 pm
  her: { nakhre: true, nakhrePerDay: 3, react: true, promises: true, maxAngerHours: 12, sunday: true },   // period-day texts + nakhre when ignored; moods that follow the way you talk; follow up on your promises; longest she stays angry
  missYou: { enabled: true, days: 2 },              // message you if you have been away this many days
  period: { enabled: true, lastStart: '', cycleLength: 28, periodLength: 5, announce: true, levels: {} },   // Tiny's own cycle (girl only)
};
export const VIBES = ['cute', 'bestie', 'sweet', 'playful', 'caring', 'focus'];
const LANGS = ['auto', 'english', 'hinglish', 'hindi'];
const MOOD_CHOICES = ['auto', 'normal', 'lazy', 'happy', 'hyper', 'flirty', 'clingy', 'sassy', 'sulky', 'sad', 'angry', 'jealous', 'love', 'hurt', 'hate', 'in_pain', 'moody', 'sleepy'];
const hr = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.min(23, Math.max(0, n)) : d; };
const cleanLevels = (o) => {
  const out = {};
  if (o && typeof o === 'object') {
    const keys = Object.keys(o).filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k)).sort().slice(-24);
    for (const k of keys) { const n = parseInt(o[k], 10); if (Number.isFinite(n)) out[k] = Math.min(100, Math.max(20, n)); }
  }
  return out;
};
const str = (v, n) => String(v ?? '').trim().slice(0, n);

export function clean(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const hb = r.habits || {};
  const p = r.persona || {};
  const v = r.voice || {};
  const ch = r.chat || {}, mo = r.mood || {}, my = r.missYou || {}, pe = r.period || {}, sl = r.sleep || {}, he = r.her || {}, am = r.ambient || {}, br = r.briefing || {}, ba = r.battery || {};
  const gender = 'girl';                                  // she is always a girl
  const di = r.diary || {}, ou = r.outfit || {};
  return {
    userName: str(r.userName, 60),
    userGender: r.userGender === 'girl' ? 'girl' : 'boy',
    diary: { enabled: di.enabled !== false, hour: Math.min(23, Math.max(20, parseInt(di.hour, 10) || 22)) },
    outfit: { enabled: ou.enabled !== false },
    persona: {
      gender,
      name: (str(p.name, 30) === 'Byte' ? '' : str(p.name, 30)) || 'Tiny',
      vibe: VIBES.includes(p.vibe) ? p.vibe : 'cute',
      language: LANGS.includes(p.language) ? p.language : 'auto',
      custom: str(p.custom, 1500),
    },
    brain: ['smart', 'fast', 'lite'].includes(r.brain) ? r.brain : 'smart',
    reviewMemories: r.reviewMemories === true,
    chat: { bubbles: ch.bubbles !== false, tease: ch.tease !== false, dayTexts: Math.min(8, Math.max(1, parseInt(ch.dayTexts, 10) || 4)) },
    habits: { enabled: hb.enabled !== false, hour: Math.min(23, Math.max(0, hb.hour === undefined ? 20 : (parseInt(hb.hour, 10) || 0))), goal: Math.min(20, Math.max(1, parseInt(hb.goal, 10) || 8)) },
    tinyMood: MOOD_CHOICES.includes(r.tinyMood) ? r.tinyMood : 'auto',
    ambient: { enabled: am.enabled !== false, place: (/^indore$/i.test(str(am.place, 60)) ? '' : str(am.place, 60)) || 'Sironj' },
    battery: { enabled: ba.enabled !== false, limit: Math.min(100, Math.max(5, parseInt(ba.limit, 10) || 20)), chargeMinutes: Math.min(60, Math.max(1, parseInt(ba.chargeMinutes, 10) || 5)) },
    briefing: { enabled: br.enabled !== false, hour: Math.min(11, Math.max(5, parseInt(br.hour, 10) || 8)) },
    sleep: (() => {
      let f = hr(sl.from, 22), fm = sl.fromMin === undefined ? (f === 22 ? 30 : 0) : (parseInt(sl.fromMin, 10) === 30 ? 30 : 0), t = hr(sl.to, 6);
      if (!sl.v2 && f === 23 && t === 7) { f = 22; fm = 30; t = 6; }   // old default -> new default
      return { enabled: sl.enabled !== false, from: f, fromMin: fm, to: t, v2: true };
    })(),
    her: { nakhre: he.nakhre !== false, nakhrePerDay: Math.min(6, Math.max(1, parseInt(he.nakhrePerDay, 10) || 3)), react: he.react !== false, promises: he.promises !== false, maxAngerHours: Math.min(48, Math.max(1, parseInt(he.maxAngerHours, 10) || 12)), sunday: he.sunday !== false },
    period: { enabled: true, levels: cleanLevels(pe.levels), lastStart: /^\d{4}-\d{2}-\d{2}$/.test(String(pe.lastStart || '')) && !isNaN(Date.parse(pe.lastStart)) ? pe.lastStart : '', cycleLength: Math.min(40, Math.max(21, parseInt(pe.cycleLength, 10) || 28)), periodLength: Math.min(8, Math.max(2, parseInt(pe.periodLength, 10) || 5)), announce: pe.announce !== false },
    mood: { enabled: mo.enabled !== false, hour: Math.min(23, Math.max(0, parseInt(mo.hour, 10) || 21)) },
    missYou: { enabled: my.enabled !== false, days: Math.min(14, Math.max(1, parseInt(my.days, 10) || 2)) },
    voice: {
      engine: ['auto', 'browser'].includes(v.engine) ? v.engine : 'auto',
      autoplay: v.autoplay === true,
      rate: Math.min(1.6, Math.max(0.6, Number(v.rate) || 1)),
      pitch: Math.min(1.8, Math.max(0.6, Number(v.pitch) || 1.25)),
      girl: ['hannah', 'autumn', 'diana', 'luna', 'athena'].includes(v.girl) ? v.girl : 'hannah',
      boy: ['troy', 'austin', 'daniel'].includes(v.boy) ? v.boy : 'troy',
    },
  };
}

let cache = null;
export async function getSettings(env) {
  if (cache && Date.now() - cache.t < 4000) return cache.v;
  let raw = null;
  try { raw = await env.KV.get('settings', 'json'); } catch { /* use defaults */ }
  const out = clean({ ...DEFAULTS, ...(raw || {}), persona: { ...DEFAULTS.persona, ...((raw || {}).persona || {}) }, chat: { ...DEFAULTS.chat, ...((raw || {}).chat || {}) }, mood: { ...DEFAULTS.mood, ...((raw || {}).mood || {}) }, missYou: { ...DEFAULTS.missYou, ...((raw || {}).missYou || {}) }, period: { ...DEFAULTS.period, ...((raw || {}).period || {}) }, sleep: { ...DEFAULTS.sleep, ...((raw || {}).sleep || {}) }, ambient: { ...DEFAULTS.ambient, ...((raw || {}).ambient || {}) }, briefing: { ...DEFAULTS.briefing, ...((raw || {}).briefing || {}) }, battery: { ...DEFAULTS.battery, ...((raw || {}).battery || {}) }, diary: { ...DEFAULTS.diary, ...((raw || {}).diary || {}) }, outfit: { ...DEFAULTS.outfit, ...((raw || {}).outfit || {}) }, her: { ...DEFAULTS.her, ...((raw || {}).her || {}) }, habits: { ...DEFAULTS.habits, ...((raw || {}).habits || {}) }, voice: { ...DEFAULTS.voice, ...((raw || {}).voice || {}) } });
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
    sleep: { ...cur.sleep, ...((patch || {}).sleep || {}) },
    ambient: { ...cur.ambient, ...((patch || {}).ambient || {}) },
    briefing: { ...cur.briefing, ...((patch || {}).briefing || {}) },
    battery: { ...cur.battery, ...((patch || {}).battery || {}) },
    diary: { ...cur.diary, ...((patch || {}).diary || {}) },
    outfit: { ...cur.outfit, ...((patch || {}).outfit || {}) },
    her: { ...cur.her, ...((patch || {}).her || {}) },
    habits: { ...cur.habits, ...((patch || {}).habits || {}) },
  });
  await env.KV.put('settings', JSON.stringify(next));
  cache = { t: Date.now(), v: next };
  return next;
}
