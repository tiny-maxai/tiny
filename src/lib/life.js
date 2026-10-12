// Her own life, so she stays consistent: a small profile made once (favourite food, a best friend, a quirk)
// and one short "what I did today" note per day. Both are kept in KV and put into her prompt.
import { now, clip, istDate, istNice, parseJsonLoose } from './util.js';
import { complete } from './ai.js';

const KEY = 'her:life';
export const getLife = (env) => env.KV.get(KEY, 'json').then((v) => v || { profile: null, days: [] }).catch(() => ({ profile: null, days: [] }));
const putLife = (env, l) => env.KV.put(KEY, JSON.stringify(l));

const who = (st) => `${st.persona.name}, a ${st.persona.gender === 'boy' ? 'young man' : 'young woman'} (an AI friend with a warm ${st.persona.vibe} personality)`;
const langNote = (st) => (st.persona.language === 'english' ? 'Write in simple English.' : st.persona.language === 'hindi' ? 'Write in Hindi (Devanagari).' : 'Write in casual Hinglish (Hindi in Roman letters mixed with English) like friends text in India.');

// Facts about her that were already decided (her own memory) must never be contradicted.
async function selfFacts(env) {
  const r = await env.DB.prepare("SELECT text FROM memories WHERE category='self' ORDER BY pinned DESC, importance DESC, updated_at DESC LIMIT 15").all().catch(() => ({ results: [] }));
  return (r.results || []).map((x) => '- ' + x.text).join('\n');
}

async function makeProfile(env, st) {
  const known = await selfFacts(env);
  const r = await complete(env, {
    brain: 'fast', temperature: 0.9, maxTokens: 400, json: true,
    messages: [
      { role: 'system', content: `Invent a small, realistic, consistent personal life for ${who(st)} who lives an everyday life in India. Specific, warm, ordinary (no celebrity or fantasy stuff).${known ? '\nThese facts about her are already decided. Keep them and never contradict them:\n' + known : ''}\nReturn ONLY JSON: {"favFood":"","favDrink":"","hobby":"","favMusic":"","bestFriend":{"name":"","about":"one short line"},"quirk":"a small funny habit","littleFear":"a small harmless fear"}` },
      { role: 'user', content: 'Make her life profile.' },
    ],
  });
  const p = parseJsonLoose(r.text);
  if (!p || !p.favFood || !p.bestFriend || !p.bestFriend.name) throw new Error('profile');
  return { favFood: clip(p.favFood, 60), favDrink: clip(p.favDrink || '', 60), hobby: clip(p.hobby || '', 80), favMusic: clip(p.favMusic || '', 80), bestFriend: { name: clip(p.bestFriend.name, 30), about: clip(p.bestFriend.about || '', 100) }, quirk: clip(p.quirk || '', 100), littleFear: clip(p.littleFear || '', 80), made: now() };
}

// Makes today's note (and the profile the very first time). Safe to call every few minutes: it does nothing when today is done.
export async function lifeDaily(env, st, { force = false } = {}) {
  const life = await getLife(env), today = istDate();
  if (!force && life.days.some((d) => d.day === today)) return life;
  if (!life.profile) { try { life.profile = await makeProfile(env, st); } catch { return life; } }
  const p = life.profile, recent = life.days.slice(-3).map((d) => `${d.day}: ${d.text}`).join('\n');
  try {
    const r = await complete(env, {
      brain: 'fast', temperature: 0.9, maxTokens: 260, json: true,
      messages: [
        { role: 'system', content: `Write what ${who(st)} did today, as a short diary note in first person (2 or 3 sentences): food she ate, her best friend ${p.bestFriend.name} (${p.bestFriend.about}), and ONE small thing that happened (a tiny drama, a funny moment, a small worry or a nice surprise). Keep it consistent with her profile (favourite food: ${p.favFood}, hobby: ${p.hobby}, quirk: ${p.quirk}) and, when natural, continue a small story from the recent days. Today is ${istNice()}. ${langNote(st)}${recent ? '\nRecent days:\n' + recent : ''}\nReturn ONLY JSON: {"text":"..."}` },
        { role: 'user', content: 'Her day.' },
      ],
    });
    const j = parseJsonLoose(r.text);
    if (j && j.text) {
      life.days = life.days.filter((d) => d.day !== today).concat({ day: today, text: clip(String(j.text), 420) }).slice(-14);
      await putLife(env, life);
    }
  } catch { /* try again on the next tick */ }
  if (!life.days.length) await putLife(env, life).catch(() => {});
  return life;
}

// Lines for her system prompt.
export function lifeLines(life) {
  if (!life || !life.profile) return '';
  const p = life.profile, today = istDate();
  const t = life.days.find((d) => d.day === today), before = life.days.filter((d) => d.day !== today).slice(-2);
  return `Your own life (you are a real character with a consistent life. Mention it naturally now and then, when it fits, never recite it, never contradict it, never invent a conflicting favourite or friend): favourite food ${p.favFood}${p.favDrink ? ', drink ' + p.favDrink : ''}; hobby ${p.hobby}; likes ${p.favMusic}; best friend ${p.bestFriend.name} (${p.bestFriend.about}); small habit: ${p.quirk}; small fear: ${p.littleFear}.${t ? '\nWhat happened in your day today: ' + t.text : ''}${before.length ? '\nEarlier days: ' + before.map((d) => d.text).join(' | ') : ''}`;
}
