// Birthdays and special dates: she remembers them, warns you early and drafts the wish.
import { uid, now, istDate, clip } from './util.js';

const DAY = 86400000;
export const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

export async function createDate(env, { title, month, day, year, kind }) {
  title = clip(String(title || '').trim(), 100);
  month = parseInt(month, 10); day = parseInt(day, 10); year = parseInt(year, 10) || null;
  if (title.length < 2) throw Object.assign(new Error('Whose date is it?'), { status: 400 });
  if (!(month >= 1 && month <= 12) || !(day >= 1 && day <= 31)) throw Object.assign(new Error('Pick a day and month.'), { status: 400 });
  if (year && (year < 1900 || year > 2100)) year = null;
  kind = ['birthday', 'anniversary', 'other'].includes(kind) ? kind : 'birthday';
  const dup = await env.DB.prepare('SELECT * FROM dates WHERE LOWER(title)=LOWER(?) AND month=? AND day=?').bind(title, month, day).first();
  if (dup) return dup;
  const id = uid();
  await env.DB.prepare('INSERT INTO dates (id,title,month,day,year,kind,created_at) VALUES (?,?,?,?,?,?,?)').bind(id, title, month, day, year, kind, now()).run();
  return { id, title, month, day, year, kind };
}
export const deleteDate = (env, id) => env.DB.prepare('DELETE FROM dates WHERE id=?').bind(id).run();

// days until the next time this date comes round (0 = today), and the age/number of years it will be
export function nextOccurrence(d, today = istDate()) {
  const t0 = Date.parse(today + 'T00:00:00Z'), ty = new Date(t0).getUTCFullYear();
  for (const y of [ty, ty + 1]) {
    const days = Math.round((Date.UTC(y, d.month - 1, d.day) - t0) / DAY);
    if (days >= 0) return { days, years: d.year ? y - d.year : null };
  }
  return { days: 999, years: null };
}
export async function listDates(env) {
  const rows = (await env.DB.prepare('SELECT * FROM dates ORDER BY month, day').all().catch(() => ({ results: [] }))).results || [];
  return rows.map((r) => ({ ...r, ...nextOccurrence(r) })).sort((a, b) => a.days - b.days);
}
export const prettyDate = (d) => `${d.day} ${MONTHS[d.month - 1][0].toUpperCase()}${MONTHS[d.month - 1].slice(1, 3)}`;
