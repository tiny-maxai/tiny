// "New Today": a fresh set of things you could create today, shaped by what the AI knows about you.
import { istDate, parseJsonLoose, clip } from './util.js';
import { complete } from './ai.js';
import { getSettings } from './settings.js';

const TAGS = ['build', 'learn', 'write', 'design', 'relax'];

export async function getToday(env, { force = false } = {}) {
  const date = istDate();
  const key = 'today:' + date;
  if (!force) {
    const hit = await env.KV.get(key, 'json');
    if (hit && Array.isArray(hit.ideas) && hit.ideas.length) return hit;
  }
  const settings = await getSettings(env);
  const mem = await env.DB.prepare('SELECT text FROM memories ORDER BY pinned DESC, importance DESC, updated_at DESC LIMIT 25').all().then((r) => (r.results || []).map((m) => '- ' + m.text).join('\n')).catch(() => '');
  const old = await env.KV.get(key, 'json').catch(() => null);
  const avoid = old && old.ideas ? old.ideas.map((i) => i.title).join('; ') : '';
  const sys = `You suggest what a person could create or do today. Be specific, achievable in one sitting, and fitted to their life and projects. Mix kinds: something to build, something to learn, something to write, something creative/design, something relaxing.
${settings.userName ? 'Their name: ' + settings.userName + '.' : ''}
What you know about them:
${mem || '(nothing yet, so suggest broadly fun and useful things)'}
${avoid ? 'Do NOT repeat these: ' + avoid : ''}
Return ONLY JSON: {"greeting":"one warm short line","ideas":[{"title":"max 8 words","why":"one sentence on why it suits them","steps":["step","step","step"],"tag":"build|learn|write|design|relax","minutes":number}]} with exactly 6 ideas.`;
  const r = await complete(env, { brain: 'smart', temperature: 0.9, maxTokens: 1400, json: true, messages: [{ role: 'system', content: sys }, { role: 'user', content: `Today is ${date}. Give me today's ideas.` }] });
  const p = parseJsonLoose(r.text);
  const ideas = (p && Array.isArray(p.ideas) ? p.ideas : []).slice(0, 8).map((i) => ({
    title: clip(i.title, 80),
    why: clip(i.why, 220),
    steps: (Array.isArray(i.steps) ? i.steps : []).slice(0, 5).map((s) => clip(s, 140)),
    tag: TAGS.includes(i.tag) ? i.tag : 'build',
    minutes: Math.min(600, Math.max(5, parseInt(i.minutes, 10) || 30)),
  })).filter((i) => i.title);
  if (!ideas.length) throw Object.assign(new Error('Could not make ideas right now. Try again.'), { status: 502 });
  const doc = { date, greeting: clip(p.greeting || 'Here is what you could make today.', 160), ideas, generatedAt: Date.now() };
  await env.KV.put(key, JSON.stringify(doc), { expirationTtl: 60 * 60 * 24 * 3 });
  return doc;
}
