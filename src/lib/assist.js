// Things she does for you straight from a chat message (website or Telegram):
// set a reminder, save a note, remember a birthday, read your notes, read a link, search the web, send you a file.
import { now, clip, parseJsonLoose, istNice } from './util.js';
import { complete } from './ai.js';
import { createTask } from './tasks.js';
import { createNote, notesFor } from './notes.js';
import { createDate, MONTHS } from './dates.js';
import { webContext, urlsIn, needsSearch } from './web.js';
import { wantsFile, makeFile } from './files.js';
import { sendDocument } from './telegram.js';

const REMIND = /\b(remind|reminder|remind me|yaad dila\w*|alarm|wake me)\b/i;
const NOTE = /\bnotes?\b[^\n]{0,60}\b(add|save|write|make|create|take|likh\w*|bana\w*|jod\w*)\b|\b(add|save|write|make|create|take|likh\w*|bana\w*|jod\w*|put)\b[^\n]{0,60}\bnotes?\b|\bnote (this|that|down|it)\b/i;
const DATE = /\b(birthday|bday|b'day|anniversary|janmdin|janamdin|janam ?din)\b/i;

async function classify(env, text, prev) {
  const sys = `Decide if the person's latest message asks you to DO one of these things right now, and extract the details. Current India time: ${istNice()} (UTC+05:30).
Return ONLY JSON: {"action":"reminder"|"note"|"date"|"none","reminder":{"prompt":"what to say or do when it fires, written as an instruction e.g. 'Remind me to call mom'","run_at":"ISO 8601 with +05:30, first run, in the future","interval_minutes":number or null},"note":{"title":"short title","content":"the full text to save"},"date":{"title":"e.g. Riya's birthday","month":1-12,"day":1-31,"year":birth or first year or null,"kind":"birthday|anniversary|other"}}.
- reminder: they want to be reminded or want something done at a time. Daily=1440, weekly=10080. No time given: 9:00 tomorrow morning. Never in the past.
- note: they ask you to save, write or note something down. If they say "note this/that" they mean your previous message: use it as the content.
- date: they tell you a birthday, anniversary or special day to remember.
- none: questions about reminders or notes, small talk, or anything else. When unsure choose none.
Only include the object for the chosen action.
Who is who: "me/my/I/main/mera/mujhe" = the person talking; "you/your/tum/tera/aap" = you, the assistant (so "your birthday" is the assistant's own date: title it "<assistant>'s birthday", and "remind you" is NOT a reminder for the person: use none). "Remind me" and "my birthday" are the person's own.`;
  const r = await complete(env, { brain: 'fast', temperature: 0.1, maxTokens: 500, json: true, messages: [{ role: 'system', content: sys }, { role: 'user', content: (prev ? 'Your previous message to them:\n' + clip(prev, 1500) + '\n\n' : '') + 'Their latest message:\n' + clip(text, 1500) }] });
  return parseJsonLoose(r.text);
}

async function actions(env, text, convId) {
  const prev = convId ? await env.DB.prepare("SELECT content FROM messages WHERE conv_id=? AND role='assistant' ORDER BY id DESC LIMIT 1").bind(convId).first().then((r) => r && r.content).catch(() => null) : null;
  const a = await classify(env, text, prev);
  if (!a || !a.action || a.action === 'none') return [];
  try {
    if (a.action === 'reminder' && a.reminder) {
      const at = Date.parse(a.reminder.run_at);
      if (!a.reminder.prompt || !Number.isFinite(at)) return ['FAILED to set the reminder: the time was unclear. Ask them for the day and time.'];
      const iv = a.reminder.interval_minutes ? parseInt(a.reminder.interval_minutes, 10) : null;
      const t = await createTask(env, { prompt: a.reminder.prompt, runAt: Math.max(at, now() + 60000), intervalMinutes: iv });
      return [`DONE: reminder saved, "${clip(t.prompt, 120)}", first time ${istNice(t.run_at)}${iv ? ', repeating every ' + (iv % 1440 === 0 ? iv / 1440 + ' day(s)' : iv % 60 === 0 ? iv / 60 + ' hour(s)' : iv + ' minutes') : ''}. It is in their Reminders section and she will message them then.`];
    }
    if (a.action === 'note' && a.note && a.note.content) {
      const n = await createNote(env, { title: a.note.title, content: a.note.content });
      return [`DONE: note saved with the title "${n.title}". It is in their Notes section.`];
    }
    if (a.action === 'date' && a.date) {
      const d = await createDate(env, a.date);
      return [`DONE: remembered "${d.title}" on ${d.day} ${MONTHS[d.month - 1]}${d.year ? ' ' + d.year : ''}. She will remind them 7 days and 1 day before and on the day, with a wish ready to send.`];
    }
  } catch (e) { return ['FAILED: ' + clip(e.message, 160) + ' Tell them honestly and ask for what is missing.']; }
  return [];
}

// Runs the helpers a message needs, all at the same time. Never throws.
export async function assist(env, text, { source = 'web', task = false, convId = null } = {}) {
  const out = { done: [], web: '', notes: { titles: [], notes: [], explicit: false } };
  if (task || !text) return out;
  const jobs = [];
  jobs.push(notesFor(env, text).then((n) => { out.notes = n; }));
  if (urlsIn(text).length || needsSearch(text)) jobs.push(webContext(text).then((w) => { out.web = w; }));
  if (REMIND.test(text) || NOTE.test(text) || DATE.test(text)) jobs.push(actions(env, text, convId).then((d) => out.done.push(...d)));
  const kind = source === 'web' ? wantsFile(text) : null;                   // on Telegram the bot handles file requests itself
  if (kind) jobs.push(fileToTelegram(env, kind, text).then((m) => out.done.push(m)));
  (await Promise.allSettled(jobs)).forEach((r) => { if (r.status === 'rejected') console.error('[assist]', r.reason && r.reason.message); });
  return out;
}

async function fileToTelegram(env, kind, text) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.OWNER_TG_ID) return `FAILED: they asked for a ${kind.toUpperCase()} file, but Telegram is not connected so you cannot send files from the website. Tell them to connect the Telegram bot (Act like a girl > Connect the bot), then ask again.`;
  try {
    const notes = /\bnotes?\b/i.test(text) ? await notesFor(env, text) : null;
    const extra = notes && notes.notes.length ? notes.notes.map((n) => `# ${n.title}\n${n.text}`).join('\n\n') : '';
    const f = await makeFile(env, kind, text, extra);
    const res = await sendDocument(env, env.OWNER_TG_ID, f.bytes, f.name, 'Here is your file.', f.mime);
    return res && res.ok ? `DONE: made the file ${f.name} and sent it to their Telegram. Tell them to check Telegram.` : 'FAILED: the file was made but Telegram would not accept it. Tell them to try again.';
  } catch (e) { return 'FAILED to make the file: ' + clip(e.message, 160); }
}
