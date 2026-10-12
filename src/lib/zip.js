// A tiny ZIP reader and writer (enough for .docx and .xlsx). Uses the Worker's built-in DecompressionStream.
const te = new TextEncoder(), td = new TextDecoder();

let CRC = null;
function crc32(bytes) {
  if (!CRC) { CRC = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; } }
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function inflateRaw(data) {
  const ds = new DecompressionStream('deflate-raw');
  const w = ds.writable.getWriter(); w.write(data).catch(() => {}); w.close().catch(() => {});
  return new Uint8Array(await new Response(ds.readable).arrayBuffer());
}

// Returns { names, read(name) -> Uint8Array|null, text(name) -> string|null }
export function readZip(bytes, { maxEntries = 3000, maxSize = 40 * 1024 * 1024 } = {}) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not a zip');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  if (count > maxEntries) throw new Error('zip too big');
  const entries = new Map();
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), usize = dv.getUint32(p + 24, true);
    const nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
    const name = td.decode(bytes.subarray(p + 46, p + 46 + nl));
    entries.set(name, { method, csize, usize, off });
    p += 46 + nl + el + cl;
  }
  const read = async (name) => {
    const e = entries.get(name); if (!e) return null;
    if (e.usize > maxSize) throw new Error('entry too big');
    const lh = e.off, nl = dv.getUint16(lh + 26, true), el = dv.getUint16(lh + 28, true), start = lh + 30 + nl + el;
    const raw = bytes.subarray(start, start + e.csize);
    return e.method === 0 ? raw : e.method === 8 ? inflateRaw(raw) : null;
  };
  return { names: [...entries.keys()], read, text: async (name) => { const b = await read(name); return b ? td.decode(b) : null; } };
}

// files: [{ name, data: Uint8Array | string }]  ->  Uint8Array (stored, no compression: files made here are small)
export function writeZip(files) {
  const parts = [], central = []; let offset = 0;
  const u16 = (v) => [v & 255, (v >> 8) & 255], u32 = (v) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
  for (const f of files) {
    const name = te.encode(f.name), data = typeof f.data === 'string' ? te.encode(f.data) : f.data, crc = crc32(data);
    const head = new Uint8Array([...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0)]);
    parts.push(head, name, data);
    central.push(new Uint8Array([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)]), name);
    offset += head.length + name.length + data.length;
  }
  const cdSize = central.reduce((a, b) => a + b.length, 0);
  const end = new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cdSize), ...u32(offset), ...u16(0)]);
  const all = [...parts, ...central, end], out = new Uint8Array(all.reduce((a, b) => a + b.length, 0));
  let o = 0; for (const a of all) { out.set(a, o); o += a.length; }
  return out;
}
