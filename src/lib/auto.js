// Automation: you set a goal and a time, she does it by herself (every day, weekdays, weekends, every month, or one time)
// and sends it to you or to a Telegram group, as a message or as a file (HTML, PDF, Word, Excel, CSV, Markdown).
// Group posts never use your private memories.
import { uid, now, clip, istDate, istNice } from './util.js';
import { complete } from './ai.js';
import { getSettings } from './settings.js';
import { generate } from './tasks.js';
import { makeFile } from './files.js';
import { notifyOwner, asleepNow } from './notify.js';
import { api, sendDocument } from './telegram.js';

const KEY = 'auto:list', IST = 330 * 60000;
export const OUTPUTS = ['text', 'html', 'pdf', 'docx', 'xlsx', 'csv', 'md'];
export const REPEATS = ['daily', 'weekdays', 'weekends', 'monthly', 'once'];

export const listAuto = (env) => env.KV.get(KEY, 'json').then((v) => (Array.isArray(v) ? v : [])).catch(() => []);
const putAuto = (env, list) => env.KV.put(KEY, JSON.stringify(list.slice(0, 40)));

// "https://t.me/mygroup", "t.me/mygroup", "@mygroup" or "-1001234567890" -> a chat id the bot can send to.
export function normalizeGroup(input) {
  let g = String(input || '').trim();
  if (!g) return '';
  if (/^-?\d{5,}$/.test(g)) return g;
  const priv = /(?:t(?:elegram)?\.me)\/(?:\+|joinchat\/)/i.test(g) || /^\+/.test(g);
  if (priv) throw Object.assign(new Error('A private invite link (t.me/+...) cannot be used. Add the bot to the group, send /chatid in the group, and paste the number it gives you.'), { status: 400 });
  const c = /(?:t(?:elegram)?\.me)\/c\/(\d+)/i.exec(g);
  if (c) return '-100' + c[1];
  const m = /(?:t(?:elegram)?\.me\/|@)([A-Za-z][A-Za-z0-9_]{4,31})/i.exec(g) || /^([A-Za-z][A-Za-z0-9_]{4,31})$/.exec(g);
  if (!m) throw Object.assign(new Error('I could not read that group link. Use a public link like https://t.me/yourgroup or the number from /chatid.'), { status: 400 });
  return '@' + m[1];
}

function clean(b, old = {}) {
  const goal = clip(String(b.goal || '').trim(), 700);
  if (goal.length < 3) throw Object.assign(new Error('Tell me the goal: what should she do?'), { status: 400 });
  const time = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(b.time || '').trim());
  if (!time) throw Object.assign(new Error('Pick a time.'), { status: 400 });
  const target = b.target === 'group' ? 'group' : 'me';
  let group = '';
  if (target === 'group') { group = normalizeGroup(b.group); if (!group) throw Object.assign(new Error('Paste the group link (or its chat id) first.'), { status: 400 }); }
  const repeat = REPEATS.includes(b.repeat) ? b.repeat : 'daily';
  const dom = Math.min(31, Math.max(1, parseInt(b.day, 10) || 1));
  const date = String(b.date || '').trim();
  if (repeat === 'once' && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw Object.assign(new Error('Pick the date for this one-time run.'), { status: 400 });
  return {
    ...old,
    day: dom, date: repeat === 'once' ? date : '',
    name: clip(String(b.name || '').trim(), 60) || clip(goal, 40),
    goal, time: String(+time[1]).padStart(2, '0') + ':' + time[2],
    repeat,
    target, group, groupLabel: target === 'group' ? clip(String(b.group || '').trim(), 120) : '',
    output: OUTPUTS.includes(b.output) ? b.output : 'text',
    enabled: b.enabled !== false,
  };
}

export async function saveAuto(env, b) {
  const list = await listAuto(env);
  const i = b.id ? list.findIndex((x) => x.id === b.id) : -1;
  if (i >= 0) list[i] = { ...clean(b, list[i]), id: list[i].id };
  else list.unshift({ ...clean(b), id: uid(), created: now(), lastRun: '', lastAt: 0, lastResult: '' });
  await putAuto(env, list);
  return list;
}
export async function deleteAuto(env, id) { const list = (await listAuto(env)).filter((x) => x.id !== id); await putAuto(env, list); return list; }
export async function toggleAuto(env, id) { const list = await listAuto(env); const a = list.find((x) => x.id === id); if (a) a.enabled = !a.enabled; await putAuto(env, list); return list; }

