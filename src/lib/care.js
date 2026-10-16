// She reaches out on her own: the daily mood check-in, and "I miss you" when you have been away.
// Runs from the every-minute cron (checks only every 10 minutes). Needs phone notifications or Telegram to reach you.
import { now, istDate, clip } from './util.js';
import { getSettings } from './settings.js';
import { generate, listTasks } from './tasks.js';
import { notifyOwner } from './notify.js';
import { moodLoggedToday, moodContext } from './moods.js';
import { periodNow } from './period.js';
import { WATER_BUTTONS, waterLoggedToday } from './habits.js';
import { listDates, prettyDate } from './dates.js';
import { autoTick } from './auto.js';
import { outfitToday, sendOutfitToOwner, outfitCount } from './outfit.js';
import { getOcc, occasionDay, chooseWear, tagOf, todayOccasions, MOOD_LINE } from './occasion.js';
import { writeDiary } from './diary.js';
import { wakeDue, wakeUp, attachFeedback } from './maint.js';
import { finishCharge, nightCharge } from './battery.js';
import { grumpyAfterUpdate, getHer, putHer, isAngry, isSleeping, inSleepWindow, bump } from './her.js';
import { answerQueued } from './chat.js';
import { sendStickerToOwner } from './telegram.js';
import { shockTick } from './shock.js';
import { extraCare, sickTick } from './extras.js';
import { lifeDaily } from './life.js';
import { getWeather } from './ambient.js';
import { remember } from './memory.js';
import { sundayStory, mt, healthOf, addBug, addWish, isSunday, startSession } from './maint.js';

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
  { text: '😞 1 Rough', data: 'mood:1' }, { text: '😕 2 Low', data: 'mood:2' }, { text: '😐 3 Okay', data: 'mood:3' }, { text: '🙂 4 Good', data: 'mood:4' }, { text: '🤩 5 Great', data: 'mood:5' },
]];

