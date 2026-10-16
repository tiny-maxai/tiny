// One way to reach you: phone notification (Web Push) and Telegram, whichever are set up.
import { sendPush, pushReady } from './push.js';
import { send, sendWithButtons, sendVoice } from './telegram.js';
import { clip, now } from './util.js';

// While she sleeps nothing is sent: no reminders, no automation, no notices (everything waits for the morning).
export async function asleepNow(env) {
  try {
    const { getSettings } = await import('./settings.js'), { getHer, isSleeping } = await import('./her.js');
    const [st, her] = await Promise.all([getSettings(env), getHer(env)]);
    if (isSleeping(st, her, now())) return true;
    const q = Number(await env.KV.get('quiet:until').catch(() => 0)) || 0;      // /quiet 2h in Telegram
    return q > now();
  } catch { return false; }
}

// opts: { title, body, url, tag, buttons: [[{text, data}]], voice: true to also send it as a voice note }
export async function notifyOwner(env, { title, body, url = '/', tag = 'tiny', buttons = null, voice = false, force = false }) {
  const out = { push: 0, telegram: false };
  if (!force && await asleepNow(env)) return { ...out, asleep: true };
  const text = clip(String(body || ''), 1500);
  if (pushReady(env)) out.push = await sendPush(env, { title: clip(title, 60), body: clip(text, 220), url, tag }).catch(() => 0);
  if (env.TELEGRAM_BOT_TOKEN && env.OWNER_TG_ID) {
    try { if (buttons) await sendWithButtons(env, env.OWNER_TG_ID, text, buttons); else await send(env, env.OWNER_TG_ID, text); out.telegram = true; if (voice) await sendVoice(env, env.OWNER_TG_ID, text); } catch { /* ignore */ }
  }
  return out;
}
