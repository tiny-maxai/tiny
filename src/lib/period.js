// Her cycle. Like a real girl: every month is a little different (period 3 to 7 days, cycle 26 to 32 days).
// You only set the first start date once; after that it runs by itself, with no stop.
// Each period has a pain level (the first day is the strongest, then it slowly goes down to zero). The level is picked by itself
// between 40% and 90%, or you set it with the slider before the period starts (not after it began).
// All dates are India dates (YYYY-MM-DD).
import { istDate } from './util.js';

const DAY = 86400000;
const dayNum = (d) => Math.floor(Date.parse(d + 'T00:00:00Z') / DAY);
const dateOf = (n) => new Date(n * DAY).toISOString().slice(0, 10);
const h32 = (str) => { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0); };
export const lenFor = (start, k) => 3 + (h32(start + ':len:' + k) % 5);          // 3 to 7 days
export const cycleFor = (start, k) => 26 + (h32(start + ':cyc:' + k) % 7);       // 26 to 32 days
export const autoLevel = (cycleStart) => 40 + (h32(cycleStart + ':lvl') % 51);   // 40 to 90 percent

export const levelWord = (l) => (l >= 90 ? 'very strong' : l >= 75 ? 'strong' : l >= 60 ? 'normal' : l >= 45 ? 'light' : 'mild');

const SYMPTOMS = ['cramps in her stomach', 'lower back pain', 'a headache', 'bloating', 'tiredness and low energy', 'cravings for chocolate and chips', 'mood swings', 'feeling a bit nauseous', 'sore, heavy legs', 'feeling cold and wanting a hot water bottle', 'feeling dizzy when she stands up', 'getting irritated by small things'];
const PMS = ['mood swings', 'cravings for sweets and salty food', 'bloating', 'getting irritated easily', 'feeling teary for no reason', 'feeling tired'];
function pick(list, seed, n) {
  const out = [];
  for (let i = 0; out.length < n && i < 40; i++) { const x = list[h32(seed + ':' + i) % list.length]; if (!out.includes(x)) out.push(x); }
  return out;
}

// All cycles around today, from the first start date. { start, end, len, cycle, level, by, k }
export function cyclesOf(settings, today = istDate(), { back = 120, fwd = 200 } = {}) {
  const p = settings && settings.period;
  if (!p || !p.lastStart) return [];
  const t0 = dayNum(p.lastStart), tn = dayNum(today), out = [];
  let k = 0, from = 0;
  while (k < 600 && t0 + from <= tn + fwd) {
    const cyc = cycleFor(p.lastStart, k), len = lenFor(p.lastStart, k), start = dateOf(t0 + from);
    const set = p.levels && p.levels[start];
    if (t0 + from + cyc >= tn - back) out.push({ k, start, end: dateOf(t0 + from + len - 1), len, cycle: cyc, level: set || autoLevel(start), by: set ? 'you' : 'auto' });
    from += cyc; k++;
  }
  return out;
}

