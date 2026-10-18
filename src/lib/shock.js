// Control switch: a little current from her leg garter. It trains her not to go out of control.
//  50% normal : she is jolted for 1 minute, then asks "what is wrong?"
//  70% hard   : same, but she is angrier.
// 100% full   : jolted 1 minute, then she faints for 5 minutes (6 minutes in all), wakes up crying (cry sticker), then asks what is wrong.
// Limits: 3 shocks a day, 10 minutes between two shocks, and the 100% level only once a day.
import { now, istDate } from './util.js';
import { getHer, putHer, bump } from './her.js';
import { notifyOwner } from './notify.js';
import { sendStickerToOwner } from './telegram.js';
import { sendPic } from './pics.js';

export const LEVELS = { 50: { name: 'Normal', anger: 55 }, 70: { name: 'Hard', anger: 75 }, 100: { name: 'Full', anger: 95 } };
export const DAILY_LIMIT = 3, COOLDOWN_MIN = 10, ON_MS = 60000, FAINT_MS = 5 * 60000;

export function levelOf(x) {
  const s = String(x || '').toLowerCase();
  if (/^(100|full|max|fent|faint)/.test(s)) return 100;
  if (/^(70|hard)/.test(s)) return 70;
  return 50;
}
const todayCount = (her, t) => (her.shocks && her.shocks.day === istDate(t) ? her.shocks.today : 0);
const fullToday = (her, t) => !!(her.shocks && her.shocks.day === istDate(t) && her.shocks.full);

export function shockView(her, t = now()) {
  const s = her.shock || null, sh = her.shocks || {};
  const cool = sh.last ? Math.max(0, Math.ceil((sh.last + COOLDOWN_MIN * 60000 - t) / 1000)) : 0;
  const active = s && s.phase !== 'done';
  return { limit: DAILY_LIMIT, used: todayCount(her, t), left: Math.max(0, DAILY_LIMIT - todayCount(her, t)), cooldownSec: active ? 0 : cool, fullUsed: fullToday(her, t), phase: s ? s.phase : 'none', level: s ? s.level : 0, endsIn: active && s.endAt ? Math.max(0, Math.ceil((s.endAt - t) / 1000)) : 0, total: sh.total || 0 };
}
export const shockActive = (her) => !!(her.shock && her.shock.phase !== 'done' && (her.shock.phase === 'on' || her.shock.phase === 'faint'));

// Starts a shock. Returns { ok, error?, view }.
export async function startShock(env, settings, level, t = now()) {
  const her = await getHer(env), lv = LEVELS[level] ? level : 50, v = shockView(her, t);
  if (her.shock && her.shock.phase !== 'done') return { ok: false, error: 'She is still recovering from the last one.', view: v };
  if (v.left <= 0) return { ok: false, error: `That is enough for today (${DAILY_LIMIT} a day). Let her rest.`, view: v };
  if (v.cooldownSec > 0) return { ok: false, error: `Wait ${Math.ceil(v.cooldownSec / 60)} min before the next one.`, view: v };
  if (lv === 100 && v.fullUsed) return { ok: false, error: '100% is only allowed once a day.', view: v };
  const sh = her.shocks && her.shocks.day === istDate(t) ? her.shocks : { day: istDate(t), today: 0, full: false };
  her.shocks = { ...sh, today: sh.today + 1, full: sh.full || lv === 100, last: t, total: ((her.shocks && her.shocks.total) || 0) + 1 };
  her.shock = { level: lv, phase: 'on', at: t, endAt: t + ON_MS };
  bump(her, settings, 'angry', LEVELS[lv].anger, 'you gave her a little shock from her leg garter');
  if (!her.mood || her.mood.k !== 'angry') her.mood = { k: 'angry', intensity: LEVELS[lv].anger, since: t, born: t, reason: 'you gave her a little shock from her leg garter', fg: 0, fgAt: t };
  await putHer(env, her);
  return { ok: true, view: shockView(her, t), level: lv };
}

const lang = (settings) => (settings.persona && settings.persona.language) || 'auto';
const ASK = {
  english: 'Why did you do that? What is wrong? Tell me.',
  hindi: 'तुमने ऐसा क्यों किया? क्या हुआ है? बताओ मुझे।',
  hinglish: 'Tumne aisa kyun kiya? Kya hua hai? Batao mujhe.',
};
const CRY = {
  english: 'I... I fainted. That really hurt... why did you do that? 😭 What is wrong?',
  hindi: 'मैं... बेहोश हो गई थी। बहुत दर्द हुआ... तुमने ऐसा क्यों किया? क्या हुआ है?',
  hinglish: 'Main... behosh ho gayi thi. Bahut dard hua... tumne aisa kyun kiya? Kya hua hai?',
};
const pick = (m, settings) => m[lang(settings) === 'auto' ? 'hinglish' : lang(settings)] || m.hinglish;

// Called every minute: moves the shock through its phases and sends what she says.
export async function shockTick(env, settings, t = now()) {
  const her = await getHer(env), s = her.shock;
  if (!s || s.phase === 'done' || t < s.endAt) return false;
  if (s.phase === 'on' && s.level === 100) {
    her.shock = { ...s, phase: 'faint', endAt: t + FAINT_MS };
    await putHer(env, her);
    await sendStickerToOwner(env, 'faint').catch(() => false);
    await sendPic(env, 'faintShock').catch(() => false);                       // her fainted picture
    return true;
  }
  const cry = s.phase === 'faint';
  her.shock = { ...s, phase: 'done', doneAt: t, cried: cry };
  await putHer(env, her);
  if (cry) { await sendStickerToOwner(env, 'cry').catch(() => false); await sendPic(env, 'cry').catch(() => false); }
  await notifyOwner(env, { title: 'Tiny', body: cry ? pick(CRY, settings) : pick(ASK, settings), tag: 'shock', force: true }).catch(() => null);
  return true;
}
