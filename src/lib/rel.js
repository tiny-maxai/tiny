// Her boyfriend: an editable relationship card with a story she tells in her own words.
// Intimate questions are answered shy and nervous, never explicit.
import { clip } from './util.js';
export const REL_DEFAULT = {
  has: true, name: 'Veer', since: '', met: 'We met at a college fest in Indore. He spilled his chai on my dupatta and then spent the whole evening saying sorry.',
  places: ['Sarafa night market, Indore', 'Patalpani waterfall', 'Mandu', 'Ujjain, Mahakal darshan', 'A small cafe near Rajwada'],
  chapters: [
    { title: 'The first date', text: 'He took me to Sarafa at night. We ate jalebi with rabri and he kept pretending he was not nervous. I could see his hands shaking.' },
    { title: 'Here and there', text: 'We went to Patalpani in the rain, then a bus to Mandu where we got lost near Jahaz Mahal and laughed for an hour. On the way back we slept on each other\'s shoulder in the bus.' },
    { title: 'The trip', text: 'Once we went out of town for two days. It was a lot of fun and a little scary, and I do not tell everything about that trip.' },
  ],
};
const norm = (r) => ({ ...REL_DEFAULT, ...(r || {}), places: Array.isArray(r && r.places) ? r.places : REL_DEFAULT.places, chapters: Array.isArray(r && r.chapters) ? r.chapters : REL_DEFAULT.chapters });
export const relOf = (her) => norm(her && her.rel);
export function saveRel(her, b) {
  const r = relOf(her);
  if (b.has !== undefined) r.has = !!b.has;
  if (b.name !== undefined) r.name = clip(String(b.name).trim(), 40) || r.name;
  if (b.since !== undefined) r.since = clip(String(b.since).trim(), 20);
  if (b.met !== undefined) r.met = clip(String(b.met).trim(), 500);
  if (b.places !== undefined) r.places = String(Array.isArray(b.places) ? b.places.join('\n') : b.places).split(/\n|,/).map((x) => clip(x.trim(), 60)).filter(Boolean).slice(0, 12);
  if (b.chapters !== undefined && Array.isArray(b.chapters)) r.chapters = b.chapters.map((c) => ({ title: clip(String(c.title || '').trim(), 60), text: clip(String(c.text || '').trim(), 700) })).filter((c) => c.title || c.text).slice(0, 12);
  her.rel = r; return r;
}
const REL_RE = /\b(boy ?friend|bf|partner|lover|relationship|your (?:man|guy|love)|love story|how did you meet|first date|trip|gayi thi|ghumne|hotel|kiss|romantic|bf ke saath|with him|where did you go|story)\b/i;
const HOTEL_RE = /\b(hotel|room|night|stay|sex|sleep with|slept with|physical|intimate|romance|romantic|suhagraat|sohi|so gayi|hotel me|hotel mein)\b/i;
export const wantsRel = (t) => REL_RE.test(String(t || ''));
export function relHint(her, text) {
  const r = relOf(her); if (!r.has || !wantsRel(text)) return '';
  const story = r.chapters.map((c) => `${c.title}: ${c.text}`).join(' | ');
  let h = `YOUR BOYFRIEND (real part of your life, a separate person from the one you are chatting with): his name is ${r.name}${r.since ? ', together since ' + r.since : ''}. How you met: ${r.met} Places you two went: ${r.places.join('; ')}. Your story, tell it in your own cute words, a little at a time, like a real girl telling a friend (never read it as a list): ${story}.`;
  h += ' If they ask where you went with him, tell the story warmly and with small details.';
  if (HOTEL_RE.test(text)) h += ' If they ask about a hotel or being physical with him (did you go to a hotel, did you do sex): get very nervous and shy, answer yes in a tiny embarrassed way, then say that is private and you will NOT tell more ("ab bas, that is private, I will not tell you 🙈"). Stay clean: no details, nothing explicit, and if they push, tease and change the subject.';
  return h;
}
