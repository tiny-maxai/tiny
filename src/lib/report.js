// The update report card: what she gained, what broke, what is waiting.
import { now, clip } from './util.js';
import { mt, healthOf, nextSundayStart } from './maint.js';
import { skillsOf } from './skills.js';

export function updateCard(her, settings, t = now()) {
  const m = mt(her, t), h = healthOf(her, t), last = m.history[0] || null;
  const gained = [], fixed = [], broke = [], waiting = [];
  if (last) {
    (last.notes || []).forEach((x) => gained.push(clip(x, 90)));
    (last.skillsInstalled || []).forEach((x) => gained.push('New skill installed: ' + x));
    (last.skillsUp || []).forEach((x) => gained.push('Better at ' + x));
    (last.partsUp || []).forEach((x) => gained.push('Upgraded: ' + x));
    (last.wishesDone || []).forEach((x) => gained.push('Wish done: ' + clip(x, 70)));
    (last.bugsFixed || []).forEach((x) => fixed.push(clip(x, 80)));
  }
  m.bugs.filter((b) => b.status !== 'fixed').slice(0, 8).forEach((b) => broke.push(clip(b.text, 90) + (b.sev === 'big' || b.sev === 'major' ? ' (big)' : '')));
  skillsOf(her).filter((x) => x.installed === false).forEach((x) => waiting.push('Skill waiting to install: ' + x.name));
  m.wishes.filter((w) => w.status === 'open').slice(0, 6).forEach((w) => waiting.push('Wish: ' + clip(w.text, 80)));
  const next = nextSundayStart(t);
  return { version: 'v1.' + m.history.length, at: last ? last.at : 0, by: last ? last.by : '', health: h.health, state: h.state, gained, fixed, broke, waiting, nextAt: next, feedback: last && last.feedback ? last.feedback : null };
}
export function cardText(c, name = 'Tiny') {
  const L = [`${name}'s update report (${c.version}, health ${c.health}%)`];
  L.push('', 'Gained: ' + (c.gained.length ? '' : 'nothing new yet'), ...c.gained.map((x) => '+ ' + x));
  if (c.fixed.length) L.push('', 'Fixed last update:', ...c.fixed.map((x) => '✓ ' + x));
  L.push('', 'Broken right now: ' + (c.broke.length ? '' : 'nothing, she is fine'), ...c.broke.map((x) => '- ' + x));
  L.push('', 'Waiting for the next update: ' + (c.waiting.length ? '' : 'nothing'), ...c.waiting.map((x) => '• ' + x));
  return L.join('\n').replace(/\n{3,}/g, '\n\n');
}
