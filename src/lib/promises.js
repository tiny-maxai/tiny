// Promise tracking: when you say "I'll call tonight", she remembers and follows up later.
// A follow-up is saved as a normal reminder (so it also shows in Reminders), and it never fires while she sleeps.
import { now, clip } from './util.js';
import { createTask } from './tasks.js';
import { inSleepWindow, nextHourAt } from './her.js';

// Cheap check first: only messages that sound like a promise are sent to the model.
export const PROMISE_GATE = /\b(i['’]?ll|i will|i['’]m going to|i am going to|i promise|will (call|text|message|come|send|tell|check|do|visit|meet|ring|ping|share|bring|show)|karunga|karungi|aaunga|bhejunga|dunga|batata|baat karunga|call karunga|message karunga)\b/i;

export async function trackPromise(env, settings, p, t = now()) {
  const what = clip(String(p && p.what || '').trim(), 100);
  if (what.length < 4) return null;
  let due = Date.parse(p.due);
  if (!Number.isFinite(due)) due = t + 3 * 3600000;
  let at = Math.max(due + 40 * 60000, t + 15 * 60000);            // she asks a little after the time they promised
  if (inSleepWindow(settings, at)) at = nextHourAt(at, (settings.sleep && settings.sleep.to) ?? 7) + 30 * 60000;
  const dup = await env.DB.prepare("SELECT id FROM tasks WHERE prompt LIKE ? AND created_at>? LIMIT 1").bind('Promise follow-up:%' + what.slice(0, 24).replace(/[%_]/g, '') + '%', t - 12 * 3600000).first().catch(() => null);
  if (dup) return null;
  const prompt = `Promise follow-up: earlier they promised you: "${what}". Ask them about it in your own cute way, like a girl who remembers: did they do it, or are you still waiting? One or two short lines, not nagging. If it was a call, say you were waiting for it.`;
  return createTask(env, { prompt, runAt: at });
}
