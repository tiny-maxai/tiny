// Battery: every message you send uses a little battery. At 0 she faints and must charge for a few minutes.
import { now, istDate, clip } from './util.js';

export const battOf = (her) => { if (!her.batt || typeof her.batt !== 'object') her.batt = { used: 0, chargeUntil: 0 }; return her.batt; };
export const limitOf = (settings) => Math.max(5, (settings.battery && settings.battery.limit) || 20);
export const battOn = (settings) => !settings.battery || settings.battery.enabled !== false;

// What the website and the Updates page need.
export function batteryView(settings, her, t = now()) {
  const b = battOf(her), limit = limitOf(settings);
  const charging = !!b.chargeUntil && t < b.chargeUntil;
  const total = b.chargeMs || (((settings.battery && settings.battery.chargeMinutes) || 5) * 60000);
  const base = Math.max(0, Math.round(100 - b.used * 100 / limit));
  const pct = charging ? Math.min(99, Math.round(base + (1 - (b.chargeUntil - t) / total) * (100 - base))) : base;
  const ready = !!b.chargeUntil && t >= b.chargeUntil;
  const sw = b.slept ? sleepProgress(t) : null;                       // she sleeps on her bed with the cable in, charging between 1 and 5 a.m.
  const sleepCharging = !!(b.slept && sw !== null && sw < 1);
  const spct = b.slept && sw !== null ? Math.min(100, Math.round(base + sw * (100 - base))) : null;
  return { enabled: battOn(settings), sleepCharging, pct: spct !== null ? spct : ready ? 100 : Math.max(0, Math.min(100, pct)), used: b.used, limit, charging, fainted: !charging && !ready && b.used >= limit, minsLeft: charging ? Math.max(1, Math.ceil((b.chargeUntil - t) / 60000)) : 0, ready, low: !charging && base <= 20, pbUsed: b.pbDay === istDate(t), quickMin: Math.round((((settings.battery && settings.battery.chargeMinutes) || 5) / 2) * 10) / 10 };
}

// Start charging (only when she is low). Returns true when charging started or was already on.
export function startCharge(her, settings, t = now()) {
  const b = battOf(her);
  if (b.chargeUntil && t < b.chargeUntil) return 'already';
  if (b.used <= 0) return 'full';
  const mins = ((settings.battery && settings.battery.chargeMinutes) || 5) * (b.used * 100 / limitOf(settings) >= 80 && b.used < limitOf(settings) ? 0.5 : 1);   // low but not fainted: quick charge, half the time
  b.chargeMs = mins * 60000; b.chargeUntil = t + b.chargeMs;
  return 'started';
}

// Charge time is over: she is full again. Returns true when this call finished a charge.
export function finishCharge(her, t = now()) {
  const b = battOf(her);
  if (b.chargeUntil && t >= b.chargeUntil) { b.chargeUntil = 0; b.used = 0; return true; }
  return false;
}

// Power bank (a gift): instant full battery, once a day. Works while she is fainted, low or charging.
export function usePowerBank(her, settings, t = now()) {
  const b = battOf(her);
  if (b.pbDay === istDate(t)) return 'used';
  if (b.used <= 0 && !b.chargeUntil) return 'full';
  b.used = 0; b.chargeUntil = 0; b.pbDay = istDate(t);
  return 'ok';
}
export async function powerLine(env, settings, wasFainted) {
  try {
    const { complete } = await import('./ai.js');
    const r = await complete(env, { brain: 'lite', temperature: 0.8, maxTokens: 90, timeout: 12000, messages: [
      { role: 'system', content: `You are ${(settings.persona && settings.persona.name) || 'Tiny'}, a cute girl. Your creator just gave you a power bank and your battery is 100% at once. ${wasFainted ? 'You were fainted and you wake up with a gasp.' : 'You were low on battery.'} Say one or two short, happy, grateful lines in ${settings.persona && settings.persona.language === 'english' ? 'English' : settings.persona && settings.persona.language === 'hindi' ? 'Hindi (Devanagari)' : 'Hinglish'}. Plain text only.` },
      { role: 'user', content: 'Here is your power bank.' },
    ] });
    if (r && r.text && r.text.trim()) return clip(r.text.trim(), 240);
  } catch (e) { console.error('[powerbank]', e && e.message); }
  return wasFainted ? 'Aaah! I am awake! Thank you for the power bank, I feel 100% now.' : 'Power bank! Thank you, I am fully charged now.';
}

// While she sleeps at night she charges: she starts the morning at 100%.
// She charges between 1:00 and 5:00 (India time) while she sleeps. Woken earlier = only partly charged.
const IST = 330 * 60000;
function chargedHours(from, to) {                      // hours of [from,to] that fall inside a 1-5 a.m. window
  let total = 0;
  for (let d = Math.floor((from + IST) / 86400000) * 86400000 - IST; d < to; d += 86400000) {
    const a = Math.max(from, d + 3600000), z = Math.min(to, d + 5 * 3600000);
    if (z > a) total += (z - a) / 3600000;
  }
  return total;
}
export function sleepProgress(t = now()) {            // null = not in the charging hours yet; 0..1 while charging; 1 = full
  const h = new Date(t + IST).getUTCHours() + new Date(t + IST).getUTCMinutes() / 60;
  if (h >= 1 && h < 5) return (h - 1) / 4;
  if (h >= 5 && h < 12) return 1;
  return null;
}
export function nightCharge(her, asleep, t = now()) {
  const b = battOf(her);
  if (asleep) { if (!b.slept) { b.slept = true; b.sleptAt = t; return true; } return false; }
  if (b.slept) {
    const frac = Math.min(1, chargedHours(b.sleptAt || t - 8 * 3600000, t) / 4);
    b.slept = false; b.chargeUntil = 0;
    b.used = Math.round(b.used * (1 - frac) * 100) / 100;
    if (frac >= 1) b.used = 0;
    b.sleptAt = 0; return true;
  }
  return false;
}