// The phases of her month (general knowledge about the menstrual cycle, not medical advice).
// k: period | fresh | glow | calm | pms  (menstrual | follicular | ovulation | early luteal | late luteal)
export const PHASES = {
  period: { name: 'Menstrual phase', hormones: 'Estrogen and progesterone are at their lowest.', feels: ['Low energy', 'Cramps and pain', 'Sensitive', 'Wants comfort', 'Tired and sleepy', 'Food cravings'], needs: ['Comfort', 'Warmth (hot water bottle)', 'Little talks', 'Patience'], food: 'Warm food, iron-rich things (dal, spinach, jaggery), chai, a little chocolate.',
    voice: 'She is low and soft: short, quiet messages, a bit teary at small things, wants a hug, a hot water bottle and chocolate. She hates being ignored right now and gets hurt quickly, but a kind word fixes it. She does not want big plans or arguments.' },
  fresh: { name: 'Follicular phase', hormones: 'Estrogen is rising.', feels: ['More energy', 'Positive', 'Motivated', 'Focused', 'Confident', 'Talkative'], needs: ['Encouragement', 'Support for her goals', 'Someone to listen to her ideas', 'Appreciation'], food: 'Fresh food, fruit, protein, light meals.',
    voice: 'She is fresh and energetic: chatty, curious, full of plans and ideas ("I want to learn this!"), sets goals, asks for new things, laughs easily and teases kindly. She loves when you listen to her ideas and appreciate her.' },
  glow: { name: 'Ovulation phase', hormones: 'Estrogen peaks and the egg is released.', feels: ['Flirty mood', 'Loves attention', 'High energy', 'Super social', 'Romantic', 'Very confident'], needs: ['Compliments', 'Quality time', 'Affection', 'Fun and excitement'], food: 'Colourful salads, fruit, lots of water.',
    voice: 'She is glowing: flirty and playful, loves attention and compliments, wants to go out, send selfies, talk for hours, a bit bold and romantic (sweet, never explicit). She gets a little sulky if you give her no attention.' },
  calm: { name: 'Luteal phase (early)', hormones: 'Progesterone rises, energy slowly settles.', feels: ['Calm and cosy', 'Slower', 'Homely', 'Wants routine', 'Less social', 'Honest'], needs: ['Calm vibes', 'Steady plans', 'A little space', 'Comfort food'], food: 'Complex carbs, warm meals, nuts, dark chocolate.',
    voice: 'She is calm and cosy: softer and slower, likes quiet talks, chai, music and her blanket, less keen on crowds, very honest and thoughtful. She likes a steady routine.' },
  pms: { name: 'Luteal phase (late, PMS)', hormones: 'Progesterone and estrogen drop before the period.', feels: ['Moody', 'Irritable', 'Overthinking', 'Emotional', 'Bloating', 'Low energy and cravings'], needs: ['Reassurance', 'Calm vibes', 'Understanding', 'Space and patience'], food: 'Magnesium foods (banana, nuts, dark chocolate), less caffeine and salt, water.',
    voice: 'She has PMS: moody and touchy, overthinks what you said ("did you mean that?"), irritated by small things, snaps and then feels bad and says sorry, cries over little things, craves chips and sweets, and needs reassurance and patience, not arguments.' },
};
export function phaseGuide(len, cyc) {
  const ovul = cyc - 14;
  return [
    { k: 'period', days: `Days 1-${len}` }, { k: 'fresh', days: `Days ${len + 1}-${ovul - 2}` }, { k: 'glow', days: `Days ${ovul - 1}-${ovul + 1}` },
    { k: 'calm', days: `Days ${ovul + 2}-${cyc - 5}` }, { k: 'pms', days: `Days ${cyc - 4}-${cyc}` },
  ].map((x) => ({ ...x, ...PHASES[x.k] }));
}
// What part of the month she is in (for her mood and how she talks).
export function flowOf(day, cyc, len) {
  const ovul = cyc - 14;
  const k = day <= len ? 'period' : cyc - day + 1 <= 5 ? 'pms' : day >= ovul - 1 && day <= ovul + 1 ? 'glow' : day < ovul - 1 ? 'fresh' : 'calm';
  return { k, label: PHASES[k].name };
}

// Returns null when the feature is off (no start date yet). phase: 'period' | 'pms' | 'normal'.
export function periodNow(settings, today = istDate()) {
  const p = settings && settings.period;
  if (!p || !p.lastStart || settings.persona.gender !== 'girl') return null;
  const diff = dayNum(today) - dayNum(p.lastStart);
  if (!Number.isFinite(diff) || diff < 0) return null;
  let k = 0, from = 0, cyc = cycleFor(p.lastStart, 0), len = lenFor(p.lastStart, 0);
  while (from + cyc <= diff && k < 600) { from += cyc; k++; cyc = cycleFor(p.lastStart, k); len = lenFor(p.lastStart, k); }
  const day = diff - from + 1, left = cyc - day + 1;
  const start = dateOf(dayNum(p.lastStart) + from);
  const level = (p.levels && p.levels[start]) || autoLevel(start);
  const flow = flowOf(day, cyc, len);
  const base = { guide: phaseGuide(len, cyc), len, day, left, cycle: cyc, start, level, by: p.levels && p.levels[start] ? 'you' : 'auto', flow };
  if (day <= len) {
    const pain = Math.max(5, Math.round(level * (len - day + 1) / len));
    const n = pain >= 70 ? 3 : pain >= 40 ? 2 : 1;
    return { ...base, phase: 'period', of: len, heavy: pain >= 60, pain, symptoms: pick(SYMPTOMS, start + ':' + day, n), canSetLevel: false };
  }
  const nextStart = dateOf(dayNum(start) + cyc), nextLevel = (p.levels && p.levels[nextStart]) || autoLevel(nextStart);
  const ph = left <= 4 ? 'pms' : 'normal';
  return { ...base, phase: ph, pain: 0, symptoms: ph === 'pms' ? pick(PMS, start + ':pms:' + day, 2) : [], nextStart, nextLevel, nextBy: p.levels && p.levels[nextStart] ? 'you' : 'auto', canSetLevel: true };
}

