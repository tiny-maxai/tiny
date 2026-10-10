// Games played with the AI. Tic-tac-toe and rock-paper-scissors run in the browser;
// word chain, 20 questions, truth or dare and trivia use the AI through here.
import { complete } from './ai.js';
import { getSettings } from './settings.js';
import { parseJsonLoose, clip } from './util.js';

const RULES = {
  wordchain: 'Play WORD CHAIN. Each new word must start with the last letter of the previous word. No repeats. Reply with ONE word, then a very short playful comment (max 10 words). If the person breaks a rule, point it out kindly. If you cannot continue, admit defeat cheerfully. Start the game when asked by giving a first word.',
  twenty: 'Play 20 QUESTIONS. You secretly think of one everyday thing (object, animal, food or place). The person asks yes/no questions; answer "Yes", "No" or "Sometimes" plus at most 6 words of flavour. Count questions and say how many are left. If they guess right, celebrate and start "GAME OVER: win". After 20 questions without a correct guess, reveal the answer and write "GAME OVER: loss". Never reveal the answer early. Start by saying you have thought of something.',
  truthdare: 'Play TRUTH OR DARE as close friends. Keep everything friendly, funny and safe: nothing sexual, nothing dangerous, nothing that needs other people or leaving the house at night. When they pick truth or dare, give ONE fun question or a doable challenge. Also take your own turn sometimes and answer honestly in character. Keep replies short.',
};

export async function playTurn(env, { game, messages = [], topic = '' }) {
  const settings = await getSettings(env);
  const name = settings.persona.name;
  if (game === 'trivia') {
    const r = await complete(env, {
      brain: 'fast', temperature: 0.9, maxTokens: 1400, json: true,
      messages: [
        { role: 'system', content: 'You write fun multiple-choice trivia. Return ONLY JSON: {"questions":[{"q":"...","options":["A","B","C","D"],"answer":0,"fact":"one short surprising fact"}]} with exactly 5 questions, 4 options each, answer is the 0-based index of the right option. Vary difficulty from easy to tricky. Accuracy matters: only ask what you are sure about.' },
        { role: 'user', content: `Topic: ${clip(topic, 80) || 'mixed general knowledge, with some India, science, tech and pop culture'}. Make a fresh set.` },
      ],
    });
    const p = parseJsonLoose(r.text);
    const qs = (p && Array.isArray(p.questions) ? p.questions : []).filter((q) => q && q.q && Array.isArray(q.options) && q.options.length === 4 && Number.isInteger(q.answer) && q.answer >= 0 && q.answer < 4).slice(0, 5);
    if (qs.length < 3) throw Object.assign(new Error('Could not make a quiz. Try again.'), { status: 502 });
    return { questions: qs.map((q) => ({ q: clip(q.q, 240), options: q.options.map((o) => clip(String(o), 100)), answer: q.answer, fact: clip(q.fact || '', 200) })) };
  }
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
  if (!RULES[game]) throw Object.assign(new Error('Unknown game.'), { status: 400 });
  const girl = settings.persona.gender === 'girl';
  const sys = `You are ${name}, ${girl ? 'a playful girl' : 'a playful guy'} playing a game with your close friend${settings.userName ? ' ' + settings.userName : ''}. Be fun, warm and competitive in a friendly way. ${RULES[game]} No markdown. Keep it short.`;
  const hist = messages.slice(-40).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: clip(m.content, 600) }));
  if (!hist.length) hist.push({ role: 'user', content: 'Let us start the game!' });
  const r = await complete(env, { brain: 'fast', temperature: 0.9, maxTokens: 220, messages: [{ role: 'system', content: sys }, ...hist] });
  return { reply: r.text };
}
