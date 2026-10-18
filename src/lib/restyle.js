// Change the style of a picture you send ("make it cartoon", "black and white").
// Groq has no image-editing model (only models that READ pictures), so this uses Cloudflare Workers AI image-to-image,
// which is already bound to this Worker (the same binding that draws pictures) and is free inside the daily free allowance.
import { uid, istDate, clip } from './util.js';

const MODEL = '@cf/runwayml/stable-diffusion-v1-5-img2img';
export const STYLES = {
  cartoon: { label: 'Cartoon', prompt: 'cartoon illustration, bold clean outlines, flat bright colors, cel shading, cute, high quality', neg: 'photo, realistic, blurry, deformed, ugly, text, watermark', strength: 0.62 },
  anime: { label: 'Anime', prompt: 'anime style illustration, soft shading, big expressive eyes, pastel colors, detailed, high quality', neg: 'photo, realistic, blurry, deformed, ugly, text, watermark', strength: 0.65 },
  sketch: { label: 'Pencil sketch', prompt: 'pencil sketch drawing, graphite shading, hand drawn lines, white paper, monochrome', neg: 'color, colorful, photo, blurry, text, watermark', strength: 0.7 },
  oil: { label: 'Oil painting', prompt: 'oil painting, thick brush strokes, rich colors, canvas texture, masterpiece', neg: 'photo, blurry, deformed, text, watermark', strength: 0.6 },
  watercolor: { label: 'Watercolor', prompt: 'watercolor painting, soft washes, paper texture, gentle pastel colors, delicate', neg: 'photo, harsh, deformed, text, watermark', strength: 0.62 },
  pixel: { label: 'Pixel art', prompt: 'pixel art, 16-bit retro game style, limited color palette, crisp pixels', neg: 'photo, blurry, smooth, text, watermark', strength: 0.7 },
  comic: { label: 'Comic', prompt: 'comic book pop art, halftone dots, bold ink outlines, vivid colors', neg: 'photo, blurry, deformed, text, watermark', strength: 0.65 },
  clay: { label: '3D clay', prompt: '3d clay figurine style, soft plasticine, smooth surfaces, studio lighting, cute', neg: 'photo, blurry, deformed, text, watermark', strength: 0.65 },
  neon: { label: 'Neon night', prompt: 'neon cyberpunk night scene, glowing purple and blue lights, futuristic, cinematic', neg: 'blurry, deformed, text, watermark', strength: 0.6 },
  bw: { label: 'Black and white', prompt: 'black and white photograph, monochrome, grayscale, high contrast, sharp', neg: 'color, colorful, saturated, blurry', strength: 0.4 },
  sepia: { label: 'Sepia', prompt: 'sepia toned old photograph, brown tint, warm aged paper, sharp', neg: 'colorful, blue, green, blurry', strength: 0.42 },
  vintage: { label: 'Vintage', prompt: 'vintage retro film photo, faded colors, film grain, warm tone, sharp', neg: 'blurry, modern, oversaturated', strength: 0.42 },
};
const RULES = [
  ['bw', /\b(black ?(and|&|n|-) ?white|b ?& ?w|b\/w|bw|gr[ae]y ?scale|monochrome)\b/i], ['sepia', /\bsepia\b/i], ['vintage', /\b(vintage|retro|old (photo|look|film))\b/i],
  ['cartoon', /\bcartoon(ify|ize|ed)?\b/i], ['anime', /\b(anime|manga)\b/i], ['sketch', /\b(sketch|pencil|line ?art)\b/i], ['oil', /\boil( paint(ing)?)?\b/i],
  ['watercolor', /\bwater ?colou?r\b/i], ['pixel', /\bpixel/i], ['comic', /\b(comic|pop ?art)\b/i], ['clay', /\b(clay|3 ?d)\b/i], ['neon', /\b(neon|cyberpunk)\b/i],
];
export const styleFromText = (t) => { const r = RULES.find(([, re]) => re.test(String(t || ''))); return r ? r[0] : null; };
// A short message that names a style and asks for a change (not "what is the cartoon in this?").
export const styleAsk = (t) => { t = String(t || '').trim(); return t.length > 0 && t.length <= 100 && !!styleFromText(t) && (/\b(make|turn|change|convert|apply|give|add|edit|style|filter|effect|into|to|banao|bana|kar do|karo|badlo|badal|like|version)\b/i.test(t) || t.split(/\s+/).length <= 3); };
export const wantsStyleMenu = (t) => /^\s*\/?(style|filter|filters|effect|edit ?photo)\b/i.test(String(t || '')) || /\b(change|apply|add|give)\b.*\b(style|filter|effect)\b/i.test(String(t || ''));

function dims(b) {
  if (b[0] === 0x89 && b[1] === 0x50 && b.length > 24) return [((b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19]) >>> 0, ((b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23]) >>> 0];
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i < b.length - 9) {
      if (b[i] !== 0xff) { i++; continue; }
      const mk = b[i + 1];
      if (mk >= 0xc0 && mk <= 0xcf && mk !== 0xc4 && mk !== 0xc8 && mk !== 0xcc) return [(b[i + 7] << 8) | b[i + 8], (b[i + 5] << 8) | b[i + 6]];
      i += 2 + ((b[i + 2] << 8) | b[i + 3]);
    }
  }
  return null;
}
export function fitSize(w, h) {
  if (!w || !h) return [512, 512];
  const s = Math.min(1, 640 / Math.max(w, h));
  return [Math.min(2048, Math.max(256, Math.round((w * s) / 8) * 8)), Math.min(2048, Math.max(256, Math.round((h * s) / 8) * 8))];
}
const toB64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };

export const DAILY = 12;
export async function restyle(env, bytes, key, note = '') {
  const st = STYLES[key]; if (!st) throw Object.assign(new Error('I do not know that style.'), { status: 400 });
  if (!env.AI) throw Object.assign(new Error('Changing pictures needs Workers AI, which is not set up on this Worker.'), { status: 503 });
  if (!bytes || bytes.length < 200) throw Object.assign(new Error('That picture looks empty.'), { status: 400 });
  if (bytes.length > 1500000) throw Object.assign(new Error('That picture is too big. Send it as a normal photo (not as a file) so it gets smaller.'), { status: 413 });
  const day = 'style:count:' + istDate(), n = Number(await env.KV.get(day).catch(() => 0)) || 0;
  if (n >= DAILY) throw Object.assign(new Error(`That is enough picture changing for today (${DAILY} a day).`), { status: 429 });
  const [w, h] = fitSize(...(dims(bytes) || [0, 0]));
  const out = await env.AI.run(MODEL, { prompt: clip(st.prompt + (note ? ', ' + note : ''), 400), negative_prompt: st.neg, image: Array.from(bytes), strength: st.strength, guidance: 7.5, num_steps: 20, width: w, height: h });
  let buf;
  if (out && typeof out.getReader === 'function') buf = new Uint8Array(await new Response(out).arrayBuffer());
  else if (out instanceof ArrayBuffer) buf = new Uint8Array(out);
  else if (ArrayBuffer.isView(out)) buf = new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
  else if (out && out.image) { const bin = atob(out.image); buf = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i); }
  if (!buf || buf.length < 500) throw new Error('No picture came back. Try again in a minute.');
  const id = uid().replace(/[^a-z0-9]/gi, '').slice(0, 14);
  await env.KV.put('img:' + id, toB64(buf), { expirationTtl: 14 * 86400 }).catch(() => null);
  await env.KV.put(day, String(n + 1), { expirationTtl: 2 * 86400 }).catch(() => null);
  return { id, bytes: buf, left: DAILY - n - 1 };
}