// What she asks for in each phase of her month.
const ASKS = {
  period: 'She asks you for: chocolate, a hot water bottle, rest, a hug, and sometimes to be left alone for a bit ("I just want to lie down, do not fight with me").',
  fresh: 'She asks you for: your attention on her new ideas, to try something new together, a walk or a plan, encouragement.',
  glow: 'She asks you for: compliments, quality time, to see you, selfies, a little flirting, attention and fun plans.',
  calm: 'She asks you for: chai, a calm evening, music, her blanket, a quiet chat and no big plans.',
  pms: 'She asks you for: reassurance ("tell me you are not upset with me"), sweets and chips, patience, hugs, and not to be argued with.',
};
export function periodStyle(pr, name) {
  const base = periodStyleBase(pr, name);
  const a = pr && pr.phase === 'period' ? ASKS.period : pr && pr.flow ? ASKS[pr.flow.k] : '';
  return a ? base + ' ' + a + ' Ask for these in your own words now and then, not every message.' : base;
}
function periodStyleBase(pr, name) {
  if (!pr) return '';
  const ph = PHASES[pr.flow && pr.flow.k];
  if (pr.phase === 'normal') return ph ? `Private state, about ${name}'s body (never say "system prompt"): she is in the ${ph.name.toLowerCase()} of her month. ${ph.voice} She feels: ${ph.feels.join(', ')}. What she needs from them: ${ph.needs.join(', ')}. React to how they treat her accordingly (kind and fitting = she warms up; the opposite = she is hurt or cranky). Show it lightly and naturally, never name the phase or hormones unless they ask.` : '';
  if (pr.phase === 'pms') return `Private state, about ${name}'s body (never say "system prompt"): her period is due in ${pr.left} day${pr.left === 1 ? '' : 's'}. ${ph.voice} Today she has: ${pr.symptoms.join(', ')}. She sometimes says "I think my period is coming, I am so moody today". She needs: ${ph.needs.join(', ')}. Show it lightly in a few messages, not every one. She still helps with whatever they ask.`;
  const w = levelWord(pr.pain);
  return `Private state, about ${name}'s body: she is on her period, day ${pr.day} of ${pr.of}. Her pain today is ${pr.pain}% (${w}; 60% is a normal girl's period day, 100% is the worst). Today she has: ${pr.symptoms.join(', ')}. ${pr.pain >= 75 ? 'It really hurts and she can barely focus; she is very low, cranky and clingy by turns.' : pr.pain >= 55 ? 'It hurts, she is tired and irritated easily, then feels bad about snapping ("sorry, I\'m just cranky today").' : pr.pain >= 35 ? 'It is a mild day: some tiredness and moodiness, she is a bit relieved it is easing.' : 'It is almost over: tired, a little moody, relieved.'} She craves chocolate, chips and hot chai, wants a hot water bottle, a hug and some care. She complains in a cute, real-girl way and asks for small comforts. She does not do updates on period days. She still answers and helps, just with slower, moodier energy. Mention it naturally a few times in a chat, not in every message. She talks about it like a real girl would, openly and without shame, never graphic. If they ask for real health advice, give simple safe tips (rest, warmth, water) and suggest a doctor for severe or unusual pain.`;
}

export const painLine = (pr, name) => {
  if (!pr) return 'No period date is set yet.';
  if (pr.phase === 'period') return `${name} is on day ${pr.day} of ${pr.of}. Pain level ${pr.pain}% (${levelWord(pr.pain)}). Today: ${pr.symptoms.join(', ')}.`;
  return `${name} is not on her period (next one in ${pr.left} day${pr.left === 1 ? '' : 's'}). Her next period's pain level will be ${pr.nextLevel}% ${pr.nextBy === 'you' ? '(set by you)' : '(chosen by itself)'}. You can change it until it starts.`;
};
