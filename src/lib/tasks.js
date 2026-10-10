// Reminders and routines: things she does for you later, once or on repeat.
// A cron runs every 5 minutes, picks up what is due, does it with your memories, saves the result in a
// "Routines" chat, and sends it to Telegram if the bot is connected.
import { uid, now, clip, parseJsonLoose, istNice } from './util.js';
import { complete } from './ai.js';
import { prepareChat, finishChat } from './chat.js';
import { notifyOwner } from './notify.js';

export const ROUTINES_CONV = 'routines';

export const listTasks = (env) => env.DB.prepare('SELECT * FROM tasks ORDER BY enabled DESC, run_at ASC LIMIT 200').all().then((r) => r.results || []);

export async function createTask(env, { prompt, runAt, intervalMinutes }) {
  prompt = clip(String(prompt || '').trim(), 600);
  runAt = Number(runAt);
  if (prompt.length < 2) throw Object.assign(new Error('Tell me what to do.'), { status: 400 });
  if (!Number.isFinite(runAt) || runAt < 1e12) throw Object.assign(new Error('Pick a date and time.'), { status: 400 });
  const iv = intervalMinutes ? Math.max(5, Math.min(60 * 24 * 366, parseInt(intervalMinutes, 10) || 0)) : null;
  const id = uid();
  await env.DB.prepare('INSERT INTO tasks (id,prompt,run_at,interval_minutes,enabled,created_at) VALUES (?,?,?,?,1,?)').bind(id, prompt, runAt, iv || null, now()).run();
  return env.DB.prepare('SELECT * FROM tasks WHERE id=?').bind(id).first();
}

// "remind me every morning at 8 to drink water" -> { prompt, runAt, intervalMinutes }
export async function parseTask(env, text) {
  const sys = `Turn the person's request into a scheduled task. Current India time: ${istNice()} (UTC+05:30).
Return ONLY JSON: {"prompt":"what to do or say when it runs, written as an instruction to the assistant, e.g. 'Remind me to drink water' or 'Give me a motivating message and today's top priority'","run_at":"ISO 8601 with +05:30 offset for the FIRST run, in the future","interval_minutes":number or null}.
Daily = 1440, weekly = 10080, hourly = 60. If no time is given, use 9:00 tomorrow morning. Never choose a time in the past.`;
  const r = await complete(env, { brain: 'fast', temperature: 0.1, maxTokens: 250, json: true, messages: [{ role: 'system', content: sys }, { role: 'user', content: clip(text, 400) }] });
  const p = parseJsonLoose(r.text);
  const at = p && Date.parse(p.run_at);
  if (!p || !p.prompt || !Number.isFinite(at)) throw Object.assign(new Error('I could not work out the time. Try: "remind me tomorrow at 6 pm to call mom".'), { status: 422 });
  return { prompt: clip(p.prompt, 600), runAt: Math.max(at, now() + 60000), intervalMinutes: p.interval_minutes ? parseInt(p.interval_minutes, 10) : null };
}

// Writes the message for a prompt (with her memories) and saves it in the Routines chat.
export async function generate(env, prompt, maxTokens = 900) {
  const text = `Scheduled task: ${prompt}`;
  const p = await prepareChat(env, { convId: ROUTINES_CONV, text, source: 'routine', via: 'task', task: true });
  await env.DB.prepare("UPDATE conversations SET title='Routines' WHERE id=?").bind(ROUTINES_CONV).run();
  const r = await complete(env, { brain: p.settings.brain, messages: p.messages, temperature: 0.8, maxTokens });
  await finishChat(env, { convId: p.convId, userMsgId: p.userMsgId, text, reply: r.text, model: r.model, source: 'routine', settings: p.settings });
  return { text: r.text, name: p.settings.persona.name };
}

export async function runTask(env, task) {
  const g = await generate(env, task.prompt);
  await notifyOwner(env, { title: g.name, body: g.text, url: '/?go=tasks', tag: 'task-' + task.id });
  return g.text;
}

async function finish(env, task, result) {
  const t = now();
  let next = task.run_at, enabled = task.enabled;
  if (task.interval_minutes) { const step = task.interval_minutes * 60000; next = task.run_at + step; if (next <= t) next += Math.ceil((t - next) / step + 0.0001) * step; }
  else enabled = 0;
  await env.DB.prepare('UPDATE tasks SET last_run=?,last_result=?,run_at=?,enabled=? WHERE id=?').bind(t, clip(result, 2000), next, enabled, task.id).run();
}

export async function runDueTasks(env) {
  const due = await env.DB.prepare('SELECT * FROM tasks WHERE enabled=1 AND run_at<=? ORDER BY run_at LIMIT 10').bind(now()).all().then((r) => r.results || []);
  for (const task of due) {
    // Move the clock first so a slow run never fires twice.
    await finish(env, task, task.last_result || '');
    try { const out = await runTask(env, task); await env.DB.prepare('UPDATE tasks SET last_result=? WHERE id=?').bind(clip(out, 2000), task.id).run(); }
    catch (e) { await env.DB.prepare('UPDATE tasks SET last_result=? WHERE id=?').bind('Could not run: ' + clip(e.message, 200), task.id).run(); }
  }
  return due.length;
}
