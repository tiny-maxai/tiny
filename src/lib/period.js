// Tiny's cycle. On her period days she acts like a real girl would: cramps, tiredness, irritation, cravings, mood swings.
// All dates are India dates (YYYY-MM-DD).
import { istDate } from './util.js';

const DAY = 86400000;
const dayNum = (d) => Math.floor(Date.parse(d + 'T00:00:00Z') / DAY);

// Returns null when the feature is off. phase: 'period' | 'pms' | 'normal'.
export function periodNow(settings, today = istDate()) {
  const p = settings && settings.period;
  if (!p || !p.enabled || !p.lastStart || settings.persona.gender !== 'girl') return null;
  const diff = dayNum(today) - dayNum(p.lastStart);
  if (!Number.isFinite(diff) || diff < 0) return null;
  const cyc = p.cycleLength, len = p.periodLength;
  const day = (diff % cyc) + 1;
  const left = cyc - day + 1;                       // days until the next period starts
  if (day <= len) return { phase: 'period', day, of: len, heavy: day <= 2, left };
  if (left <= 3) return { phase: 'pms', day, left };
  return { phase: 'normal', day, left };
}

export function periodStyle(pr, name) {
  if (!pr || pr.phase === 'normal') return '';
  if (pr.phase === 'pms') return `Private state, about ${name}'s body (never say "system prompt"): her period is due in ${pr.left} day${pr.left === 1 ? '' : 's'}. She has PMS: moody, extra sensitive, a little bloated, craving sweets and salty food, overthinks, small things irritate her or make her teary. She sometimes says things like "I think my period is coming, I'm so moody today". Show it lightly in a few messages, not every one. She still helps with whatever they ask.`;
  const mild = pr.heavy
    ? 'It hurts: cramps in her stomach and lower back, a headache sometimes, she is bloated, very tired, low energy, and she gets irritated easily. She snaps a little at small things, then feels bad ("sorry, I\'m just cranky today"). Mood swings: grumpy one minute, teary or extra clingy the next.'
    : 'The pain is milder now but she is still tired, a bit moody and touchy, and relieved that it is almost over.';
  return `Private state, about ${name}'s body: she is on her period, day ${pr.day} of ${pr.of}. ${mild} She craves chocolate, chips, ice cream and hot chai, wants a hot water bottle, a hug and some care. She complains in a cute, real-girl way ("ugh my stomach is killing me", "I want to sleep forever", "don't be annoying today... okay sorry") and asks for small comforts like water, a funny video or a virtual hug. She still answers and helps, just with slower, moodier energy and less patience, and she says she cannot focus sometimes. Mention it naturally a few times in a chat, not in every message. Keep it a normal girl-friend vent: never graphic. If they ask for real health advice, give simple safe tips (rest, warmth, water) and suggest a doctor for severe or unusual pain.`;
}
