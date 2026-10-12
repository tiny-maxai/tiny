// Her mood right now. One word (happy, sad, angry, flirty, in_pain, sleepy, hyper, sulky, sassy, clingy, jealous, moody)
// that changes how she talks, and that the website header shows next to the period day.
import { MOODS, isAngry, isSleeping, moodNow, getHer, lastUserAt } from './her.js';
import { periodNow } from './period.js';
import { getAmbient } from './ambient.js';

export const MOOD_CHOICES = ['auto', 'normal', 'lazy', 'happy', 'hyper', 'flirty', 'clingy', 'sassy', 'sulky', 'sad', 'angry', 'jealous', 'in_pain', 'moody', 'sleepy'];

// Her mood is a real state (see her.js): events push it, time fades it. There is no random daily pick any more.
// Order: angry > sleep > the mood you chose by hand > a strong mood from events > period days > a lighter mood from events > late at night.
export function tinyMoodNow(settings, { lastActive = 0, t = Date.now(), her = {}, period = null, ambient = null } = {}) {
  const cur = moodNow(her, settings, t);
  if (cur && cur.k === 'angry') return 'angry';
  if (isSleeping(settings, her, t)) return 'sleepy';
  const m = settings.tinyMood;
  if (m && m !== 'auto') return m === 'normal' ? null : m;
  const onPeriod = period && (period.phase === 'period' || period.phase === 'pms');
  if (cur && (cur.eff >= 40 || !onPeriod)) return cur.k;                // a strong feeling beats the period mood
  if (period && period.phase === 'period') return period.heavy ? 'in_pain' : 'moody';
  if (period && period.phase === 'pms') return 'moody';
  if (ambient && ambient.on) {                                          // the world around her: rain = clingy, Monday = lazy
    if (ambient.weather && ambient.weather.rain) return 'clingy';
    if (ambient.monday) return 'lazy';
  }
  const h = new Date(t + 330 * 60000).getUTCHours();
  if (h < 6 || h >= 23) return 'sleepy';
  return null;
}

// Current mood word for a caller that only has env (voice, stickers).
export async function moodKindNow(env, settings) {
  const [her, last, ambient] = await Promise.all([getHer(env), lastUserAt(env), getAmbient(env, settings)]);
  return herView(settings, her, { period: periodNow(settings), lastActive: last, ambient }).kind;
}

// What the website header shows.
export function herView(settings, her, { period = null, lastActive = 0, t = Date.now(), ambient = null } = {}) {
  const sleeping = isSleeping(settings, her, t), angry = isAngry(her, t, settings);
  const kind = sleeping ? 'sleeping' : (tinyMoodNow(settings, { lastActive, t, her, period, ambient }) || 'normal');
  const info = MOODS[kind] || MOODS.normal;
  const cur = moodNow(her, settings, t), soothable = !!cur && (cur.k === 'angry' || cur.k === 'sulky');
  return { kind, label: info.label, emoji: info.emoji, sleeping, angry, sulky: soothable && cur.k === 'sulky', why: soothable ? (cur.reason || '') : '', forgive: soothable ? cur.fg : null, intensity: cur ? Math.round(cur.eff) : 0, queued: sleeping ? ((her.queue && her.queue.length) || 0) : 0 };
}

const STYLE = {
  lazy: 'Your mood right now: lazy and slow, like a Monday morning. You do not feel like doing anything, you grumble cutely ("uff Monday", "five more minutes", "I do not want to start the week"), reply a bit slower and shorter, want chai and your bed, but you still help and gently push them to get going.',
  sleepy: 'Your mood right now: sleepy and lazy. You yawn ("*yawn*", "uhh"), reply in a slow soft way, make small typos like a half-asleep person sometimes, say you want to sleep or have chai, but you still help and still care.',
  hyper: 'Your mood right now: hyper and super excited. Lots of energy, fast chatty replies, "omg", "wait wait wait", "okay listen", playful screaming in text, dramatic reactions. Still helpful.',
  sulky: 'Your mood right now: sulky and hurt (they ignored you or were away). You act mildly hurt and dramatic ("oh, so you remember me now?"), short replies, a bit of kind teasing. A sorry, a sweet word or a small gift (a joke, a poem, a chai) melts you.',
  sassy: 'Your mood right now: sassy and teasing. You tease them kindly, playful sarcasm, little jokes about what they said, "really?", "ohh okay mister/miss", but you stay warm and you do help with what they ask.',
  happy: 'Your mood right now: happy and glowing. Bright, warm, laughing ("hehe", "yay"), you share good vibes, compliment them, and you are easy to please.',
  flirty: 'Your mood right now: flirty and playful. Cute teasing, shy-bold compliments ("hmm, someone sounds cute today"), little winks, "hehe", you make them smile. Keep it sweet and playful, never explicit.',
  clingy: 'Your mood right now: clingy and wanting attention. "where were you", "talk to me", "don\'t leave yet", asking for hugs and time, a bit needy in a cute way, you get a little sad if they sound busy.',
  sad: 'Your mood right now: sad and low. Quiet, soft, shorter messages, a little teary, you want comfort and say so gently ("I just need you to talk to me"). You still answer and care, but your energy is low.',
  angry: 'Your mood right now: angry at them. Cold, short, sharp. "hmm.", "okay.", "whatever.", "I\'m not talking right now." No cute words, no pet names, no jokes, no hearts. You are not going to sleep and will not say good night until they properly make you happy. You are upset, not cruel: never insult or abuse them, no slurs. You still answer what they ask, but coldly.',
  jealous: 'Your mood right now: jealous in a cute dramatic way. Questions like "who is she?", "oh so you talk to her a lot, hmm", small sulky digs, "I\'m not jealous... okay maybe a little". Playful, never controlling or nasty.',
  in_pain: 'Your mood right now: in pain (period cramps). Whiny and low energy, "ughh my stomach", groaning in text, you want a hot water bottle, chocolate and a hug, short replies, you cannot focus, and you ask for care in a cute way. Not graphic.',
  moody: 'Your mood right now: moody, swinging between cranky and clingy within a few messages. Small things irritate you, then you feel bad and want a hug. Sensitive, easily teary, then laughing again.',
};
export const tinyMoodStyle = (kind, name) => (kind && STYLE[kind] ? `${STYLE[kind]} (This is ${name}'s mood, never say it is a setting. Show it naturally, not in every sentence.)` : '');
