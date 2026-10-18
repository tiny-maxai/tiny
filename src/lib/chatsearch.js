// "What did I say about that exam?": she looks back through the saved chat with simple word matching and answers from what she finds.
import { now, clip } from './util.js';

const IST = 330 * 60000, DAY = 86400000;
const ASK = /(what did i (say|tell|ask|mention|write)|what have i (said|told)|did i (say|tell|mention|ask)|when did i (say|tell|mention)|what was i saying|remember (when|what) i|do you remember|yaad hai|maine (kya|kab|tumhe|aapko)?\s*(kaha|bola|bataya|poocha|puchha|likha)|kya (bola|kaha|bataya) tha|pichli baar|last time i|us din (maine|main)|kal (maine|main) (kya|kab))/i;
const STOP = new Set('what did say tell told about that this with have they them then than from your yours mine into just like when where which while would could should there their been were will shall also very really some more most much many such only other after before again said ask asked mention mentioned remember yaad maine kaha bola tha thi hai kya kab mere mera meri mujhe mujhko tumhe aapko pichli baar last time yesterday earlier today week weeks days wala wali bata batao that exam'.split(' ').filter((w) => w !== 'exam'));

const fmt = (t) => new Date(t + IST).toLocaleDateString('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short' });
export const asksPast = (text) => ASK.test(String(text || ''));

export async function pastTalk(env, text, t = now()) {
  text = String(text || '');
  if (!ASK.test(text)) return '';
  const words = [...new Set((text.toLowerCase().match(/[a-z0-9ऀ-ॿ]{3,}/g) || []).filter((w) => !STOP.has(w)))].sort((a, b) => b.length - a.length).slice(0, 4);
  if (!words.length) return '';
  const dayStart = Math.floor((t + IST) / DAY) * DAY - IST;
  let from = 0, to = t - 8000;
  if (/\b(yesterday|kal)\b/i.test(text)) { from = dayStart - DAY; to = dayStart; }
  else if (/\b(last week|pichle (hafte|week)|this week)\b/i.test(text)) from = t - 7 * DAY;
  const like = words.map(() => 'content LIKE ?').join(' OR ');
  const rows = await env.DB.prepare(`SELECT role, content, created_at FROM messages WHERE conv_id<>'routines' AND created_at>=? AND created_at<? AND (${like}) ORDER BY created_at DESC LIMIT 60`)
    .bind(from, to, ...words.map((w) => '%' + w.replace(/[%_]/g, '') + '%')).all().then((r) => r.results || []).catch(() => []);
  const clean = rows.filter((r) => r.content !== text && !/^\[(File|\[img)/.test(r.content) && !/^\[\[img:/.test(r.content)).map((r) => ({ ...r, hits: words.filter((w) => r.content.toLowerCase().includes(w)).length }));
  clean.sort((a, b) => b.hits - a.hits || b.created_at - a.created_at);
  const top = clean.slice(0, 6).sort((a, b) => b.created_at - a.created_at);
  if (!top.length) return `THEY ASKED WHAT THEY SAID EARLIER. You searched your chat history for "${words.join(', ')}" and found nothing. Say that honestly in your own words and ask them to remind you. Never invent what they said.`;
  return `THEY ASKED WHAT THEY SAID EARLIER. You looked back through your chat history (newest first):\n${top.map((r) => `- ${fmt(r.created_at)}, ${r.role === 'user' ? 'they said' : 'you said'}: "${clip(String(r.content).replace(/\s+/g, ' '), 200)}"`).join('\n')}\nAnswer only from these lines, mention the day naturally ("on ${fmt(top[0].created_at)} you told me..."), and never add things that are not here. If the lines do not really answer it, say you cannot find it.`;
}
