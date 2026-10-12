// Text AI: Groq first, OpenRouter as the safety net. No daily cap is applied by this code;
// if a provider says "rate limited" we simply move on to the next model.
import { groqFetch, hasGroq } from './groq.js';
const GROQ_DEFAULT = 'https://api.groq.com/openai/v1/chat/completions';
const OPENROUTER = 'https://openrouter.ai/api/v1/chat/completions';

const list = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
const isReasoning = (id) => /gpt-oss/i.test(id);

export function candidates(env, brain = 'smart') {
  const groqKey = { smart: env.GROQ_MODELS_SMART, fast: env.GROQ_MODELS_FAST, lite: env.GROQ_MODELS_LITE, solve: env.GROQ_MODELS_SOLVE || 'openai/gpt-oss-120b,llama-3.3-70b-versatile' }[brain] || env.GROQ_MODELS_SMART;
  const out = [];
  if (hasGroq(env)) for (const id of list(groqKey || 'llama-3.3-70b-versatile')) out.push({ provider: 'groq', id });
  if (env.OPENROUTER_API_KEY) for (const id of list(env.OPENROUTER_MODELS)) out.push({ provider: 'openrouter', id });
  return out;
}

function body(c, { messages, temperature, maxTokens, json, stream, effort }) {
  const p = { model: c.id, messages, temperature };
  if (c.provider === 'groq' && isReasoning(c.id)) { p.reasoning_effort = effort || 'low'; p.max_completion_tokens = Math.max(maxTokens * 3, 2048); }
  else p.max_tokens = maxTokens;
  if (json && c.provider === 'groq' && !isReasoning(c.id)) p.response_format = { type: 'json_object' };
  if (stream) p.stream = true;
  return p;
}
function request(env, c, opts) {
  const url = c.provider === 'groq' ? (env.GROQ_CHAT_URL || GROQ_DEFAULT) : OPENROUTER;
  const send = (key) => {
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` };
    if (c.provider === 'openrouter') { headers['X-Title'] = 'Memory AI'; headers['HTTP-Referer'] = 'https://memory-ai.workers.dev'; }
    return fetch(url, { method: 'POST', headers, body: JSON.stringify(body(c, opts)), signal: AbortSignal.timeout(opts.timeout || (opts.stream ? 15000 : 25000)) });
  };
  return c.provider === 'groq' ? groqFetch(env, c.id, send) : send(env.OPENROUTER_API_KEY);   // Groq: second account takes over when the first is limited
}

function noModel() {
  return Object.assign(new Error('No AI key is set. Add GROQ_API_KEY (and optionally GROQ_API_KEY_2 and OPENROUTER_API_KEY) as Worker secrets.'), { status: 503 });
}

export async function complete(env, { brain, messages, temperature = 0.6, maxTokens = 700, json = false, timeout, effort }) {
  const cs = candidates(env, brain);
  if (!cs.length) throw noModel();
  const errors = [];
  for (const c of cs) {
    try {
      const res = await request(env, c, { messages, temperature, maxTokens, json, timeout, effort });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { errors.push(`${c.id}: ${data?.error?.message || res.status}`); continue; }
      const text = data?.choices?.[0]?.message?.content?.trim();
      if (text) return { text, model: c.id, provider: c.provider };
      errors.push(`${c.id}: empty`);
    } catch (e) { errors.push(`${c.id}: network`); }
  }
  console.error('[ai] all models failed', errors.join(' | '));
  throw Object.assign(new Error('Every AI model is busy right now. Try again in a minute.'), { status: 503 });
}

export async function openStream(env, { brain, messages, temperature = 0.8, maxTokens = 1600 }) {
  const cs = candidates(env, brain);
  if (!cs.length) throw noModel();
  const errors = [];
  for (const c of cs) {
    try {
      const res = await request(env, c, { messages, temperature, maxTokens, stream: true });
      if (!res.ok || !res.body) { const d = await res.json().catch(() => ({})); errors.push(`${c.id}: ${d?.error?.message || res.status}`); continue; }
      return { body: res.body, model: c.id, provider: c.provider, fallback: c !== cs[0] };
    } catch (e) { errors.push(`${c.id}: network`); }
  }
  console.error('[ai] all streams failed', errors.join(' | '));
  throw Object.assign(new Error('Every AI model is busy right now. Try again in a minute.'), { status: 503 });
}

// Reads server-sent events and calls onText for each piece of the answer.
export async function readStream(stream, onText, signal) {
  const reader = stream.getReader();
  if (signal) signal.addEventListener('abort', () => reader.cancel().catch(() => {}), { once: true });
  const dec = new TextDecoder();
  let buf = '', full = '';
  const line = (l) => {
    l = l.trim();
    if (!l.startsWith('data:')) return;
    const d = l.slice(5).trim();
    if (!d || d === '[DONE]') return;
    let j; try { j = JSON.parse(d); } catch { return; }
    if (j.error) throw new Error(j.error.message || 'Stream error');
    const piece = j?.choices?.[0]?.delta?.content;
    if (piece) { full += piece; onText(piece); }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) { line(buf.slice(0, nl)); buf = buf.slice(nl + 1); }
  }
  if (buf) line(buf);
  return full;
}
