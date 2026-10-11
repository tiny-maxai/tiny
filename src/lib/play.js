// Games played with the AI. Tic-tac-toe, rock-paper-scissors, scramble and hangman run in the browser;
// word chain, 20 questions, truth or dare and trivia use the AI through here.
// The rules that must never go wrong (the secret in 20 questions, the letter in word chain, repeats) are checked by code, not left to the model.
import { complete } from './ai.js';
import { getSettings } from './settings.js';
import { parseJsonLoose, clip } from './util.js';

const THINGS = ['umbrella','guitar','banana','elephant','bicycle','pizza','laptop','mango','toothbrush','giraffe','candle','spectacles','pencil','pillow','tiger','cricket bat','moon','mirror','key','clock','chai','samosa','mobile phone','headphones','backpack','camera','kite','tomato','peacock','train','refrigerator','balloon','scissors','notebook','cow','parrot','rainbow','ice cream','television','bus','butterfly','spoon','shoes','wallet','sunflower','lion','watermelon','fan','piano','rose','bottle','car','airplane','sandwich','dog','cat','chair','bed','book','coconut','monkey','boat','bridge','lamp','toothpaste','soap','rickshaw','bell','drum','cake','jalebi','mountain','river','Taj Mahal','Eiffel Tower','football','chess board','calculator','charger','keyboard','mouse','printer','whiteboard','candle stand','kettle','frying pan','plate','sofa','window','door','broom','bucket','towel','comb','lipstick','bangles','dupatta','saree','sunglasses','hat','watch','ring','necklace','earrings'];
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const norm = (t) => String(t || '').toLowerCase().replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();
const firstWord = (t) => (String(t || '').toLowerCase().match(/[a-z]+/) || [''])[0];

const RULES = {
  truthdare: 'Play TRUTH OR DARE as close friends. Keep everything friendly, funny and safe: nothing sexual, nothing dangerous, nothing that needs other people or leaving the house at night. When they pick truth or dare, give ONE fun question or a doable challenge. Also take your own turn sometimes and answer honestly in character. Keep replies short. NEVER repeat a truth or a dare that already appears in the conversation: each one must be completely new. If they answer, react to their answer first, then continue.',
};

// ---- trivia: remembers recent questions so a new quiz is never the old one ----
async function seenQuestions(env) { try { return (await env.KV.get('play:seen', 'json')) || []; } catch { return []; } }
async function trivia(env, topic) {
  const seen = await seenQuestions(env);
  const seenSet = new Set(seen.map(norm));
  let qs = [];
  for (let attempt = 0; attempt < 2 && qs.length < 5; attempt++) {
    const r = await complete(env, {
      brain: 'fast', temperature: 1, maxTokens: 1600, json: true,
      messages: [
        { role: 'system', content: 'You write fun multiple-choice trivia. Return ONLY JSON: {"questions":[{"q":"...","options":["A","B","C","D"],"answer":0,"fact":"one short surprising fact"}]} with exactly 7 questions, 4 options each, answer is the 0-based index of the right option. Vary difficulty from easy to tricky and vary the sub-topics. Accuracy matters: only ask what you are sure about. Never ask any question from this list of questions already asked: ' + JSON.stringify(seen.slice(-40)) },
        { role: 'user', content: `Topic: ${clip(topic, 80) || 'mixed general knowledge, with some India, science, tech and pop culture'}. Make a completely fresh set. Seed ${Math.floor(Math.random() * 1e6)}.` },
      ],
    });
    const p = parseJsonLoose(r.text);
    const fresh = (p && Array.isArray(p.questions) ? p.questions : []).filter((q) => q && q.q && Array.isArray(q.options) && q.options.length === 4 && Number.isInteger(q.answer) && q.answer >= 0 && q.answer < 4 && !seenSet.has(norm(q.q)));
    for (const q of fresh) { if (qs.length < 5 && !qs.some((x) => norm(x.q) === norm(q.q))) qs.push(q); }
  }
  if (qs.length < 3) throw Object.assign(new Error('Could not make a quiz. Try again.'), { status: 502 });
  try { await env.KV.put('play:seen', JSON.stringify([...seen, ...qs.map((q) => clip(q.q, 200))].slice(-120))); } catch { /* ignore */ }
  return { questions: qs.map((q) => ({ q: clip(q.q, 240), options: q.options.map((o) => clip(String(o), 100)), answer: q.answer, fact: clip(q.fact || '', 200) })) };
}

