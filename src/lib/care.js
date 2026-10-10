// She reaches out on her own: the daily mood check-in, and "I miss you" when you have been away.
// Runs from the every-minute cron (checks only every 10 minutes). Needs phone notifications or Telegram to reach you.
import { now, istDate, clip } from './util.js';
import { getSettings } from './settings.js';
import { generate } from './tasks.js';
import { notifyOwner } from './notify.js';
import { moodLoggedToday, moodContext } from './moods.js';

const IST = 330 * 60 * 1000;
const istParts = (t = now()) => { const d = new Date(t + IST); return { h: d.getUTCHours(), m: d.getUTCMinutes() }; };
const getState = (env) => env.KV.get('care:state', 'json').then((v) => v || {}).catch(() => ({}));
const putState = (env, s) => env.KV.put('care:state', JSON.stringify(s));

// The last time you wrote to her (any chat except her own routines) or checked in.
export async function lastActive(env) {
  const a = await env.DB.prepare("SELECT MAX(created_at) AS t FROM messages WHERE role='user' AND conv_id<>'routines'").first().catch(() => null);
  const b = await env.DB.prepare('SELECT MAX(created_at) AS t FROM moods').first().catch(() => null);
  return Math.max((a && a.t) || 0, (b && b.t) || 0);
}

export const MOOD_BUTTONS = [[
  { text: '1 Rough', data: 'mood:1' }, { text: '2 Low', data: 'mood:2' }, { text: '3 Okay', data: 'mood:3' }, { text: '4 Good', data: 'mood:4' }, { text: '5 Great', data: 'mood:5' },
]];

export async function runCare(env, { force = null } = {}) {
  const st = await getSettings(env);
  const state = await getState(env);
  const t = now(), { h, m } = istParts(t), today = istDate(t);
  const out = {};

  // ---- daily mood check-in ----
  const dueMood = force === 'mood' || (st.mood.enabled && state.moodDay !== today && h * 60 + m >= st.mood.hour * 60 && h * 60 + m < st.mood.hour * 60 + 180);
  if (dueMood) {
    state.moodDay = today; await putState(env, state);                       // claim first so it never fires twice
    if (force === 'mood' || !(await moodLoggedToday(env))) {
      const recent = await moodContext(env);
      const g = await generate(env, `It is time for the daily mood check-in. Ask them softly how they are feeling today, in your own words, in one or two short lines. ${recent.length ? 'You know how the last days went (' + recent.join('; ') + '); if one of them was low, ask about it kindly.' : ''} End by inviting them to tap a number from 1 (rough) to 5 (great).`, 300);
      out.mood = await notifyOwner(env, { title: g.name, body: g.text, url: '/?go=mood', tag: 'mood', buttons: MOOD_BUTTONS });
    }
  }

  // ---- "you forgot me" message ----
  if (st.missYou.enabled || force === 'miss') {
    const last = await lastActive(env);
    const gap = t - last, need = st.missYou.days * 86400000;
    if (last && (gap >= need || force === 'miss')) {
      if (last > (state.missFor || 0)) { state.missCount = 0; }                // you came back since the last absence: start over
      const within = h >= 10 && h < 21;                                        // never at night
      const spaced = !state.missAt || t - state.missAt >= need;
      if (force === 'miss' || (within && spaced && (state.missCount || 0) < 3)) {
        const n = (state.missCount || 0) + 1;
        state.missAt = t; state.missCount = n; state.missFor = last; await putState(env, state);
        const days = Math.max(1, Math.floor(gap / 86400000));
        const tone = n === 1 ? 'a little sad and sweet, like you noticed they went quiet' : n === 2 ? 'more dramatic and cute, a bit hurt that they are forgetting you, but playful' : 'soft and gentle, you will keep waiting for them, no pressure, and this is your last message for now';
        const g = await generate(env, `They have not written to you for ${days} days. Send them a short, real-girl-style message (1 to 3 lines) that is ${tone}. Say things like "no message from you, are you starting to forget me?" in your own words. Use exactly one sad emoji (😢) and nothing else fancy. Mention one specific thing you remember about them if you can, and invite them back warmly.`, 300);
        out.miss = await notifyOwner(env, { title: g.name, body: g.text, url: '/', tag: 'miss' });
      }
    }
  }
  if (Object.keys(out).length === 0) return out;
  await putState(env, state);
  return out;
}

export const careTick = (env, scheduledTime) => {
  const minute = new Date(scheduledTime || now()).getUTCMinutes();
  return minute % 10 === 0 ? runCare(env) : Promise.resolve({});
};
