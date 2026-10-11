// Hindi <-> English with a note on tone, for Telegram (/tr) and chat.
import { complete } from './ai.js';
import { clip } from './util.js';

const HINGLISH = /\b(hai|hain|nahi|nahin|kya|kyun|kaise|kaisa|mujhe|mera|meri|mere|tum|tumhe|tumhara|aap|aapko|hum|main|mein|acha|achha|theek|thik|bahut|bohot|abhi|kal|aaj|raha|rahi|karo|karna|kar|ho|hoga|chahiye|yaar|bhai|pata|samajh|bol|bolo|dost)\b/gi;

export const wantsTranslate = (t) => /^\/tr(anslate)?\b/i.test(t) || /^translate\b/i.test(t);
export function payload(t) {
  return String(t).replace(/^\/tr(anslate)?\b|^translate\b/i, '').replace(/^\s*(this\s+)?(in)?to\s+(hindi|english|hinglish)\s*[:\-]?/i, '').replace(/^\s*(in|into)\s+(hindi|english|hinglish)\s*[:\-]?/i, '').trim();
}
export function targetFor(t) {
  const m = /\b(?:to|into|in)\s+(hindi|english|hinglish)\b/i.exec(String(t).slice(0, 60));
  if (m) return m[1].toLowerCase();
  const s = payload(t);
  if (/[ऀ-ॿ]/.test(s) || (s.match(HINGLISH) || []).length >= 2) return 'english';
  return 'hindi';
}

export async function translate(env, text) {
  const s = payload(text);
  if (!s) return 'Send the text after the command, like: /tr I am running late, sorry!';
  const target = targetFor(text);
  const sys = `You translate between Hindi and English for a friend, and explain the tone. Target: ${target === 'hindi' ? 'Hindi in Devanagari' : target === 'hinglish' ? 'Hinglish (Hindi in Roman letters)' : 'natural English'}.
Reply in exactly this plain-text format, no markdown:
Translation: <the translation, natural and how a real person would say it>
${target === 'hindi' ? 'Roman: <the same in Roman letters so it is easy to read aloud>\n' : ''}Tone: <one line: how it sounds, e.g. casual, polite, formal, affectionate, blunt, and who you would say it to>
Another way: <one alternative that is more formal or more casual>
Keep the whole answer short.`;
  const r = await complete(env, { brain: 'fast', temperature: 0.3, maxTokens: 500, messages: [{ role: 'system', content: sys }, { role: 'user', content: clip(s, 1500) }] });
  return r.text;
}
