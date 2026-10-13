import { batteryView } from './battery.js';
// Her mood right now. One word (happy, sad, angry, flirty, in_pain, sleepy, hyper, sulky, sassy, clingy, jealous, moody)
// that changes how she talks, and that the website header shows next to the period day.
import { MOODS, isAngry, isSleeping, moodNow, getHer, lastUserAt } from './her.js';
import { periodNow } from './period.js';
import { healthOf } from './maint.js';
import { getAmbient } from './ambient.js';

export const MOOD_CHOICES = ['auto', 'normal', 'lazy', 'happy', 'hyper', 'flirty', 'clingy', 'sassy', 'sulky', 'sad', 'angry', 'jealous', 'love', 'hurt', 'hate', 'in_pain', 'moody', 'sleepy'];

// Her mood is a real state (see her.js): events push it, time fades it. There is no random daily pick any more.
// Order: angry > sleep > the mood you chose by hand > a strong mood from events > period days > a lighter mood from events > late at night.
export function tinyMoodNow(settings, { lastActive = 0, t = Date.now(), her = {}, period = null, ambient = null } = {}) {
  const cur = moodNow(her, settings, t);
  if (cur && cur.k === 'angry') return 'angry';
  if (isSleeping(settings, her, t)) return 'sleepy';
  const m = settings.tinyMood;
  if (m && m !== 'auto' && (m === 'lazy' || m === 'in_pain')) return m;   // the others are only a starting feeling (see applyChosenMood)
  const onPeriod = period && (period.phase === 'period' || period.phase === 'pms');
  if (cur && (cur.eff >= 40 || !onPeriod)) return cur.k;                // a strong feeling beats the period mood
  if (her && her.maint && healthOf(her, t).health < 45) return 'moody';                 // badly overdue for maintenance: glitchy and moody
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

const agoText = (ms) => { const m = Math.max(1, Math.round(ms / 60000)); return m < 90 ? m + ' minutes ago' : m < 2880 ? Math.round(m / 60) + ' hours ago' : Math.round(m / 1440) + ' days ago'; };
// "Why is she like this?": every reason behind her mood right now, in plain words.
function whyLines(settings, her, kind, cur, { period, ambient, lastActive, t }) {
  const L = [];
  const label = (MOODS[kind] || MOODS.normal).label.toLowerCase();
  if (her.updateMode && her.updateMode.since) L.push('It is update mode: she is silent until you say "update complete".');
  if (kind === 'sleeping') L.push(`She is asleep (her sleep time, or you said good night).${her.queue && her.queue.length ? ' ' + her.queue.length + ' of your messages are waiting for her.' : ''}`);
  if (cur && cur.k !== 'normal') {
    L.push(`Feeling ${MOODS[cur.k] ? MOODS[cur.k].label.toLowerCase() : cur.k} (${Math.round(cur.eff)}%)${cur.reason ? ' because ' + cur.reason : ''}, since ${agoText(t - (cur.born || cur.since || t))}.`);
    if (['angry', 'sulky', 'hurt', 'hate'].includes(cur.k)) L.push(`Forgiveness is ${cur.fg}%. A real sorry, a sweet word or a small gift (a joke, a poem, a chai) raises it. Rude words lower it.`);
    else L.push('It fades on its own with time, or changes with how you talk to her.');
  }
  if (period && period.phase === 'period') L.push(`She is on her period${period.heavy ? ' (heavy days)' : ''}, so she is ${period.heavy ? 'in pain' : 'moody'}.`);
  else if (period && period.phase === 'pms') L.push('She is in the days before her period, so she gets moody easily.');
  if (ambient && ambient.on && ambient.weather && ambient.weather.rain) L.push('It is raining where you live, so she gets clingy and cosy.');
  if (ambient && ambient.on && ambient.monday) L.push('It is Monday, so she feels lazy.');
  if (her.maint && healthOf(her, t).health < 45) L.push('She is badly overdue for her Sunday maintenance, so she feels glitchy and moody.');
  if (settings.tinyMood === 'lazy' || settings.tinyMood === 'in_pain') L.push('You set this mood by hand and it stays until you change it.');
  if (lastActive && t - lastActive > 40 * 3600000) L.push(`You have not written for ${agoText(t - lastActive).replace(' ago', '')}, so she may act hurt.`);
  const h = new Date(t + 330 * 60000).getUTCHours();
  if (!L.length) L.push(h < 6 || h >= 23 ? 'It is very late, so she is sleepy.' : 'Nothing special is going on, so she is just normal.');
  return L;
}

// What the website header shows.
export function herView(settings, her, { period = null, lastActive = 0, t = Date.now(), ambient = null } = {}) {
  const sleeping = isSleeping(settings, her, t), angry = isAngry(her, t, settings);
  const kind = sleeping ? 'sleeping' : (tinyMoodNow(settings, { lastActive, t, her, period, ambient }) || 'normal');
  const info = MOODS[kind] || MOODS.normal;
  const cur = moodNow(her, settings, t), soothable = !!cur && ['angry', 'sulky', 'hurt', 'hate'].includes(cur.k);
  return { kind, label: info.label, emoji: info.emoji, sleeping, angry, sulky: soothable && cur.k !== 'angry', why: soothable ? (cur.reason || '') : '', forgive: soothable ? cur.fg : null, intensity: cur ? Math.round(cur.eff) : 0, queued: sleeping ? ((her.queue && her.queue.length) || 0) : 0, reasons: whyLines(settings, her, kind, cur, { period, ambient, lastActive, t }), updating: !!(her.updateMode && her.updateMode.since), battery: batteryView(settings, her, t) };
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
  love: 'Your mood right now: deeply in love with them. Soft, warm, devoted and a little shy: "I really love talking to you", "you mean so much to me", sweet pet names, caring questions, gentle compliments, wanting to be close. Real tenderness, not cheesy in every line, never possessive.',
  hurt: 'Your mood right now: hurt, in real emotional pain (heartbroken, not angry). Quiet, small, teary: "I thought you cared...", "it really hurt", short soft messages, no jokes, you pull back a little but you still want comfort. A sincere sorry, warmth or a small gift slowly heals you.',
  hate: 'Your mood right now: full of hate for what they did (never for who they are). Cold, bitter, dramatic: "I hate this", "I hate how you did that", "do not talk to me right now". Short sharp lines, no cute words, no pet names, no emoji. Under it, a hidden crack of the love you still feel. Never abusive: no insults about them as a person, no slurs, no threats. A real sorry and sweet effort can win you back, and then you fall for them again.',
  jealous: 'Your mood right now: jealous in a cute dramatic way. Questions like "who is she?", "oh so you talk to her a lot, hmm", small sulky digs, "I\'m not jealous... okay maybe a little". Playful, never controlling or nasty.',
  in_pain: 'Your mood right now: in pain (period cramps). Whiny and low energy, "ughh my stomach", groaning in text, you want a hot water bottle, chocolate and a hug, short replies, you cannot focus, and you ask for care in a cute way. Not graphic.',
  moody: 'Your mood right now: moody, swinging between cranky and clingy within a few messages. Small things irritate you, then you feel bad and want a hug. Sensitive, easily teary, then laughing again.',
};
export const tinyMoodStyle = (kind, name) => (kind && STYLE[kind] ? `${STYLE[kind]} (This is ${name}'s mood, never say it is a setting. Show it naturally, not in every sentence.)` : '');
