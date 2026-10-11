// Reads links and searches the web (no API key). Everything fetched is treated as untrusted data.
import { clip } from './util.js';

const UA = 'Mozilla/5.0 (compatible; TinyBot/1.0; personal assistant)';
const ent = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#x27;': "'", '&nbsp;': ' ' };
const decode = (s) => String(s).replace(/&(amp|lt|gt|quot|nbsp|#39|#x27);/g, (m) => ent[m] || m).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Math.min(+n, 0x10ffff)));

export const urlsIn = (t) => [...new Set((String(t).match(/https?:\/\/[^\s<>"')]+/gi) || []).map((u) => u.replace(/[.,;!?]+$/, '')))].slice(0, 2);
function okUrl(u) {
  try { const x = new URL(u); return /^https?:$/.test(x.protocol) && x.hostname.includes('.') && !/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.)/i.test(x.hostname) && !/\.(local|internal)$/i.test(x.hostname); } catch { return false; }
}
export function htmlToText(html) {
  return decode(String(html)
    .replace(/<(script|style|noscript|svg|template|iframe)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/?(p|div|br|li|tr|h[1-6]|section|article|header|footer|ul|ol|table)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t\f\r]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
async function readLimited(res, max = 400000) {
  const rd = res.body && res.body.getReader ? res.body.getReader() : null;
  if (!rd) return (await res.text()).slice(0, max);
  const dec = new TextDecoder(); let out = '';
  while (out.length < max) { const { done, value } = await rd.read(); if (done) break; out += dec.decode(value, { stream: true }); }
  try { await rd.cancel(); } catch { /* ignore */ }
  return out;
}

export async function readUrl(u, max = 6000) {
  if (!okUrl(u)) return null;
  try {
    const res = await fetch(u, { headers: { 'User-Agent': UA, Accept: 'text/html,text/plain,application/json;q=0.9,*/*;q=0.5' }, redirect: 'follow', signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') || '';
    if (!/text\/|json|xml/i.test(type)) return { url: u, title: u, text: `(this link is a ${type || 'file'}, not a web page I can read)` };
    const raw = await readLimited(res);
    const title = decode((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(raw) || [])[1] || '').trim();
    const text = /html/i.test(type) ? htmlToText(raw) : raw;
    return { url: u, title: clip(title || u, 140), text: clip(text, max) };
  } catch { return null; }
}

export async function searchWeb(q) {
  q = clip(String(q).replace(/\s+/g, ' ').trim(), 150);
  if (!q) return [];
  try {
    const res = await fetch('https://html.duckduckgo.com/html/', { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'q=' + encodeURIComponent(q), signal: AbortSignal.timeout(7000) });
    const html = await res.text();
    const out = [];
    const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
    let m;
    while ((m = re.exec(html)) && out.length < 5) {
      let href = decode(m[1]); const g = /[?&]uddg=([^&]+)/.exec(href); if (g) href = decodeURIComponent(g[1]);
      if (href.startsWith('//')) href = 'https:' + href;
      if (!/^https?:/.test(href) || /duckduckgo\.com\/y\.js/.test(href)) continue;
      out.push({ url: href, title: clip(htmlToText(m[2]), 120), snippet: clip(htmlToText(m[3]), 300) });
    }
    if (out.length) return out;
  } catch { /* fall back below */ }
  try {
    const res = await fetch('https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=4&srsearch=' + encodeURIComponent(q), { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(6000) });
    const d = await res.json();
    return ((d.query && d.query.search) || []).map((x) => ({ url: 'https://en.wikipedia.org/wiki/' + encodeURIComponent(x.title.replace(/ /g, '_')), title: x.title, snippet: clip(htmlToText(x.snippet), 300) }));
  } catch { return []; }
}

export const needsSearch = (t) => /^\/(search|google)\b/i.test(t) || /\b(search (for|about|the web|online)|google (it|this|for)|look ?up|find out|search karo|net pe dhundo|dhundh\w*|news|headlines|who won|score of|price of|weather (in|at|of|today)|release date|trending|latest (news|update|version|episode|movie|result))\b/i.test(t);

// Builds the "what the web says" block for the system prompt, or '' when nothing was found.
export async function webContext(text) {
  const parts = [];
  const links = urlsIn(text);
  if (links.length) {
    const pages = await Promise.all(links.map((u) => readUrl(u, 7000)));
    pages.forEach((p, i) => parts.push(p ? `Page they sent: ${p.title} (${p.url})\n${p.text}` : `Could not open the link ${links[i]}: tell them honestly it did not load.`));
  }
  if (needsSearch(text) && !links.length) {
    const q = String(text).replace(/^\/(search|google)\b/i, '').replace(/\b(please|can you|could you|tiny|byte|search (for|about)|google|look ?up|find out|search karo)\b/gi, ' ').replace(/\s+/g, ' ').trim();
    const hits = await searchWeb(q || text);
    if (!hits.length) parts.push('Web search found nothing or was unavailable: tell them honestly, do not guess recent facts.');
    else {
      const pages = await Promise.all(hits.slice(0, 2).map((h) => readUrl(h.url, 2500)));
      parts.push('Web search results for "' + clip(q || text, 100) + '":\n' + hits.map((h, i) => `${i + 1}. ${h.title} (${h.url})\n   ${h.snippet}`).join('\n') + (pages.some(Boolean) ? '\n\nTop pages:\n' + pages.filter(Boolean).map((p) => `- ${p.title} (${p.url})\n${p.text}`).join('\n\n') : ''));
    }
  }
  return parts.join('\n\n====\n\n');
}
