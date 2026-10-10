// Daily mood check-ins: you tap how you feel, she remembers and follows up later.
import { uid, now, istDate, clip } from './util.js';
import { complete } from './ai.js';
import { getSettings } from './settings.js';

export const MOOD_WORD = { 1: 'rough', 2: 'low', 3: 'okay', 4: 'good', 5: 'great' };

export async function saveMood(env, { score, note }) {
  score = parseInt(score, 10);
  if (!(score >= 1 && score <= 5)) throw Object.assign(new Error('Pick how you feel.'), { status: 400 });
  const id = uid(), day = istDate();
  await env.DB.prepare('INSERT INTO moods (id,day,score,note,created_at) VALUES (?,?,?,?,?)').bind(id, day, score, clip(String(note || '').trim(), 400) || null, now()).run();
  return { id, day, score, note: clip(String(note || '').trim(), 400) || null };
}
export const listMoods = (env, limit = 60) => env.DB.prepare('SELECT id,day,score,note,created_at FROM moods ORDER BY created_at DESC LIMIT ?').bind(limit).all().then((r) => r.results || []);
export const deleteMood = (env, id) => env.DB.prepare('DELETE FROM moods WHERE id=?').bind(id).run();
export const moodLoggedToday = (env) => env.DB.prepare('SELECT 1 AS x FROM moods WHERE day=? LIMIT 1').bind(istDate()).first().then((r) => !!r).catch(() => false);

// Short lines for the system prompt so she can follow up naturally.
export async function moodContext(env) {
  try {
    const rows = (await env.DB.prepare('SELECT day,score,note FROM moods WHERE created_at>? ORDER BY created_at DESC LIMIT 7').bind(now() - 8 * 86400000).all()).results || [];
    return rows.reverse().map((m) => `${m.day}: felt ${MOOD_WORD[m.score]} (${m.score}/5)${m.note ? ', said: ' + clip(m.note, 160) : ''}`);
  } catch { return []; }
}

// A warm one or two line answer right after they log a mood.
export async function moodReply(env, mood) {
  const st = await getSettings(env);
  const fallback = mood.score <= 2 ? "Aww, thanks for telling me... I'm right here if you wanna talk." : mood.score === 3 ? 'Okay, steady day. Noted!' : "Yay, love that for you!";
  try {
    const recent = await moodContext(env);
    const r = await complete(env, {
      brain: 'fast', temperature: 0.8, maxTokens: 120,
      messages: [
        { role: 'system', content: `You are ${st.persona.name}, their close ${st.persona.gender === 'boy' ? 'guy' : 'girl'} friend. They just told you how they feel today (${mood.score}/5, ${MOOD_WORD[mood.score]})${mood.note ? ' and said: ' + clip(mood.note, 200) : ''}. Recent days: ${recent.join(' | ') || 'none yet'}. Reply in 1 or 2 short, soft, real-friend sentences, like a text. If they feel low, be gentle and offer to talk; if they feel good, be happy with them. At most one emoji. No lists.` },
        { role: 'user', content: 'How I feel today.' },
      ],
    });
    return (r.text || '').trim() || fallback;
  } catch { return fallback; }
}
