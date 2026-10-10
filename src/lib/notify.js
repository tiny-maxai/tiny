// One way to reach you: phone notification (Web Push) and Telegram, whichever are set up.
import { sendPush, pushReady } from './push.js';
import { send, sendWithButtons } from './telegram.js';
import { clip } from './util.js';

// opts: { title, body, url, tag, buttons: [[{text, data}]] }
export async function notifyOwner(env, { title, body, url = '/', tag = 'tiny', buttons = null }) {
  const out = { push: 0, telegram: false };
  const text = clip(String(body || ''), 1500);
  if (pushReady(env)) out.push = await sendPush(env, { title: clip(title, 60), body: clip(text, 220), url, tag }).catch(() => 0);
  if (env.TELEGRAM_BOT_TOKEN && env.OWNER_TG_ID) {
    try { if (buttons) await sendWithButtons(env, env.OWNER_TG_ID, text, buttons); else await send(env, env.OWNER_TG_ID, text); out.telegram = true; } catch { /* ignore */ }
  }
  return out;
}
