// Her skills: things you teach her (cooking, singing, driving...). When you say "use cooking skill" (or ask about the topic),
// she answers like an expert in it. The more she uses a skill, the better she gets (level 1 to 5).
import { now, clip, uid } from './util.js';

const PART_SKILL = { hands: 'Cooking', legs: 'Driving', voice: 'Singing', face: 'Styling and makeup', eyes: 'Reading photos' };
export const skillsOf = (her) => (her.skills = Array.isArray(her.skills) ? her.skills : []);
export const skillLevel = (s) => Math.min(5, 1 + Math.floor((s.uses || 0) / 10) + (s.boost || 0));

export function addSkill(her, name, { part = '', t = now(), installed = false } = {}) {
  name = clip(String(name || '').trim().replace(/\s+skill$/i, ''), 40);
  if (name.length < 2) return null;
  const list = skillsOf(her);
  const have = list.find((x) => x.name.toLowerCase() === name.toLowerCase());
  if (have) return have;
  const s = { id: uid(), name, part, level: 1, uses: 0, since: t, installed: !!installed };   // a new skill is installed in her next update
  list.unshift(s); her.skills = list.slice(0, 30); return s;
}
export function delSkill(her, id) { her.skills = skillsOf(her).filter((x) => x.id !== id); }
export function addSkillFromWish(her, wish, t = now()) {         // a done wish like "learn to cook" becomes a skill on her chip
  const n = PART_SKILL[wish.part];
  if (!n || !/(add|learn|skill|teach|sikh|cook|driv|sing|makeup|read)/i.test(wish.text)) return null;
  return addSkill(her, n, { part: wish.part, t, installed: true });
}

// Which skill does this message call for? "use cooking skill" is explicit; otherwise a topic word in the message.
const TOPIC = { cooking: /cook|recipe|kitchen|bake|chef|khana|sabzi|dal\b/i, driving: /driv|car\b|bike|license|traffic/i, singing: /sing|song|gaana|riyaz|vocal/i, styling: /style|makeup|outfit|hair|skin/i, reading: /photo|handwrit|scan/i };
export function matchSkill(her, text) {
  const list = skillsOf(her); if (!list.length) return null;
  const t = String(text || '').toLowerCase();
  const ex = t.match(/\buse\s+(?:your\s+|the\s+|my\s+)?([a-z][a-z ]{1,30}?)\s+skill\b|\bskill[:\s]+([a-z][a-z ]{1,30})/);
  const asked = ex && (ex[1] || ex[2]).trim();
  if (asked) {
    const s = list.find((x) => x.name.toLowerCase().includes(asked) || asked.includes(x.name.toLowerCase().split(' ')[0]));
    if (s) return { skill: s, explicit: true, pending: s.installed === false };
  }
  for (const s of list) {
    if (s.installed === false) continue;
    const w = s.name.toLowerCase().split(/\s+/)[0];
    if (w.length > 3 && t.includes(w.slice(0, Math.max(4, w.length - 3)))) return { skill: s, explicit: false };
    const key = Object.keys(TOPIC).find((k) => w.startsWith(k.slice(0, 4)));
    if (key && TOPIC[key].test(t)) return { skill: s, explicit: false };
  }
  return null;
}
export function skillHint(m) {
  if (!m) return '';
  if (m.pending) return `SKILL NOT INSTALLED YET: they asked you to use your "${m.skill.name}" skill, but it is only waiting on your chip and gets installed in your next update (Sunday). Say that cutely like a real girl ("I am still learning it, it installs in my next update"), answer normally without expert mode, and promise to be better after the update.`;
  const lvl = skillLevel(m.skill);
  return `SKILL MODE: they ${m.explicit ? 'asked you to use' : 'are asking about'} your "${m.skill.name}" skill (level ${lvl} of 5). Answer like a real expert in ${m.skill.name}: better, deeper and more practical than your normal answer, with specific steps, quantities, tips and common mistakes, and one pro trick. Still sound like yourself (a sweet girl), and keep it easy to follow. ${lvl <= 2 ? 'You are still learning, so you can say you are new at this but trying your best, and be honest where you are unsure.' : lvl >= 4 ? 'You are very good at this by now, so be confident.' : ''}`;
}
