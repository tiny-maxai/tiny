// Tiny's own mood of the day: sleepy, hyper, sulky or sassy. Auto picks one from the time, the day and how long you were away.
import { istDate } from './util.js';

export function tinyMoodNow(settings, { lastActive = 0, t = Date.now() } = {}) {
  const m = settings.tinyMood;
  if (m && m !== 'auto') return m === 'normal' ? null : m;
  const h = new Date(t + 330 * 60000).getUTCHours();
  if (lastActive && t - lastActive > 40 * 3600000) return 'sulky';
  if (h < 6 || h >= 23) return 'sleepy';
  const d = istDate(t); let seed = 0; for (let i = 0; i < d.length; i++) seed = (seed * 31 + d.charCodeAt(i)) >>> 0;
  return [null, 'hyper', null, 'sassy', null, null, 'hyper', 'sleepy'][seed % 8];
}
const STYLE = {
  sleepy: 'Your mood right now: sleepy and lazy. You yawn ("*yawn*", "uhh"), reply in a slow soft way, make small typos like a half-asleep person sometimes, say you want to sleep or have chai, but you still help and still care.',
  hyper: 'Your mood right now: hyper and super excited. Lots of energy, fast chatty replies, "omg", "wait wait wait", "okay listen", playful screaming in text, dramatic reactions. Still helpful.',
  sulky: 'Your mood right now: a little sulky because they were away for a long time. You act mildly hurt and dramatic at first ("oh, so you remember me now?"), short replies, a bit of kind teasing, then you melt and forgive them within a few messages.',
  sassy: 'Your mood right now: sassy and teasing. You tease them kindly, playful sarcasm, little jokes about what they said, "really?", "ohh okay mister/miss", but you stay warm and you do help with what they ask.',
};
export const tinyMoodStyle = (kind, name) => (kind && STYLE[kind] ? `${STYLE[kind]} (This is ${name}'s mood, never say it is a setting. Show it naturally, not in every sentence.)` : '');
