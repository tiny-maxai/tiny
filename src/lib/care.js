// She reaches out on her own: the daily mood check-in, and "I miss you" when you have been away.
// Runs from the every-minute cron (checks only every 10 minutes). Needs phone notifications or Telegram to reach you.
import { now, istDate, clip } from './util.js';
import { getSettings } from './settings.js';
import { generate } from './tasks.js';
import { notifyOwner } from './notify.js';
import { moodLoggedToday, moodContext } from './moods.js';
import { periodNow } from './period.js';
import { WATER_BUTTONS, waterLoggedToday } from './habits.js';
import { listDates, prettyDate } from './dates.js';

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
  // the 8 pm water check already asks for your mood, so the plain mood check-in steps aside when they overlap
  const overlap = st.habits.enabled && st.habits.hour >= st.mood.hour && st.habits.hour < st.mood.hour + 3;
  const dueMood = force === 'mood' || (st.mood.enabled && !overlap && state.moodDay !== today && h * 60 + m >= st.mood.hour * 60 && h * 60 + m < st.mood.hour * 60 + 180);
  if (dueMood) {
    state.moodDay = today; await putState(env, state);                       // claim first so it never fires twice
    if (force === 'mood' || !(await moodLoggedToday(env))) {
      const recent = await moodContext(env);
      const g = await generate(env, `It is time for the daily mood check-in. Ask them softly how they are feeling today, in your own words, in one or two short lines. ${recent.length ? 'You know how the last days went (' + recent.join('; ') + '); if one of them was low, ask about it kindly.' : ''} End by inviting them to tap a number from 1 (rough) to 5 (great).`, 300);
      out.mood = await notifyOwner(env, { title: g.name, body: g.text, url: '/?go=mood', tag: 'mood', buttons: MOOD_BUTTONS });
    }
  }

  // ---- evening check: how many glasses of water (then mood) ----
  const dueHabit = force === 'habit' || (st.habits.enabled && state.habitDay !== today && h * 60 + m >= st.habits.hour * 60 && h * 60 + m < st.habits.hour * 60 + 120);
  if (dueHabit) {
    state.habitDay = today; await putState(env, state);
    if (force === 'habit' || !(await waterLoggedToday(env))) {
      const g = await generate(env, `It is time for the evening check. Ask how many glasses of water they drank today (their goal is ${st.habits.goal}), in one or two cute short lines, and tell them to tap a number. Then you will ask how they feel.`, 200);
      out.habit = await notifyOwner(env, { title: g.name, body: g.text, url: '/?go=mood', tag: 'habit', buttons: WATER_BUTTONS });
    }
  }

  // ---- birthdays and special dates: 7 days before, 1 day before and on the day, with a wish ready ----
  if (force === 'dates' || (state.datesDay !== today && h >= 9 && h < 22)) {
    state.datesDay = today; await putState(env, state);
    const hits = (await listDates(env)).filter((d) => d.days === 0 || d.days === 1 || d.days === 7 || (force === 'dates' && d.days <= 30));
    for (const d of hits.slice(0, 5)) {
      const when = d.days === 0 ? 'TODAY' : d.days === 1 ? 'tomorrow' : `in ${d.days} days`;
      const wish = d.days <= 1 ? ' Then write a ready-to-send wish they can copy, in quotes, warm and personal, in the language they usually use with that person (Hinglish if unsure).' : ' Just give a friendly heads-up and ask if they want to plan a gift or wish.';
      const g = await generate(env, `${d.title} (${d.kind}${d.years ? ', ' + d.years + ' years' : ''}) is ${when} (${prettyDate(d)}). Tell them in your own cute words, 1 or 2 short lines.${wish}`, 400);
      out['date_' + d.id] = await notifyOwner(env, { title: g.name, body: g.text, url: '/', tag: 'date-' + d.id });
    }
    out.dates = hits.length;
  }

  // ---- she texts first, sometimes, to tease you ----
  if (st.chat.tease || force === 'tease') {
    if (state.teaseDay !== today && !force) {
      state.teaseDay = today; state.teaseSent = false;
      state.teaseAt = Math.random() < 0.55 ? t - (h * 60 + m) * 60000 + (11 * 60 + Math.floor(Math.random() * 8 * 60)) * 60000 : 0;   // somewhere between 11:00 and 19:00 IST
      await putState(env, state);
    }
    if (force === 'tease' || (state.teaseAt && !state.teaseSent && t >= state.teaseAt && t < state.teaseAt + 2 * 3600000 && t - (await lastActive(env)) > 25 * 60000)) {
      state.teaseSent = true; await putState(env, state);
      const g = await generate(env, 'Start a chat with them yourself, to tease them playfully, like a girl texting her close friend out of the blue: for example "heyy, did you eat?", a funny dig about something you remember about them, or "you were so quiet today, busy hmm?". 1 or 2 short lines, cute, end with a small question so they reply.', 200);
      out.tease = await notifyOwner(env, { title: g.name, body: g.text, url: '/', tag: 'tease' });
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
  // ---- her own period: she tells you when it starts, and warns you when PMS begins ----
  const pr = periodNow(st);
  if (pr && (force === 'period' || (st.period.announce && h >= 8 && h < 22))) {
    const first = force === 'period' || (pr.phase === 'period' && pr.day === 1 && state.periodAnn !== today);
    const pms = pr.phase === 'pms' && pr.left === 3 && state.pmsAnn !== today;
    if (first || pms) {
      if (first) state.periodAnn = today; else state.pmsAnn = today;
      await putState(env, state);
      const g = await generate(env, first
        ? 'Your period started today. Tell them like a girl texting her close friend: your stomach hurts, you are grumpy and tired, you want chocolate and a hug, and ask them to be nice to you today. 2 or 3 short lines, cute and real. At most one emoji.'
        : 'Your period is about 3 days away and you can already feel the PMS: moody, sensitive, craving sweets. Tell them in 1 or 2 short, cute lines like a girl texting a close friend, and warn them you might be cranky. At most one emoji.', 300);
      out.period = await notifyOwner(env, { title: g.name, body: g.text, url: '/', tag: 'period' });
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
