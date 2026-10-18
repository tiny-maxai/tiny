// "What she knows about me": everything she remembers about you, grouped by topic, each line can be forgotten.
import { allSkills } from './skills.js';

export const GROUPS = [
  ['profile', 'About you'], ['preference', 'What you like'], ['people', 'People in your life'], ['project', 'Your projects'],
  ['plan', 'Plans and goals'], ['insight', 'What she noticed about you'], ['other', 'Other things'],
];
export async function knowsView(env, her) {
  const rows = await env.DB.prepare("SELECT id, text, category, pinned, importance, updated_at FROM memories WHERE category<>'self' ORDER BY pinned DESC, importance DESC, updated_at DESC LIMIT 500").all().then((r) => r.results || []).catch(() => []);
  const by = new Map(GROUPS.map(([k, title]) => [k, { key: k, title, items: [] }]));
  for (const r of rows) (by.get(by.has(r.category) ? r.category : 'other')).items.push({ kind: 'mem', id: r.id, text: r.text, pinned: !!r.pinned, at: r.updated_at });
  const groups = [...by.values()];
  for (const s of allSkills(her)) if (s.mem && s.mem.length) groups.push({ key: 'skill-' + s.id, title: s.name + ' skill', skill: true, items: s.mem.map((m, i) => ({ kind: 'skill', sid: s.id, i, text: m.t, at: m.at })) });
  const out = groups.filter((g) => g.items.length);
  return { groups: out, total: out.reduce((n, g) => n + g.items.length, 0) };
}
