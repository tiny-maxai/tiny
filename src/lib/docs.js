// Reads files people send: HTML, PDF and plain text formats. Nothing is stored; the text is only used for the chat.
import { htmlToText } from './web.js';
import { clip } from './util.js';
import { isImage, readImage } from './ocr.js';
import { docxToText, xlsxToText } from './office.js';

const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|xml|js|ts|py|c|cpp|java|css|log|yaml|yml|ini|sql)$/i;
export const MAX_DOC_CHARS = 16000;

async function inflate(bytes) {
  const ds = new DecompressionStream('deflate');
  const w = ds.writable.getWriter(); w.write(bytes).catch(() => {}); w.close().catch(() => {});
  return new Uint8Array(await new Response(ds.readable).arrayBuffer());
}
function a85(bytes) {
  let s = latin(bytes).replace(/\s+/g, ''); s = s.replace(/^<~/, ''); const e = s.indexOf('~>'); if (e >= 0) s = s.slice(0, e);
  const out = []; let g = [];
  for (const ch of s) {
    if (ch === 'z' && !g.length) { out.push(0, 0, 0, 0); continue; }
    g.push(ch.charCodeAt(0) - 33);
    if (g.length === 5) { let v = 0; for (const x of g) v = v * 85 + x; out.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255); g = []; }
  }
  if (g.length > 1) { const n = g.length; while (g.length < 5) g.push(84); let v = 0; for (const x of g) v = v * 85 + x; const b = [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]; out.push(...b.slice(0, n - 1)); }
  return new Uint8Array(out);
}
const latin = (b) => { let s = ''; for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode.apply(null, b.subarray(i, i + 8192)); return s; };
const unesc = (s) => s.replace(/\\([nrtbf()\\])|\\(\d{1,3})/g, (m, c, o) => c ? ({ n: '\n', r: '', t: ' ', b: '', f: '' }[c] ?? c) : String.fromCharCode(parseInt(o, 8)));

// Fallback reader for simple text PDFs (used when Workers AI cannot convert the file).
export async function pdfTextBasic(bytes) {
  const raw = latin(bytes), out = [];
  const re = /<<([^>]*(?:>(?!>)[^>]*)*)>>\s*stream\r?\n/g;
  let m;
  while ((m = re.exec(raw)) && out.length < 400) {
    const start = re.lastIndex, end = raw.indexOf('endstream', start);
    if (end < 0) break;
    let data = bytes.subarray(start, end);
    if (/ASCII85Decode/.test(m[1])) data = a85(data);
    if (/FlateDecode/.test(m[1])) { try { data = await inflate(data); } catch { continue; } }
    else if (/\/(Image|XObject|Font)/.test(m[1])) continue;
    const s = latin(data);
    if (!/\b(Tj|TJ)\b/.test(s)) continue;
    let page = '';
    for (const t of s.matchAll(/\[((?:[^\]\\]|\\.)*)\]\s*TJ|\(((?:[^)\\]|\\.)*)\)\s*(?:Tj|'|")/g)) {
      if (t[1] !== undefined) page += [...t[1].matchAll(/\(((?:[^)\\]|\\.)*)\)|(-?\d+\.?\d*)/g)].map((x) => (x[1] !== undefined ? unesc(x[1]) : (+x[2] < -200 ? ' ' : ''))).join('');
      else page += unesc(t[2]);
      page += /\bT[*dD]\b|\bET\b/.test(s.slice(t.index, t.index + t[0].length + 30)) ? '\n' : ' ';
    }
    if (page.trim()) out.push(page.replace(/[ \t]+/g, ' ').trim());
  }
  return out.join('\n\n');
}

async function pdfText(env, bytes, name) {
  if (env.AI && env.AI.toMarkdown) {
    try {
      const r = await env.AI.toMarkdown({ name: name || 'file.pdf', blob: new Blob([bytes], { type: 'application/pdf' }) });
      const d = Array.isArray(r) ? r[0] : r;
      if (d && d.data && String(d.data).trim().length > 20) return String(d.data);
    } catch (e) { console.error('[toMarkdown]', e && e.message); }
  }
  return pdfTextBasic(bytes);
}

// Returns { kind, text } or throws a friendly error.
export async function docText(env, bytes, name = 'file', mime = '') {
  const ext = (/\.([a-z0-9]+)$/i.exec(name) || [])[1] || '';
  let kind, text;
  if (/pdf/i.test(mime) || ext.toLowerCase() === 'pdf' || (bytes.length > 4 && latin(bytes.subarray(0, 5)) === '%PDF-')) { kind = 'PDF'; text = await pdfText(env, bytes, name); }
  else if (ext.toLowerCase() === 'docx' || /wordprocessingml/i.test(mime)) { kind = 'Word'; text = await docxToText(bytes); }
  else if (ext.toLowerCase() === 'xlsx' || /spreadsheetml/i.test(mime)) { kind = 'Excel'; text = await xlsxToText(bytes); }
  else if (/^(doc|xls|ppt)$/i.test(ext)) throw Object.assign(new Error('That is an old Word/Excel format. Please save it as .docx or .xlsx and send again.'), { status: 415 });
  else if (isImage(name, mime)) { kind = 'picture'; text = await readImage(env, bytes, name, mime); }
  else if (/html?/i.test(ext) || /html/i.test(mime)) { kind = 'HTML'; text = htmlToText(new TextDecoder().decode(bytes)); }
  else if (TEXT_EXT.test(name) || /^text\//i.test(mime) || /json|xml/i.test(mime)) { kind = 'text'; text = new TextDecoder().decode(bytes); }
  else throw Object.assign(new Error('I can read pictures, PDF, Word, Excel, HTML and text files (txt, md, csv, json, code). That one is another type.'), { status: 415 });
  text = String(text || '').replace(/\u0000/g, '').trim();
  if (text.length < 5) throw Object.assign(new Error(kind === 'PDF' ? 'I could not find any text in that PDF. It may be scanned pictures, which I cannot read.' : 'That file looks empty.'), { status: 422 });
  return { kind, text: clip(text, 60000) };
}
// What goes into the chat message: the file text plus what the person wants.
export const fileMessage = (name, text, ask) => `[File: ${name}]\n${clip(text, MAX_DOC_CHARS)}\n[End of file]\n\n${ask || 'Read this file, tell me in a few short lines what it is about, and ask what I want to do with it.'}`;
