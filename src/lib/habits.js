// Water habit: the 8 pm Telegram check ("how many glasses today?") and the streak.
import { now, istDate } from './util.js';
import { complete } from './ai.js';
import { getSettings } from './settings.js';

const btn = (n, label) => ({ text: label || String(n), data: 'water:' + n });
export const WATER_BUTTONS = [[1, 2, 3, 4].map((n) => btn(n)), [5, 6, 7, 8].map((n) => btn(n)), [btn(9, '9'), btn(10, '10+'), btn(0, 'None')]];

export async function setWater(env, glasses, day = istDate()) {
  glasses = Math.min(30, Math.max(0, parseInt(glasses, 10) || 0));
  await env.DB.prepare('INSERT INTO habits (day,water,updated_at) VALUES (?,?,?) ON CONFLICT(day) DO UPDATE SET water=excluded.water, updated_at=excluded.updated_at').bind(day, glasses, now()).run();
  return glasses;
}
export async function addWater(env, n = 1) {
  const cur = await env.DB.prepare('SELECT water FROM habits WHERE day=?').bind(istDate()).first().catch(() => null);
  return setWater(env, ((cur && cur.water) || 0) + n);
}
export const listHabits = (env, limit = 30) => env.DB.prepare('SELECT day,water FROM habits ORDER BY day DESC LIMIT ?').bind(limit).all().then((r) => r.results || []);
export const waterLoggedToday = (env) => env.DB.prepare('SELECT 1 AS x FROM habits WHERE day=? LIMIT 1').bind(istDate()).first().then((r) => !!r).catch(() => false);

// Days in a row (ending today, or yesterday if today is not done yet) where water reached the goal.
export function streakOf(rows, goal, today = istDate()) {
  const by = {}; rows.forEach((r) => { by[r.day] = r.water; });
  const day = (i) => new Date(Date.parse(today + 'T00:00:00Z') - i * 86400000).toISOString().slice(0, 10);
  let i = (by[today] || 0) >= goal ? 0 : 1, n = 0;
  while ((by[day(i)] || 0) >= goal) { n++; i++; }
  return n;
}
export async function habitSummary(env) {
  const st = await getSettings(env), goal = st.habits.goal;
  const rows = await listHabits(env, 40);
  const today = (rows.find((r) => r.day === istDate()) || {}).water || 0;
  return { goal, today, streak: streakOf(rows, goal), rows: rows.slice(0, 14) };
}

export async function habitReply(env, glasses) {
  const st = await getSettings(env);
  const sum = await habitSummary(env);
  const fb = glasses >= sum.goal ? `That's ${glasses} glasses, goal done! ${sum.streak > 1 ? sum.streak + ' days in a row now.' : 'Nice start to a streak.'}` : glasses === 0 ? "Zero? Okay okay... go drink a glass right now, I'll wait." : `${glasses} of ${sum.goal} glasses. Drink a little more before bed?`;
  try {
    const r = await complete(env, {
      brain: 'fast', temperature: 0.8, maxTokens: 110,
      messages: [
        { role: 'system', content: `You are ${st.persona.name}, their close ${st.persona.gender === 'boy' ? 'guy' : 'girl'} friend. They just told you they drank ${glasses} glasses of water today (goal ${sum.goal}). Their streak of goal days is ${sum.streak}. Reply in 1 or 2 short, natural lines like a text: cheer them if they hit the goal (mention the streak if 2 or more), or gently nudge if not. At most one emoji. No lists.` },
        { role: 'user', content: 'Water today: ' + glasses },
      ],
    });
    return (r.text || '').trim() || fb;
  } catch { return fb; }
}
