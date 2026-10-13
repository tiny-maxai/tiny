// Voice: speech to text (Groq Whisper, Workers AI Whisper as backup) and text to speech (Groq Orpheus, then Cloudflare Aura/Melo).
import { b64ToBytes, bytesToB64 } from './util.js';
import { groqFetch, hasGroq } from './groq.js';

export async function speechToText(env, bytes, mime = 'audio/webm', language) {
  const errors = [];
  if (hasGroq(env)) {
    try {
      const fd = new FormData();
      const ext = /ogg/.test(mime) ? 'ogg' : /mp4|m4a|aac/.test(mime) ? 'm4a' : /wav/.test(mime) ? 'wav' : /mpeg|mp3/.test(mime) ? 'mp3' : 'webm';
      fd.append('file', new Blob([bytes], { type: mime }), `voice.${ext}`);
      fd.append('model', 'whisper-large-v3-turbo');
      fd.append('response_format', 'json');
      fd.append('temperature', '0');
      if (language) fd.append('language', language);
      const r = await groqFetch(env, 'stt', (key) => fetch('https://api.groq.com/openai/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: fd }));
      const d = await r.json().catch(() => ({}));
      if (r.ok && typeof d.text === 'string') return d.text.trim();
      errors.push('groq: ' + (d?.error?.message || r.status));
    } catch (e) { errors.push('groq: network'); }
  }
  try {
    const r = await env.AI.run('@cf/openai/whisper-large-v3-turbo', { audio: bytesToB64(bytes) });
    if (r && typeof r.text === 'string') return r.text.trim();
  } catch (e) { errors.push('cf: ' + (e && e.message)); }
  console.error('[stt] failed', errors.join(' | '));
  throw Object.assign(new Error('I could not understand the audio. Please try again.'), { status: 502 });
}

const DEVANAGARI = /[\u0900-\u097F]/;
export const canSpeakOnServer = (text) => !DEVANAGARI.test(text);

// Hindi or Hinglish (Hindi written in English letters)?
const HINGLISH = new Set('hai hain hoon ho tha thi the kya nahi nahin haan acha achha accha theek thik mujhe tumhe tumhein tum aap main mera meri mere tera teri tere apna apni yaar arre are abhi kal aaj bahut bohot kuch koi kaise kaisa kaisi kyun kyu kab kahan bhi toh to hi se ko ka ki ke par lekin aur ya matlab chalo chal karo kar karna kiya raha rahi rahe wala wali bolo bol suno sun dekho dekh pata samajh samjha lagta lagti mat jao ja aa aao ab phir fir sab sabko mein me liye lie diya diye hum humein unka uska iska yeh ye woh wo jaise bas ekdum bilkul sach'.split(' '));
export function looksHindi(text, language = 'auto') {
  if (DEVANAGARI.test(text)) return true;
  if (language === 'hindi' || language === 'hinglish') return true;
  if (language === 'english') return false;
  const w = text.toLowerCase().match(/[a-z]+/g) || [];
  if (w.length < 3) return false;
  const n = w.filter((x) => HINGLISH.has(x)).length;
  return n >= 3 && n / w.length >= 0.25;
}

function wavFromPcm(pcm, rate = 24000) {
  const h = new DataView(new ArrayBuffer(44));
  const W = (o, s) => { for (let i = 0; i < s.length; i++) h.setUint8(o + i, s.charCodeAt(i)); };
  W(0, 'RIFF'); h.setUint32(4, 36 + pcm.length, true); W(8, 'WAVEfmt '); h.setUint32(16, 16, true); h.setUint16(20, 1, true); h.setUint16(22, 1, true);
  h.setUint32(24, rate, true); h.setUint32(28, rate * 2, true); h.setUint16(32, 2, true); h.setUint16(34, 16, true); W(36, 'data'); h.setUint32(40, pcm.length, true);
  const out = new Uint8Array(44 + pcm.length); out.set(new Uint8Array(h.buffer), 0); out.set(pcm, 44); return out;
}

// Real Hindi voices. Both are optional and free to start: add SARVAM_API_KEY (sarvam.ai, free credits) and/or GEMINI_API_KEY (aistudio.google.com, free tier).
// Her voice follows her mood: slower and softer when sleepy or sad, brighter when happy. (The browser voice does the same in voice.js.)
const MOOD_PACE = { sleepy: 0.82, sleeping: 0.82, sad: 0.88, in_pain: 0.85, clingy: 0.92, flirty: 0.95, sulky: 0.95, moody: 0.97, happy: 1.05, sassy: 1.05, jealous: 1.05, love: 0.93, hurt: 0.86, hate: 1.08, angry: 1.1, hyper: 1.18 };
const CHEERFUL = new Set(['happy', 'hyper', 'flirty', 'sassy']);
async function hindiSpeech(env, text, girl, errors, mp3Only, mood) {
  if (env.SARVAM_API_KEY) {
    try {
      const speaker = (girl ? env.SARVAM_GIRL : env.SARVAM_BOY) || (girl ? 'priya' : 'aditya');
      const base = { text: text.slice(0, 1500), speaker, model: env.SARVAM_MODEL || 'bulbul:v3', pace: MOOD_PACE[mood] || 1.0, output_audio_codec: 'mp3', speech_sample_rate: 24000 };
      for (const field of ['language_code', 'target_language_code']) {
        const r = await fetch(env.SARVAM_TTS_URL || 'https://api.sarvam.ai/text-to-speech', { method: 'POST', headers: { 'Content-Type': 'application/json', 'api-subscription-key': env.SARVAM_API_KEY }, body: JSON.stringify({ ...base, [field]: 'hi-IN' }) });
        const d = await r.json().catch(() => ({}));
        if (r.ok && d.audios && d.audios[0]) { const bytes = b64ToBytes(d.audios[0]); if (bytes.length > 500) return { bytes, mime: 'audio/mpeg', ext: 'mp3', engine: 'sarvam' }; }
        if (r.status !== 422 && r.status !== 400) { errors.push('sarvam ' + r.status); break; }
        errors.push('sarvam ' + r.status + ' ' + JSON.stringify(d).slice(0, 100));
      }
    } catch (e) { errors.push('sarvam: ' + (e && e.message)); }
  }
  if (env.GEMINI_API_KEY && !mp3Only) {
    try {
      const voice = (girl ? env.GEMINI_GIRL : env.GEMINI_BOY) || (girl ? 'Kore' : 'Puck');
      const model = env.GEMINI_TTS_MODEL || 'gemini-2.5-flash-preview-tts';
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
        body: JSON.stringify({ contents: [{ parts: [{ text: `Say this in a ${girl ? 'sweet, cheerful young woman' : 'friendly young man'}'s natural, warm voice, like talking to a close friend: ${text.slice(0, 1200)}` }] }], generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } } }),
      });
      const d = await r.json().catch(() => ({}));
      const part = d && d.candidates && d.candidates[0] && d.candidates[0].content && d.candidates[0].content.parts && d.candidates[0].content.parts.find((x) => x.inlineData);
      if (r.ok && part) { const bytes = wavFromPcm(b64ToBytes(part.inlineData.data)); if (bytes.length > 500) return { bytes, mime: 'audio/wav', ext: 'wav', engine: 'gemini' }; }
      else errors.push('gemini ' + r.status + ' ' + JSON.stringify(d).slice(0, 100));
    } catch (e) { errors.push('gemini: ' + (e && e.message)); }
  }
  return null;
}

