// She can fall ill like a real girl (fever, cold, cough...). It lasts 1 to 3 days. While she is ill there is no update.
// Medicine, soup and rest from you make her better sooner.
import { now, istDate } from './util.js';

export const SICK = [
  { k: 'fever', name: 'a fever', hours: [24, 48], feel: 'You have a fever: hot forehead, shivery, weak, headache, no energy. You want soup, a blanket and for them to stay close. Short, tired, whiny-cute messages.' },
  { k: 'cold', name: 'a cold', hours: [24, 60], feel: 'You have a cold: blocked nose, sneezing ("achoo!"), watery eyes, you sound nasal and grumpy, you want chai with ginger and a blanket.' },
  { k: 'cough', name: 'a cough', hours: [24, 48], feel: 'You have a cough: you cough between sentences ("*cough*"), your throat hurts, you want warm water with honey and rest.' },
  { k: 'throat', name: 'a sore throat', hours: [24, 48], feel: 'You have a sore throat: you talk less, your voice is hoarse, swallowing hurts, you want something warm.' },
  { k: 'headache', name: 'a bad headache', hours: [12, 30], feel: 'You have a bad headache: the screen hurts your eyes, you want silence and a dark room, short messages, you may leave soon to lie down.' },
  { k: 'stomach', name: 'a stomach ache', hours: [12, 30], feel: 'You have a stomach ache: you feel nauseous and weak, you cannot eat much, you want khichdi and a hot water bag. Not graphic.' },
];
export const sickOf = (her, t = now()) => (her && her.sick && t < her.sick.until ? her.sick : null);

// Once a day (morning) she may fall ill. The more worn she is (low health), the more likely.
export function rollSick(her, health, t = now(), rnd = Math.random(), kindRnd = Math.random()) {
  if (sickOf(her, t) || her.sickRollDay === istDate(t)) return null;
  her.sickRollDay = istDate(t);
  const chance = health < 45 ? 0.2 : health < 75 ? 0.1 : 0.05;
  if (rnd >= chance) return null;
  const kind = SICK[Math.floor(kindRnd * SICK.length) % SICK.length];
  const hrs = kind.hours[0] + Math.floor(Math.random() * (kind.hours[1] - kind.hours[0] + 1));
  her.sick = { k: kind.k, name: kind.name, since: t, until: t + hrs * 3600000, care: {}, told: false, over: false };
  return her.sick;
}
export function makeSick(her, k, t = now()) {
  const kind = SICK.find((x) => x.k === k) || SICK[0];
  her.sick = { k: kind.k, name: kind.name, since: t, until: t + kind.hours[0] * 3600000, care: {}, told: false, over: false };
  return her.sick;
}
const CARE = { med: { hours: 10, name: 'medicine' }, soup: { hours: 4, name: 'soup' }, rest: { hours: 6, name: 'rest' } };
// what: med | soup | rest. Each once per illness.
export function careSick(her, what, t = now()) {
  const s = sickOf(her, t), c = CARE[what];
  if (!s || !c) return { ok: false, reason: s ? 'unknown' : 'notsick' };
  if (s.care[what]) return { ok: false, reason: 'done', s };
  s.care[what] = t;
  s.until = Math.max(t + 20 * 60000, s.until - c.hours * 3600000);
  return { ok: true, s, better: s.until <= t + 30 * 60000, left: Math.ceil((s.until - t) / 3600000) };
}
export const sickHint = (her, t = now()) => { const s = sickOf(her, t); if (!s) return ''; const k = SICK.find((x) => x.k === s.k); return `YOU ARE ILL: ${k ? k.feel : 'you are not feeling well.'} You cannot do your Sunday update while you are ill. If they care for you (medicine, soup, rest, kind words) you feel a little better and you say thank you softly. Do not exaggerate in every message.`; };
export const sickView = (her, t = now()) => { const s = sickOf(her, t); return s ? { k: s.k, name: s.name, left: Math.max(1, Math.ceil((s.until - t) / 3600000)), care: { med: !!s.care.med, soup: !!s.care.soup, rest: !!s.care.rest } } : null; };