export function dayOk(a, dow, d, today) {          // d = the India date as a Date (UTC fields)
  const r = a.repeat;
  if (r === 'daily') return true;
  if (r === 'weekdays') return dow >= 1 && dow <= 5;
  if (r === 'weekends') return dow === 0 || dow === 6;
  if (r === 'once') return a.date === today;
  if (r === 'monthly') { const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate(); return d.getUTCDate() === Math.min(a.day || 1, last); }   // 31st runs on the last day of a short month
  return false;
}

// Does the goal for this run: writes the post (or file) and delivers it. Returns a short result line.
export async function runAuto(env, a, { manual = false } = {}) {
  const settings = await getSettings(env);
  const chat = a.target === 'group' ? a.group : env.OWNER_TG_ID;
  const toMe = a.target !== 'group';
  if (!env.TELEGRAM_BOT_TOKEN || !chat) {
    if (!toMe) throw new Error('Connect the Telegram bot first.');
  }
  const today = istNice();
  if (a.output !== 'text') {
    const f = await makeFile(env, a.output, `${a.goal}\n(Today is ${today}.)`, '', a.name);
    if (chat && env.TELEGRAM_BOT_TOKEN) {
      const r = await sendDocument(env, chat, f.bytes, f.name, clip(a.name, 200), f.mime);
      if (!r || !r.ok) throw new Error('Telegram would not take the file: ' + clip((r && r.description) || 'unknown error', 120) + (toMe ? '' : ' (is the bot an admin of the group?)'));
    } else throw new Error('Telegram is not connected.');
    return 'Sent ' + f.name;
  }
  let text;
  if (toMe) {
    const g = await generate(env, a.goal);
    text = g.text;
    await notifyOwner(env, { title: a.name, body: text, url: '/?go=tasks', tag: 'auto-' + a.id, force: manual });
    return clip(text, 400);
  }
  const r = await complete(env, { brain: settings.brain === 'lite' ? 'lite' : 'fast', temperature: 0.7, maxTokens: 900, timeout: 25000, messages: [
    { role: 'system', content: `You write one post for a Telegram group, as the group's helpful channel voice. Do exactly what the goal says. Short, clear, friendly, plain text (light emoji at most). Never mention private details about anyone, never say you are scheduled. Today is ${today}. Output ONLY the post.` },
    { role: 'user', content: a.goal },
  ] });
  text = clip(r.text.trim(), 3800);
  const res = await api(env, 'sendMessage', { chat_id: chat, text });
  if (!res || res.ok !== true) throw new Error('Telegram would not post: ' + clip((res && res.description) || 'unknown error', 120) + ' (is the bot in the group?)');
  return clip(text, 400);
}

// Every minute: run what is due (once a day, up to 3 hours late if the clock was off).
export async function autoTick(env, t = now()) {
  const list = await listAuto(env);
  if (!list.length) return 0;
  if (await asleepNow(env)) return 0;                      // she is asleep: nothing runs, it waits for the morning
  const d = new Date(t + IST), dow = d.getUTCDay(), mins = d.getUTCHours() * 60 + d.getUTCMinutes(), today = istDate(t);
  const due = [];
  for (const a of list) {
    if (!a.enabled || a.lastRun === today || !dayOk(a, dow, d, today)) continue;
    const [h, m] = a.time.split(':').map(Number), at = h * 60 + m;
    if (mins < at || mins > at + 180) continue;
    a.lastRun = today; a.lastAt = t; if (a.repeat === 'once') a.enabled = false; due.push(a);                          // mark first, so a slow run never fires twice
    if (due.length >= 3) break;
  }
  if (!due.length) return 0;
  await putAuto(env, list);
  for (const a of due) {
    try { a.lastResult = 'OK: ' + await runAuto(env, a); } catch (e) { a.lastResult = 'Failed: ' + clip(e && e.message, 200); }
  }
  const fresh = await listAuto(env);                                         // keep edits made while she was working
  for (const a of due) { const f = fresh.find((x) => x.id === a.id); if (f) { f.lastResult = a.lastResult; f.lastAt = a.lastAt; f.lastRun = a.lastRun; if (a.repeat === 'once') f.enabled = false; } }
  await putAuto(env, fresh);
  return due.length;
}
