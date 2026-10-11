// Reads pictures (OCR): text in photos, screenshots, notes, question papers, plus a short description when there is no text.
// Uses a Groq vision model (free tier, same key), with Workers AI as backup. Images are never stored.
import { bytesToB64, clip } from './util.js';

export const IMAGE_MAX = 4 * 1024 * 1024;
const DEFAULT_URL = 'https://api.groq.com/openai/v1/chat/completions';
const PROMPT = `You are an OCR reader for a personal assistant. Look at the image.
1. Copy ALL visible text exactly as written (Hindi in Devanagari, English, numbers, formulas), keeping the order and line breaks. For tables write rows with " | " between cells. For handwriting, do your best and put [unclear] where you cannot read.
2. If there is little or no text (a photo, diagram, chart, screenshot of an app), describe what you see in 2 to 4 short lines, and read any labels.
Output the text first, then, only if useful, a line starting with "Picture:" describing it. No other commentary.`;

export const isImage = (name = '', mime = '') => /^image\//i.test(mime) || /\.(jpe?g|png|webp|gif|bmp)$/i.test(name);
const mimeOf = (name, mime) => (/^image\/(jpeg|png|webp|gif)/i.test(mime) ? mime.toLowerCase() : /\.png$/i.test(name) ? 'image/png' : /\.webp$/i.test(name) ? 'image/webp' : /\.gif$/i.test(name) ? 'image/gif' : 'image/jpeg');

export async function readImage(env, bytes, name = 'image.jpg', mime = '') {
  if (bytes.length > IMAGE_MAX) throw Object.assign(new Error('That picture is too big (limit about 4 MB). Send a smaller one or a screenshot.'), { status: 413 });
  const type = mimeOf(name, mime);
  if (env.GROQ_API_KEY) {
    const url = env.GROQ_CHAT_URL || DEFAULT_URL;
    const models = String(env.GROQ_MODELS_VISION || 'meta-llama/llama-4-scout-17b-16e-instruct').split(',').map((x) => x.trim()).filter(Boolean);
    const dataUrl = `data:${type};base64,${bytesToB64(bytes)}`;
    for (const model of models) {
      try {
        const res = await fetch(url, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.GROQ_API_KEY}` }, signal: AbortSignal.timeout(28000),
          body: JSON.stringify({ model, temperature: 0.1, max_tokens: 1800, messages: [{ role: 'system', content: PROMPT }, { role: 'user', content: [{ type: 'text', text: 'Read this image.' }, { type: 'image_url', image_url: { url: dataUrl } }] }] }),
        });
        const d = await res.json().catch(() => ({}));
        const t = d && d.choices && d.choices[0] && d.choices[0].message && String(d.choices[0].message.content || '').trim();
        if (res.ok && t) return t;
        console.error('[ocr]', model, res.status, d && d.error && d.error.message);
      } catch (e) { console.error('[ocr]', model, e && e.message); }
    }
  }
  if (env.AI && env.AI.toMarkdown) {
    try {
      const r = await env.AI.toMarkdown({ name, blob: new Blob([bytes], { type }) });
      const t = String((Array.isArray(r) ? r[0] : r).data || '').trim();
      if (t.length > 3) return clip(t, 8000);
    } catch (e) { console.error('[ocr ai]', e && e.message); }
  }
  throw Object.assign(new Error('I could not read that picture right now. Try again, or send a clearer one.'), { status: 503 });
}
