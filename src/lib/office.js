// Word (.docx) and Excel (.xlsx): read them as text, and build new ones.
import { readZip, writeZip } from './zip.js';
import { clip } from './util.js';

const ent = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };
const unx = (s) => String(s).replace(/&(amp|lt|gt|quot|apos);/g, (m) => ent[m]).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

// ---------------- reading ----------------
function paraText(x) {
  return unx(x.replace(/<w:tab\/>/g, '\t').replace(/<w:br[^>]*\/>/g, '\n').replace(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g, '$1').replace(/<\/?w:[^>]+>/g, '')
    .replace(/<[^>]+>/g, ''));
}
export function docxXmlToText(xml) {
  const out = []; let row = null, cell = null;
  const re = /<w:tbl>|<\/w:tbl>|<w:tr[ >]|<\/w:tr>|<w:tc>|<\/w:tc>|<w:p[ >][\s\S]*?<\/w:p>/g;
  let m;
  while ((m = re.exec(xml))) {
    const t = m[0];
    if (t === '</w:tbl>') out.push('');
    else if (t.startsWith('<w:tr')) row = [];
    else if (t === '</w:tr>') { if (row) out.push('| ' + row.join(' | ') + ' |'); row = null; }
    else if (t === '<w:tc>') cell = [];
    else if (t === '</w:tc>') { if (row && cell) row.push(cell.join(' ').trim()); cell = null; }
    else if (t.startsWith('<w:p')) {
      const text = paraText(t).replace(/ /g, ' ').trimEnd();
      if (cell) { if (text.trim()) cell.push(text.trim()); continue; }
      const h = /<w:pStyle w:val="(?:Heading|heading)\s?(\d)"/.exec(t), title = /<w:pStyle w:val="Title"/.test(t), li = /<w:numPr>/.test(t);
      if (!text.trim()) { if (out.length && out[out.length - 1] !== '') out.push(''); continue; }
      out.push((h ? '#'.repeat(Math.min(4, +h[1])) + ' ' : title ? '# ' : li ? '- ' : '') + text);
    }
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
export async function docxToText(bytes) {
  const z = readZip(bytes), xml = await z.text('word/document.xml');
  if (!xml) throw new Error('This does not look like a Word .docx file.');
  return docxXmlToText(xml);
}

const colNum = (ref) => { let n = 0; for (const ch of /^[A-Z]+/.exec(ref)[0]) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
const csvCell = (v) => (/[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v);
export async function xlsxToText(bytes, { maxRows = 400 } = {}) {
  const z = readZip(bytes);
  const wb = await z.text('xl/workbook.xml');
  if (!wb) throw new Error('This does not look like an Excel .xlsx file.');
  const shared = [];
  const ss = await z.text('xl/sharedStrings.xml');
  if (ss) for (const si of ss.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(unx([...si[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join('')));
  const names = [...wb.matchAll(/<sheet\s[^>]*name="([^"]*)"/g)].map((x) => unx(x[1]));
  const sheetFiles = z.names.filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort((a, b) => parseInt(a.match(/(\d+)\.xml/)[1], 10) - parseInt(b.match(/(\d+)\.xml/)[1], 10));
  const out = [];
  for (let i = 0; i < sheetFiles.length && i < 8; i++) {
    const xml = await z.text(sheetFiles[i]); const rows = [];
    for (const r of String(xml).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      if (rows.length >= maxRows) break;
      const cells = [];
      for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1], body = c[2] || '', ref = /r="([A-Z]+\d+)"/.exec(attrs), type = (/t="(\w+)"/.exec(attrs) || [])[1];
        const v = (/<v>([\s\S]*?)<\/v>/.exec(body) || [])[1], f = (/<f[^>]*>([\s\S]*?)<\/f>/.exec(body) || [])[1];
        let val = '';
        if (type === 's') val = shared[+v] ?? ''; else if (type === 'inlineStr') val = unx([...body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join('')); else if (type === 'b') val = v === '1' ? 'TRUE' : 'FALSE'; else val = v !== undefined ? unx(v) : '';
        if (f && !val) val = '=' + unx(f);
        if (ref) cells[colNum(ref[1])] = val;
      }
      if (cells.some((x) => x !== undefined && x !== '')) rows.push(Array.from(cells, (x) => csvCell(x ?? '')).join(','));
    }
    out.push(`## Sheet: ${names[i] || 'Sheet' + (i + 1)}\n` + rows.join('\n'));
  }
  return out.join('\n\n').trim();
}

// ---------------- building ----------------
const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
function runs(text, extra = '') {
  const parts = String(text).split(/(\*\*[^*]+\*\*)/).filter(Boolean);
  return parts.map((p) => { const b = /^\*\*([^*]+)\*\*$/.exec(p); return `<w:r><w:rPr>${b ? '<w:b/>' : ''}${extra}</w:rPr><w:t xml:space="preserve">${esc(b ? b[1] : p)}</w:t></w:r>`; }).join('');
}
const para = (text, style, list) => `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${list ? '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>' : ''}</w:pPr>${runs(text)}</w:p>`;
function table(rows) {
  const w = Math.floor(9000 / Math.max(1, rows[0].length));
  const bd = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((s) => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="C9C0F5"/>`).join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>${bd}</w:tblBorders></w:tblPr>` + rows.map((r, i) => `<w:tr>${r.map((c) => `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${i === 0 ? '<w:shd w:val="clear" w:color="auto" w:fill="EEEAFF"/>' : ''}</w:tcPr><w:p>${i === 0 ? `<w:r><w:rPr><w:b/><w:color w:val="573AFC"/></w:rPr><w:t xml:space="preserve">${esc(c.replace(/\*\*/g, ''))}</w:t></w:r>` : runs(c)}</w:p></w:tc>`).join('')}</w:tr>`).join('') + '</w:tbl><w:p/>';
}
export function markdownToDocx(md) {
  const lines = String(md).replace(/\r/g, '').split('\n'); const body = []; let tbl = [];
  const flush = () => { if (tbl.length) { body.push(table(tbl)); tbl = []; } };
  for (const l of lines) {
    let m;
    if (/^\s*\|.*\|\s*$/.test(l)) { if (/^\s*\|[\s:|-]+\|\s*$/.test(l)) continue; tbl.push(l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())); continue; }
    flush();
    if (!l.trim()) body.push('<w:p/>');
    else if ((m = /^#\s+(.*)/.exec(l))) body.push(para(m[1], 'Heading1'));
    else if ((m = /^##\s+(.*)/.exec(l))) body.push(para(m[1], 'Heading2'));
    else if ((m = /^#{3,}\s+(.*)/.exec(l))) body.push(para(m[1], 'Heading3'));
    else if ((m = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s*)?(.*)/.exec(l))) body.push(para(m[1], '', true));
    else body.push(para(l, ''));
  }
  flush();
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${NS}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Mangal"/><w:color w:val="1B2559"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>` +
    [['Heading1', 36, 240], ['Heading2', 28, 200], ['Heading3', 24, 160]].map(([id, sz, before], i) => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="heading ${i + 1}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="${before}" w:after="80"/><w:outlineLvl w:val="${i}"/></w:pPr><w:rPr><w:b/><w:color w:val="573AFC"/><w:sz w:val="${sz}"/></w:rPr></w:style>`).join('') +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style></w:styles>';
  const numbering = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering ${NS}><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  return writeZip([
    { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>' },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>' },
    { name: 'word/_rels/document.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>' },
    { name: 'word/document.xml', data: doc }, { name: 'word/styles.xml', data: styles }, { name: 'word/numbering.xml', data: numbering },
  ]);
}

export function parseCsv(text) {
  const rows = []; let row = [], cur = '', q = false; const s = String(text).replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) { if (ch === '"') { if (s[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && s[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.some((c) => c !== '')) rows.push(row); row = []; }
    else cur += ch;
  }
  row.push(cur); if (row.some((c) => c !== '')) rows.push(row);
  return rows;
}
const colName = (n) => { let s = ''; for (n++; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
export function csvToXlsx(csv, sheetName = 'Sheet1') {
  const rows = parseCsv(csv).slice(0, 5000), width = Math.max(1, ...rows.map((r) => r.length));
  const widths = Array.from({ length: width }, (_, c) => Math.min(48, Math.max(8, ...rows.slice(0, 200).map((r) => String(r[c] || '').length + 2))));
  const sheetRows = rows.map((r, ri) => `<row r="${ri + 1}">` + Array.from({ length: width }, (_, c) => {
    const v = (r[c] ?? '').trim(), ref = colName(c) + (ri + 1), st = ri === 0 ? ' s="1"' : '';
    if (v === '') return ri === 0 ? `<c r="${ref}"${st}/>` : '';
    if (v[0] === '=' && v.length > 1) return `<c r="${ref}"${st}><f>${esc(v.slice(1))}</f></c>`;
    if (ri > 0 && /^-?\d+(\.\d+)?$/.test(v) && !/^-?0\d/.test(v)) return `<c r="${ref}"><v>${v}</v></c>`;
    return `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
  }).join('') + '</row>').join('');
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${sheetRows}</sheetData></worksheet>`;
  const styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF573AFC"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs></styleSheet>';
  return writeZip([
    { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>' },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${esc(clip(sheetName, 30))}" sheetId="1" r:id="rId1"/></sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
    { name: 'xl/worksheets/sheet1.xml', data: sheet }, { name: 'xl/styles.xml', data: styles },
  ]);
}
