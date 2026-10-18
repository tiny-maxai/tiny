// Turn something she wrote (a list) into a tick-off checklist, and attach a reminder to it.
import { now, clip, uid } from './util.js';
import { createList, getList } from './lists.js';
import { createTask } from './tasks.js';

const BULLET = /^\s*(?:[-•*·▪●]|\d{1,2}[.)])\s+(.{2,200})$/;
const PAIR = /^\s*([^:\n]{2,40}):\s+(\S.{0,120})$/;
const SKIP = /^(note|tip|assumption|total|budget|bhool|remember|ps|p\.s)/i;
export function listLines(text) {
  const lines = String(text || '').replace(/\[\[img:[^\]]*\]\]/g, '').split('\n');
  let items = lines.map((l) => BULLET.exec(l)).filter(Boolean).map((m) => m[1]);
  if (items.length < 3) items = lines.map((l) => PAIR.exec(l)).filter((m) => m && !SKIP.test(m[1].trim())).map((m) => m[1].trim() + ': ' + m[2].trim());
  return items.map((t) => clip(t.replace(/\*\*|__|`/g, '').replace(/^\[[ x]\]\s*/i, '').trim(), 200)).filter((t) => t.length > 1).slice(0, 60);
}
export const looksLikeList = (text) => listLines(text).length >= 3;
export async function listFromText(env, text, title = '') {
  const items = listLines(text);
  if (items.length < 2) return null;
  const d = new Date(now() + 330 * 60000).toLocaleDateString('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short' });
  return createList(env, { title: clip(title || 'Checklist, ' + d, 120), items: items.map((t) => ({ id: uid(), t, done: 0 })) });
}
export async function remindList(env, id, runAt) {
  const l = await getList(env, id); if (!l) return null;
  const left = l.items.filter((x) => !x.done).slice(0, 10).map((x) => x.t);
  return createTask(env, { prompt: `Remind me about my checklist "${l.title}". Still to do: ${left.join('; ') || 'everything is ticked, just say well done'}. Say it as a short, sweet text.`, runAt });
}