// ---- word chain: the code checks the rules ----
function chainState(messages) {
  const used = new Set(); let last = '';
  for (const m of messages) { const w = firstWord(m.content); if (w) { used.add(w); last = w; } }
  return { used, last };
}
async function wordchain(env, messages, sys) {
  const hist = messages.filter((m) => m.content && String(m.content).trim());
  const { used, last } = chainState(hist);
  const lastUser = hist.length && hist[hist.length - 1].role === 'user' ? hist[hist.length - 1] : null;
  if (lastUser) {
    const w = firstWord(lastUser.content);
    const before = chainState(hist.slice(0, -1));
    const need = before.last ? before.last.slice(-1) : '';
    if (w.length < 2) return { reply: 'Type one real word, please!', invalid: true };
    if (need && w[0] !== need) return { reply: `Hmm, it has to start with "${need.toUpperCase()}". Try another word!`, invalid: true };
    if (before.used.has(w)) return { reply: `We already used "${w}"! Another one?`, invalid: true };
  }
  const need = last ? last.slice(-1) : '';
  for (let i = 0; i < 3; i++) {
    const r = await complete(env, { brain: 'fast', temperature: 0.9 + i * 0.1, maxTokens: 80, messages: [{ role: 'system', content: `${sys} Play WORD CHAIN. ${need ? `Your word MUST start with the letter "${need.toUpperCase()}".` : 'Start the game with any common word.'} Never use a word already used: ${[...used].join(', ') || 'none yet'}. Reply with ONE word first, then a very short playful comment (max 10 words).` }, ...hist.slice(-20).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: clip(m.content, 200) })), ...(hist.length ? [] : [{ role: 'user', content: 'Let us start!' }])] });
    const w = firstWord(r.text);
    if (w.length >= 2 && (!need || w[0] === need) && !used.has(w)) return { reply: r.text };
  }
  return { reply: `Okay okay, I cannot think of one starting with "${need.toUpperCase()}"... you win! GAME OVER: win` };
}

// ---- 20 questions: the secret is chosen once and passed along, so she never changes her mind ----
async function twenty(env, messages, secret, sys) {
  if (!secret || !messages.length) {
    secret = pick(THINGS);
    return { reply: 'I am thinking of something... You have 20 yes or no questions. Go!', secret };
  }
  const asked = messages.filter((m) => m.role === 'user').length;
  const guess = norm(messages[messages.length - 1].content);
  const esc = norm(secret).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp('^(is it |its |it s |maybe |i guess |guess |my guess is )?(a |an |the )?' + esc + '( right)?$').test(guess)) {
    return { reply: `Yes! It was ${/^[aeiou]/.test(secret) ? 'an' : 'a'} ${secret}! You got it in ${asked} question${asked === 1 ? '' : 's'}. GAME OVER: win`, secret };
  }
  const r = await complete(env, { brain: 'fast', temperature: 0.4, maxTokens: 120, messages: [{ role: 'system', content: `${sys} Play 20 QUESTIONS. The secret thing is "${secret}". Never change it. Answer their latest question truthfully about "${secret}" with "Yes", "No" or "Sometimes" plus at most 6 words of flavour. Never say the secret unless they guessed it. This is question ${asked} of 20; say how many are left. If they guessed it right, celebrate and end with "GAME OVER: win". If this was question 20 and they did not guess, reveal that it was "${secret}" and end with "GAME OVER: loss". Always listen to what they actually asked.` }, ...messages.slice(-30).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: clip(m.content, 300) }))] });
  let reply = r.text;
  if (asked >= 20 && !/GAME OVER/i.test(reply)) reply += ` It was a ${secret}! GAME OVER: loss`;
  return { reply, secret };
}

export async function playTurn(env, { game, messages = [], topic = '', secret = '' }) {
  const settings = await getSettings(env);
  const name = settings.persona.name;
  if (game === 'trivia') return trivia(env, topic);
  if (game === 'words') {
    const r = await complete(env, {
      brain: 'fast', temperature: 1, maxTokens: 900, json: true,
      messages: [
        { role: 'system', content: 'You prepare words for word games. Return ONLY JSON: {"words":[{"word":"lowercase english word, letters only, 5 to 8 letters","hint":"a short clue that does not contain the word"}]} with exactly 8 different common words. Mix easy and medium. Theme: ' + (clip(topic, 60) || 'anything fun and everyday') + '.' },
        { role: 'user', content: 'Make a fresh set. Seed: ' + Math.floor(Math.random() * 1e6) },
      ],
    });
    const p = parseJsonLoose(r.text);
    const ws = (p && Array.isArray(p.words) ? p.words : []).map((w) => ({ word: String((w && w.word) || '').toLowerCase().replace(/[^a-z]/g, ''), hint: clip((w && w.hint) || '', 120) })).filter((w) => w.word.length >= 4 && w.word.length <= 10 && w.hint).slice(0, 8);
    if (ws.length < 4) throw Object.assign(new Error('Could not make words. Try again.'), { status: 502 });
    return { words: ws };
  }
  const girl = settings.persona.gender === 'girl';
  const sys = `You are ${name}, ${girl ? 'a playful girl' : 'a playful guy'} playing a game with your close friend${settings.userName ? ' ' + settings.userName : ''}. Be fun, warm and competitive in a friendly way. Talk like a real friend (small reactions like "hmm", "okay", "haha"). No markdown. Keep it short.`;
  const clean = messages.slice(-60).filter((m) => m && m.content);
  if (game === 'wordchain') return wordchain(env, clean, sys);
  if (game === 'twenty') return twenty(env, clean, secret, sys);
  if (!RULES[game]) throw Object.assign(new Error('Unknown game.'), { status: 400 });
  const hist = clean.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: clip(m.content, 600) }));
  if (!hist.length) hist.push({ role: 'user', content: 'Let us start the game!' });
  const said = new Set(clean.filter((m) => m.role === 'assistant').map((m) => norm(m.content)));
  let text = '';
  for (let i = 0; i < 3; i++) {
    const r = await complete(env, { brain: 'fast', temperature: 0.95 + i * 0.1, maxTokens: 220, messages: [{ role: 'system', content: `${sys} ${RULES[game]}${i ? ' You just repeated yourself. Say something completely new.' : ''}` }, ...hist] });
    text = r.text;
    if (!said.has(norm(text))) break;
  }
  return { reply: text };
}
