// Her pictures for special moments (public/images/update). A picture is only used when its file really exists,
// so you can add them one by one. Used by the She strip, the chat ([[img:...]] tokens) and Telegram photos.
import { sendPhoto } from './telegram.js';

export const PIC = {
  fever: 'sick-fever', medicine: 'medicine', soup: 'soup', rest: 'resting', recovered: 'recovered',
  pain: 'pain', hotwater: 'hotwater', chocolate: 'period-chocolate', cry: 'cry', jealous: 'jealous', battery: 'battery-low',
  morning: 'good-morning', night: 'good-night', newSkill: 'new-skill', birthday: 'birthday', birthdayDress: 'birthday-dress',
  halfSaree: 'half-saree', updated: 'updated', faintShock: 'faint-shock', angry: 'angry', forgiven: 'forgiven', drawing: 'drawing', water: 'water', iceCream: 'ice-cream', rain: 'rain-window', exam: 'exam-time',
};
export const picPath = (k) => `/images/update/${PIC[k] || k}.webp`;
export const picToken = (k) => `[[img:${picPath(k)}]]`;
export const skillPicPath = (id) => `/images/update/skill-${id}.webp`;

const seen = new Map();                                              // path -> [exists, checkedAt]: one cheap HEAD request per few minutes
export async function hasAsset(env, path) {
  const c = seen.get(path); if (c && Date.now() - c[1] < 300000) return c[0];
  let ok = false;
  try { const r = await env.ASSETS.fetch(new Request('https://assets.local' + path, { method: 'HEAD' })); ok = r.ok && /^image\//.test(r.headers.get('content-type') || ''); } catch { ok = false; }
  seen.set(path, [ok, Date.now()]); return ok;
}

// Sends one of the pictures to the owner on Telegram (silently does nothing when the file is missing).
export async function sendPic(env, key, caption = '') {
  if (!env.OWNER_TG_ID || !env.TELEGRAM_BOT_TOKEN) return false;
  const path = key.startsWith('/') ? key : picPath(key);
  if (!(await hasAsset(env, path))) return false;
  const origin = await env.KV.get('origin').catch(() => null);
  if (!origin) return false;
  return sendPhoto(env, env.OWNER_TG_ID, origin + path, caption).catch(() => false);
}
// Chat token for a picture, or '' when the file is missing.
export async function tokenIf(env, key) { const p = key.startsWith('/') ? key : picPath(key); return (await hasAsset(env, p)) ? `[[img:${p}]]` : ''; }