export const GIRL_VOICES = ['hannah', 'autumn', 'diana'];
export const BOY_VOICES = ['troy', 'austin', 'daniel'];

async function toBytes(r) {
  if (!r) return null;
  if (r instanceof Uint8Array) return r;
  if (r instanceof ArrayBuffer) return new Uint8Array(r);
  if (typeof r === 'string') return b64ToBytes(r);
  if (typeof r.audio === 'string') return b64ToBytes(r.audio);
  if (typeof r.getReader === 'function') return new Uint8Array(await new Response(r).arrayBuffer());
  return null;
}

// Tries the best free voice first and falls back, so she always has a voice.
// opts: { gender: 'girl'|'boy', voice: 'hannah', mp3: true }  (mp3 is for Telegram, which cannot play wav)
// Returns { bytes, mime, ext, engine } or throws when nothing worked (the browser voice then takes over).
export async function textToSpeech(env, text, opts = {}) {
  text = String(text || '').trim().slice(0, 1000);
  if (!text) throw Object.assign(new Error('Nothing to say.'), { status: 400 });
  const girl = opts.gender !== 'boy';
  const errors = [];
  if (looksHindi(text, opts.language)) {
    const h = await hindiSpeech(env, text, girl, errors, !!opts.mp3, opts.mood);
    if (h) return h;
  }
  if (!canSpeakOnServer(text)) throw Object.assign(new Error('Hindi uses the browser voice until a Hindi voice key is added.'), { status: 422 });

  if (hasGroq(env) && !opts.mp3) {
    try {
      const pool = girl ? GIRL_VOICES : BOY_VOICES;
      const voice = pool.includes(opts.voice) ? opts.voice : pool[0];
      const style = girl && (!opts.mood || CHEERFUL.has(opts.mood)) ? '[cheerful] ' : '';       // no cheerful voice when she is sad, angry or sleepy
      const r = await groqFetch(env, 'tts', (key) => fetch((env.GROQ_TTS_URL || 'https://api.groq.com/openai/v1/audio/speech'), {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: env.TTS_GROQ_MODEL || 'canopylabs/orpheus-v1-english', input: style + text, voice, response_format: 'wav' }),
      }));
      if (r.ok) { const bytes = new Uint8Array(await r.arrayBuffer()); if (bytes.length > 500) return { bytes, mime: 'audio/wav', ext: 'wav', engine: 'orpheus' }; }
      else errors.push('orpheus ' + r.status + ' ' + (await r.text().catch(() => '')).slice(0, 120));
    } catch (e) { errors.push('orpheus: ' + (e && e.message)); }
  }
  if (env.AI) {
    try {
      const speaker = (girl ? env.TTS_AURA_GIRL : env.TTS_AURA_BOY) || (girl ? 'luna' : 'orion');
      const bytes = await toBytes(await env.AI.run('@cf/deepgram/aura-2-en', { text, speaker, encoding: 'mp3' }));
      if (bytes && bytes.length > 500) return { bytes, mime: 'audio/mpeg', ext: 'mp3', engine: 'aura' };
    } catch (e) { errors.push('aura: ' + (e && e.message)); }
    try {
      const bytes = await toBytes(await env.AI.run('@cf/myshell-ai/melotts', { prompt: text, lang: 'en' }));
      if (bytes && bytes.length > 500) return { bytes, mime: 'audio/mpeg', ext: 'mp3', engine: 'melo' };
    } catch (e) { errors.push('melo: ' + (e && e.message)); }
  }
  console.error('[tts] all voices failed', errors.join(' | '));
  throw Object.assign(new Error('Voice is unavailable right now.'), { status: 502 });
}
