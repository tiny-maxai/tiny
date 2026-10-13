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
  return { enabled: battOn(settings), pct: ready ? 100 : Math.max(0, Math.min(100, pct)), used: b.used, limit, charging, fainted: !charging && !ready && b.used >= limit, minsLeft: charging ? Math.max(1, Math.ceil((b.chargeUntil - t) / 60000)) : 0, ready, low: !charging && base <= 20, pbUsed: b.pbDay === istDate(t), quickMin: Math.round((((settings.battery && settings.battery.chargeMinutes) || 5) / 2) * 10) / 10 };
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
      { role: 'system', content: `You are ${(settings.persona && settings.persona.name) || 'Tiny'}, a cute girl robot. Your creator just gave you a power bank and your battery is 100% at once. ${wasFainted ? 'You were fainted and you wake up with a gasp.' : 'You were low on battery.'} Say one or two short, happy, grateful lines in ${settings.persona && settings.persona.language === 'english' ? 'English' : settings.persona && settings.persona.language === 'hindi' ? 'Hindi (Devanagari)' : 'Hinglish'}. Plain text only.` },
      { role: 'user', content: 'Here is your power bank.' },
    ] });
    if (r && r.text && r.text.trim()) return clip(r.text.trim(), 240);
  } catch (e) { console.error('[powerbank]', e && e.message); }
  return wasFainted ? 'Aaah! I am awake! Thank you for the power bank, I feel 100% now.' : 'Power bank! Thank you, I am fully charged now.';
}

// While she sleeps at night she charges: she starts the morning at 100%.
export function nightCharge(her, asleep, t = now()) {
  const b = battOf(her);
  if (asleep) { if (!b.slept) { b.slept = true; return true; } return false; }
  if (b.slept) { b.slept = false; b.used = 0; b.chargeUntil = 0; return true; }
  return false;
}