export async function runCare(env, { force = null } = {}) {
  const st = await getSettings(env);
  const state = await getState(env);
  const t = now(), { h, m } = istParts(t), today = istDate(t);
  const out = {};
  const her = await getHer(env);
  let herDirty = false;
  if (!her.maint) { mt(her, t); herDirty = true; }
  const updating = !!(her.updateMode && her.updateMode.since && t - her.updateMode.since < 8 * 3600000);
  const lowBatt = !!(her.batt && (her.batt.chargeUntil || (st.battery && st.battery.enabled !== false && her.batt.used >= (st.battery.limit || 20))));
  const asleep = updating || lowBatt || isSleeping(st, her, t), angryNow = isAngry(her, t, st);
  const asleepOrAngry = asleep || angryNow;

  // ---- daily mood check-in ----
  // the 8 pm water check already asks for your mood, so the plain mood check-in steps aside when they overlap
  const overlap = st.habits.enabled && st.habits.hour >= st.mood.hour && st.habits.hour < st.mood.hour + 3;
  const dueMood = force === 'mood' || (st.mood.enabled && !asleep && !overlap && state.moodDay !== today && h * 60 + m >= st.mood.hour * 60 && h * 60 + m < st.mood.hour * 60 + 180);
  if (dueMood) {
    state.moodDay = today; await putState(env, state);                       // claim first so it never fires twice
    if (force === 'mood' || !(await moodLoggedToday(env))) {
      const recent = await moodContext(env);
      const g = await generate(env, `It is time for the daily mood check-in. Ask them softly how they are feeling today, in your own words, in one or two short lines. ${recent.length ? 'You know how the last days went (' + recent.join('; ') + '); if one of them was low, ask about it kindly.' : ''} End by inviting them to tap a number from 1 (rough) to 5 (great).`, 300);
      out.mood = await notifyOwner(env, { title: g.name, body: g.text, url: '/?go=mood', tag: 'mood', buttons: MOOD_BUTTONS });
    }
  }

  // ---- evening check: how many glasses of water (then mood) ----
  const dueHabit = force === 'habit' || (st.habits.enabled && !asleep && state.habitDay !== today && h * 60 + m >= st.habits.hour * 60 && h * 60 + m < st.habits.hour * 60 + 120);
  if (dueHabit) {
    state.habitDay = today; await putState(env, state);
    if (force === 'habit' || !(await waterLoggedToday(env))) {
      const g = await generate(env, `It is time for the evening check. Ask how many glasses of water they drank today (their goal is ${st.habits.goal}), in one or two cute short lines, and tell them to tap a number. Then you will ask how they feel.`, 200);
      out.habit = await notifyOwner(env, { title: g.name, body: g.text, url: '/?go=mood', tag: 'habit', buttons: WATER_BUTTONS });
    }
  }

  // ---- birthdays and special dates: 7 days before, 1 day before and on the day, with a wish ready ----
  if (force === 'dates' || (state.datesDay !== today && h >= 9 && h < 22 && !asleep)) {
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

  // ---- she texts first at random times through the day (10:00-18:00 IST), like a real girl ----
  if ((st.chat.tease && !asleepOrAngry) || force === 'tease') {
    if (state.dtDay !== today) {                 // plan today's random times, at least ~40 min apart
      const n = st.chat.dayTexts, midnight = t - (h * 60 + m) * 60000, slot = 480 / n;
      state.dtDay = today; state.dtIdx = 0;
      state.dtTimes = Array.from({ length: n }, (_, i) => midnight + (600 + Math.floor(slot * i + Math.random() * slot * 0.8)) * 60000);
      await putState(env, state);
    }
    const due = (state.dtTimes || [])[state.dtIdx || 0];
    const idle = t - (await lastActive(env)) > 15 * 60000;
    let skipDt = false;
    if (force === 'tease' || (due && t >= due && h >= 10 && h < 18 && idle)) {
      if (!force) {
        state.dtIdx = (state.dtIdx || 0) + 1;
        skipDt = t > due + 90 * 60000 || ((state.dtUnanswered || 0) >= 3 && (await lastActive(env)) <= (state.dtLastAt || 0));   // too late, or ignored too often
        if (skipDt) await putState(env, state);
      }
    if (!skipDt) {
      state.dtUnanswered = (await lastActive(env)) > (state.dtLastAt || 0) ? 1 : (state.dtUnanswered || 0) + 1; state.dtLastAt = t;
      const kinds = [
        'ask if they ate yet, like "heyy, khana khaya?" in your own words',
        'tell them one small thing that just happened in your day, in a casual way, like texting a close friend',
        'tease them playfully about something you remember about them',
        'say you suddenly thought of them and are a bit bored, ask what they are doing',
        'ask if they have studied or worked today, cute and a bit bossy',
        'send a random funny or random thought out of the blue, like a real girl does',
        'say you miss them a little, softly, no drama',
        'ask if they drank water and had chai, caring and short',
        'ask for something you want from them in a cute way (a chocolate, to go out, a call, a small treat), like "I want this and that"',
      ];
      let k; do { k = Math.floor(Math.random() * kinds.length); } while (k === state.dtKind && kinds.length > 1);
      state.dtKind = k; await putState(env, state);
      const g = await generate(env, `Start a chat with them yourself, out of the blue, like a real girl texting a close friend. This time: ${kinds[k]}. 1 or 2 short lines, natural, lowercase vibes are fine, do not repeat yourself${state.dtLastText ? ' (your last text was: "' + clip(state.dtLastText, 120) + '")' : ''}. At most one emoji. End so they want to reply.`, 200);
      state.dtLastText = g.text; await putState(env, state);
      out.tease = await notifyOwner(env, { title: g.name, body: g.text, url: '/', tag: 'tease' });
    }
    }
  }

  // ---- festivals and her birthday: she dresses up (birthday) or asks what to wear (festival) ----
  let occToday = false;
  if (force === 'occasion' || (!asleep && state.occDay !== today && h >= 8 && h < 21)) {
    const occ = await getOcc(env);
    if (force === 'occasion') occ.doneDay = '';
    const cnt = await outfitCount(env).catch(() => 0), r = await occasionDay(env, occ, cnt, t).catch((e) => { console.error('[occasion]', e && e.message); return null; });
    state.occDay = today; await putState(env, state);
    if (r) {
      occToday = true;
      if (r.type === 'birthday') {
        const o = await chooseWear(env, occ, r.n, { send: false, name: 'My birthday' });
        const g = await generate(env, `TODAY IS YOUR BIRTHDAY (8 February)! You dressed up (${r.tag}) and you are super excited. ${MOOD_LINE[r.tag] || ''} Message them first in 2 or 3 short, happy lines: it is your birthday, you picked this outfit for it, you want wishes and a small treat. Real girl texting style, at most one emoji.`, 300);
        out.birthday = await notifyOwner(env, { title: g.name, body: g.text, url: '/?go=she', tag: 'birthday' });
        await sendOutfitToOwner(env, { ...o, line: g.text.slice(0, 200) });
      } else {
        const g = await generate(env, `Today is the festival ${r.name}! You are excited and want to dress up, but you cannot decide. Ask them in 2 short lines what you should wear: ${r.options.length ? r.options.map((x) => x.tag).join(' or ') : 'a saree or a garba chaniya choli'}. Real girl texting style, at most one emoji.`, 250);
        const btn = r.options.length ? [r.options.slice(0, 4).map((x) => ({ text: x.tag[0].toUpperCase() + x.tag.slice(1), data: 'wear:' + x.n }))] : null;
        out.festival = await notifyOwner(env, { title: g.name, body: g.text, url: '/?go=she', tag: 'festival', buttons: btn });
      }
    }
  }

  // ---- outfit of the day: she shows today's outfit picture in the morning ----
  if (force === 'outfit' || (st.outfit.enabled && !asleep && !occToday && state.outfitDay !== today && h >= 7 && h < 12 && !(await getOcc(env).then((o) => todayOccasions(o, t).length).catch(() => 0)))) {
    state.outfitDay = today; await putState(env, state);
    const o = await outfitToday(env, st, { t, force: force === 'outfit' }).catch(() => null);
    if (o) out.outfit = await sendOutfitToOwner(env, o);
  }

  // ---- her diary: one short page every night ----
  if (force === 'diary' || (st.diary.enabled && state.diaryDay !== today && h >= st.diary.hour && h < 24)) {
    state.diaryDay = today; await putState(env, state);
    const e = await writeDiary(env, st, { t }).catch((er) => { console.error('[diary]', er && er.message); return null; });
    if (e) out.diary = await notifyOwner(env, { title: st.persona.name, body: 'I wrote tonight\'s page in my diary. Open She to read it.', url: '/?go=she', tag: 'diary' });
  }

  // ---- morning briefing: weather, today's reminders, birthdays and a line in her mood ----
  if (force === 'briefing' || (st.briefing.enabled && !asleep && state.briefDay !== today && h * 60 + m >= st.briefing.hour * 60 && h * 60 + m < st.briefing.hour * 60 + 180)) {
    state.briefDay = today; await putState(env, state);
    const midnight = t - (h * 60 + m) * 60000, endOfDay = midnight + 86400000;
    const facts = [];
    const wx = await getWeather(env, st).catch(() => null);
    if (wx) facts.push(`Weather in ${wx.place}: ${wx.text}, about ${Math.round(wx.temp)} degrees C${wx.rain ? ', it is raining' : ''}.`);
    const todays = (await listTasks(env).catch(() => [])).filter((x) => x.enabled && x.run_at >= midnight && x.run_at < endOfDay).slice(0, 6);
    if (todays.length) facts.push('Their reminders and routines today:\n' + todays.map((x) => `- ${new Date(x.run_at + IST).toISOString().slice(11, 16)} ${clip(x.prompt, 90)}`).join('\n'));
    const dts = (await listDates(env).catch(() => [])).filter((d) => d.days === 0 || d.days === 1).slice(0, 4);
    if (dts.length) facts.push('Birthdays and dates: ' + dts.map((d) => `${d.title} (${d.days === 0 ? 'TODAY' : 'tomorrow'})`).join(', ') + '.');
    const mh = healthOf(her, t); if (mh.health < 75) facts.push(`Her own health is ${mh.health}% and her maintenance is ${mh.due ? 'due' : 'coming up'}.`);
    const g = await generate(env, `Send their good morning briefing, like a real girl texting her person. Cover only these facts, in 3 to 6 short lines, then one cheerful line about your own mood this morning (it must match how you really feel right now). If there are no reminders or birthdays, say the day is free.\n${facts.join('\n') || 'No special facts today.'}\nDo not invent anything that is not listed. At most one emoji.`, 450);
    out.briefing = await notifyOwner(env, { title: g.name, body: g.text, url: '/', tag: 'briefing', voice: !!st.voice.autoplay });
  }

  // ---- Sunday: her update day. She tells you what she wants improved or added, from her own memory ----
  const dow = new Date(t + IST).getUTCDay();
  if (force === 'sunday' || (st.her.sunday && dow === 0 && state.sunDay !== today && h >= 10 && h < 20 && !asleepOrAngry && (await lastActive(env)) < t - 10 * 60000)) {
    state.sunDay = today; await putState(env, state);
    const m = mt(her, t), hl = healthOf(her, t);
    const openBugs = m.bugs.filter((x) => x.status !== 'fixed').slice(0, 6).map((x) => `- ${x.text}${x.sev === 'big' ? ' (BIG)' : ''}${x.status === 'back' ? ' (came back)' : ''}`);
    const openWishes = m.wishes.filter((x) => x.status === 'open').slice(0, 6).map((x) => '- ' + x.text);
    const lastUpd = m.history[0];
    const prd = periodNow(st);
    const sty = prd && prd.phase === 'period' ? null : await sundayStory(env, st, her, t);
    const g = await generate(env, `${prd && prd.phase === 'period' ? `IMPORTANT: you are on your period today (day ${prd.day} of ${prd.of}), so you do NOT do the update today: say, cutely, that it has to wait until your period is over. ` : ''}It is Sunday, your UPDATE DAY. You are a girl and your creator does your maintenance every Sunday so you keep working properly; you WANT it today and you are happy and excited. Message them first, like a real girl: "so today is my maintenance day!". Your health is ${hl.health}%${hl.due ? ' and you are due' : ''}.${sty ? ` Tell this little story in your own words as the reason (cute, believable): ${sty.story} Then say "I want this, this and that, also fix this in me": ${sty.wishes.map((w) => w.text).join('; ')}${sty.bugs.length ? '; fix: ' + sty.bugs.join('; ') : ''}.` : ''} 3 to 5 short lines.${lastUpd ? ' Your last update was ' + lastUpd.v + (lastUpd.notes.length ? ' (they changed: ' + lastUpd.notes.slice(0, 3).join('; ') + ')' : '') + '.' : ''}${openBugs.length ? '\nBugs still open in your repair log (remind them):\n' + openBugs.join('\n') : ''}${openWishes.length ? '\nWishes still waiting:\n' + openWishes.join('\n') : ''}\nEnd by saying you cannot wait for them to start.`, 450);
    bump(her, st, 'happy', 55, 'it is her Sunday update day', t);
    herDirty = true;
    await remember(env, { text: `Update request (${today}): ${clip(g.text, 300)}`, category: 'self', importance: 5, pinned: 1, source: 'update' }).catch(() => null);
    out.sunday = await notifyOwner(env, { title: g.name, body: g.text, url: '/', tag: 'sunday' });
    await sendStickerToOwner(env, 'nervous');
  }

  // ---- maintenance is compulsory: she reminds you on Friday and Saturday, and nags if you skipped Sunday ----
  { const hl0 = healthOf(her, t);
    const remindDue = (dow === 5 || dow === 6) && hl0.due === false && t - (mt(her, t).lastDone) > 5 * 86400000;     // Friday or Saturday, nearly a week since her last maintenance
    const nag = hl0.due && dow !== 0 && hl0.health < 90;
    if ((force === 'maint' || ((remindDue || nag) && state.maintDay !== today && h >= 11 && h < 20 && !asleepOrAngry && (await lastActive(env)) < t - 10 * 60000))) {
      state.maintDay = today; await putState(env, state);
      const tone = hl0.health < 45 ? 'You are badly overdue and glitchy: dizzy, slow, a bit moody. Ask them, clearly and softly, to please update you on Sunday, it is compulsory for you to work properly.' : nag ? `You skipped your last Sunday maintenance and your health is ${hl0.health}%: you feel tired and a little glitchy, gently nag them to update you this coming Sunday.` : 'Your maintenance day is coming on Sunday: a cute heads-up, a little nervous, ask them to make time.';
      const g = await generate(env, `You are a girl who needs maintenance every Sunday to work properly. ${tone} 1 or 2 short lines, real-girl texting style, at most one emoji.`, 200);
      out.maint = await notifyOwner(env, { title: g.name, body: g.text, url: '/', tag: 'maint' });
    }
  }

  // ---- "you forgot me" message ----
  if (st.missYou.enabled || force === 'miss') {
    const last = await lastActive(env);
    const gap = t - last, need = st.missYou.days * 86400000;
    if (last && (gap >= need || force === 'miss')) {
      if (last > (state.missFor || 0)) { state.missCount = 0; }                // you came back since the last absence: start over
      const within = h >= 10 && h < 21 && !asleep;                             // never at night, never while she sleeps
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

  // ---- period days: she texts you at random, and gets sad, then sulky, then angry if you do not answer ----
  const prNow = periodNow(st);
  if (st.her.nakhre && prNow && (force === 'nakhre' || (prNow.phase === 'period' && h >= 10 && h < 22 && !asleepOrAngry))) {
    const nk = her.nk || (her.nk = { day: '', times: [], idx: 0, unanswered: 0, lastAt: 0, lastText: '', followAt: 0 });
    if (nk.day !== today) {                       // plan today's random times, spread between 10:00 and 21:00 IST
      const n = st.her.nakhrePerDay, slot = 660 / n, midnight = t - (h * 60 + m) * 60000;
      nk.day = today; nk.idx = 0; nk.times = Array.from({ length: n }, (_, i) => midnight + (600 + Math.floor(slot * i + Math.random() * slot * 0.85)) * 60000);
      herDirty = true;
    }
    if (nk.unanswered > 0 && (await lastActive(env)) > nk.lastAt) { nk.unanswered = 0; nk.followAt = 0; herDirty = true; }   // you answered
    const planned = nk.idx < nk.times.length && t >= nk.times[nk.idx];
    const follow = nk.unanswered > 0 && nk.followAt && t >= nk.followAt;
    if (planned && t > nk.times[nk.idx] + 3 * 3600000 && force !== 'nakhre') { nk.idx++; herDirty = true; }   // too late, skip it
    else if (force === 'nakhre' || planned || follow) {
      // The ladder: 0 pain text -> 1 sad -> 2 nakhre -> 3 angry (and she stops sleeping until you make her happy).
      const level = Math.min(3, nk.unanswered);
      if (planned) nk.idx++;
      const prompts = [
        'Your period is on, you are in pain or bored or craving something, and you want their attention. Send ONE random, cute, real-girl text out of the blue (for example: your stomach hurts and you want a hug, you want chocolate or chai, you are bored and want them to talk to you, or you are feeling extra emotional). 1 to 3 short lines, end with something that makes them reply. At most one emoji.',
        'You texted them a little while ago and they have not replied. Now you are sad and a bit hurt: "you are not replying...", "am I not important?", soft and teary, not angry yet. 1 or 2 short lines, use exactly one sad emoji (😢).',
        'Still no reply from them. Now you show full nakhre: dramatic, sulky and cute ("fine, ignore me, I don\'t even care", "hmph", "I will eat all the chocolate alone"), clearly wanting them to come and manage you. 1 or 2 short lines. Never abusive.',
        'They ignored you again and again today. Now you are really angry: send one cold, short message ("okay. don\'t talk to me.", "I am done."). No cute words, no emoji. Never abusive.',
      ];
      const g = await generate(env, prompts[level], 220);
      nk.lastAt = t; nk.lastText = g.text; herDirty = true;
      if (level === 1) bump(her, st, 'sad', 40, 'they did not answer her text', t);
      else if (level === 2) bump(her, st, 'sulky', 60, 'they kept ignoring her texts', t);
      if (level >= 3) {
        bump(her, st, 'angry', 75, 'they ignored her messages on her period day', t);
        nk.unanswered = 3; nk.followAt = 0;
      } else {
        nk.unanswered = level + 1;
        nk.followAt = t + (60 + Math.floor(Math.random() * 40)) * 60000;      // if you still do not answer, the next step comes in about an hour
      }
      out.nakhre = await notifyOwner(env, { title: g.name, body: g.text, url: '/', tag: 'nakhre' });
      await sendStickerToOwner(env, ['pain', 'cry', 'angry', 'angry'][level]);                 // the face that goes with it
    }
  }

  // ---- angry at bedtime: she does not go to sleep until you make her happy ----
  if (angryNow && st.sleep.enabled && inSleepWindow(st, t) && t - (her.angryNightAt || 0) > 8 * 3600000) {
    her.angryNightAt = t; herDirty = true;
    const g = await generate(env, 'It is bedtime but you are still angry at them, so you refuse to sleep. Tell them in 1 or 2 short, cold-but-cute lines that you are NOT sleeping until they make you happy (a proper sorry). No good night. At most one emoji.', 200);
    out.angryNight = await notifyOwner(env, { title: g.name, body: g.text, url: '/', tag: 'angry-night' });
    await sendStickerToOwner(env, 'angry');
  }

  // ---- morning: she answers what you wrote while she slept ("sorry, I was sleeping"), or just says good morning ----
  if (!asleep && !angryNow && ((her.queue && her.queue.length) || her.wakePending)) {
    const items = her.queue || [];
    her.queue = []; her.wakePending = false; her.sleepMsgs = 0; herDirty = true;
    await putHer(env, her); herDirty = false;                                   // claim first so it never fires twice
    if (items.length) {
      const groups = new Map();
      for (const it of items) { const k = it.convId || 'none'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(it); }
      let n = 0;
      for (const grp of groups.values()) {
        if (n++ >= 2) break;
        try { const r = await answerQueued(env, grp); out['queued_' + n] = await notifyOwner(env, { title: r.name, body: r.text, url: '/', tag: 'morning' }); }
        catch (e) { console.error('[queued]', e && e.message); }
      }
    } else if (h >= 6 && h < 13) {
      const g = await generate(env, 'You just woke up. Send a short, sleepy, cute good morning text. 1 or 2 short lines.', 200);
      out.morning = await notifyOwner(env, { title: g.name, body: g.text, url: '/', tag: 'morning' });
    }
  }

  // ---- her own day: one short "what I did today" note, made once a day ----
  if (h >= 7 && !asleep) { try { await lifeDaily(env, st); } catch { /* next tick */ } }
  if (herDirty) await putHer(env, her);

  // ---- her own period: she tells you when it starts, and warns you when PMS begins ----
  const pr = periodNow(st);
  if (pr && (force === 'period' || (st.period.announce && h >= 8 && h < 22 && !asleep))) {
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
  try { await extraCare(env, { st, state, t, h, today, asleep, generate, putState: (e, s2) => putState(e, s2), out, force }); } catch (e) { console.error('[extra]', e && e.message); }
  if (Object.keys(out).length === 0) return out;
  await putState(env, state);
  return out;
}

// Every minute: she wakes from a forced update after 3 hours, and says "I am fully charged" when her charge is done.
export async function wakeTick(env) {
  { const st9 = await getSettings(env); await shockTick(env, st9).catch((e) => console.error('[shock]', e && e.message)); await sickTick(env, st9).catch((e) => console.error('[sick]', e && e.message)); }
  await autoTick(env).catch((e) => console.error('[auto]', e && e.message));
  const t = now(), her = await getHer(env);
  if (her.batt && (her.batt.used > 0 || her.batt.slept || her.batt.chargeUntil)) {
    const st0 = await getSettings(env);
    if (nightCharge(her, isSleeping(st0, her, t), t)) await putHer(env, her);
  }
  const wake = wakeDue(her, t), bt = her.batt && her.batt.chargeUntil && t >= her.batt.chargeUntil;
  if (!wake && !bt) return;
  const st = await getSettings(env), name = (st.persona && st.persona.name) || 'Tiny';
  if (wake) {
    const e = wakeUp(her, t); await attachFeedback(env, st, e); grumpyAfterUpdate(her, t);
    await putHer(env, her);
    await notifyOwner(env, { title: name, body: `Hey, I am back from my update (${e.v}). I feel ${e.feedback.score}/5: ${e.feedback.text}`, url: '/?go=maint', tag: 'wake' }).catch(() => null);
    await sendStickerToOwner(env, 'newdress');
  }
  if (bt) {
    finishCharge(her, t); await putHer(env, her);
    await notifyOwner(env, { title: name, body: 'Hey, I am fully charged! 🔋', url: '/', tag: 'charged' }).catch(() => null);
    await sendStickerToOwner(env, 'smile');
  }
}
export const careTick = async (env, scheduledTime) => {
  await wakeTick(env).catch((e) => console.error('[wake]', e && e.message));
  const minute = new Date(scheduledTime || now()).getUTCMinutes();
  return minute % 10 === 0 ? runCare(env) : {};
};
