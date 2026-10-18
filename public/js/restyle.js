// Change a picture: instant filters in the browser, AI styles (cartoon, anime...) through her Worker.
(() => {
  const App = window.App, $ = (s) => document.querySelector(s);
  if (!App || !$('#styleModal')) return;
  let src = null, resultUrl = '';                       // src = canvas with the original (max 1024)
  const FILTERS = {
    orig: ['Original', null],
    bw: ['Black and white', (d) => { for (let i = 0; i < d.length; i += 4) { const g = d[i] * .299 + d[i + 1] * .587 + d[i + 2] * .114; d[i] = d[i + 1] = d[i + 2] = g; } }],
    sepia: ['Sepia', (d) => { for (let i = 0; i < d.length; i += 4) { const r = d[i], g = d[i + 1], b = d[i + 2]; d[i] = Math.min(255, r * .393 + g * .769 + b * .189); d[i + 1] = Math.min(255, r * .349 + g * .686 + b * .168); d[i + 2] = Math.min(255, r * .272 + g * .534 + b * .131); } }],
    vintage: ['Vintage', (d) => { for (let i = 0; i < d.length; i += 4) { const r = d[i], g = d[i + 1], b = d[i + 2]; d[i] = Math.min(255, r * .9 + g * .3 + b * .1 + 12); d[i + 1] = Math.min(255, r * .2 + g * .8 + b * .1 + 6); d[i + 2] = Math.min(255, r * .15 + g * .25 + b * .6); } }],
    vivid: ['Vivid', (d) => { for (let i = 0; i < d.length; i += 4) { const g = d[i] * .299 + d[i + 1] * .587 + d[i + 2] * .114; for (let k = 0; k < 3; k++) d[i + k] = Math.max(0, Math.min(255, g + (d[i + k] - g) * 1.5)); } }],
    warm: ['Warm', (d) => { for (let i = 0; i < d.length; i += 4) { d[i] = Math.min(255, d[i] * 1.1 + 8); d[i + 2] = d[i + 2] * .9; } }],
    cool: ['Cool', (d) => { for (let i = 0; i < d.length; i += 4) { d[i] = d[i] * .9; d[i + 2] = Math.min(255, d[i + 2] * 1.12 + 8); } }],
    bright: ['Brighter', (d) => { for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) d[i + k] = Math.min(255, d[i + k] * 1.18 + 10); }],
    negative: ['Negative', (d) => { for (let i = 0; i < d.length; i += 4) { d[i] = 255 - d[i]; d[i + 1] = 255 - d[i + 1]; d[i + 2] = 255 - d[i + 2]; } }],
    blur: ['Soft blur', 'blur'],
  };
  const AI = { cartoon: 'Cartoon', anime: 'Anime', sketch: 'Pencil sketch', oil: 'Oil painting', watercolor: 'Watercolor', pixel: 'Pixel art', comic: 'Comic', clay: '3D clay', neon: 'Neon night' };
  const chip = (box, key, label, fn) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.style.cursor = 'pointer'; b.textContent = label; b.addEventListener('click', () => fn(b)); box.appendChild(b); return b; };
  const show = (url, dl) => { $('#styleImg').src = url; const a = $('#styleDl'); a.hidden = !dl; if (dl) a.href = dl; };
  const toBlob = (cv, q = .9) => new Promise((r) => cv.toBlob(r, 'image/jpeg', q));

  $('#styleFilters').textContent = ''; $('#styleAi').textContent = '';
  Object.entries(FILTERS).forEach(([k, [label, fn]]) => chip($('#styleFilters'), k, label, async () => {
    if (!src) return;
    const cv = document.createElement('canvas'); cv.width = src.width; cv.height = src.height; const cx = cv.getContext('2d');
    if (fn === 'blur') { const s = document.createElement('canvas'); s.width = Math.max(8, src.width / 8 | 0); s.height = Math.max(8, src.height / 8 | 0); s.getContext('2d').drawImage(src, 0, 0, s.width, s.height); cx.imageSmoothingQuality = 'high'; cx.drawImage(s, 0, 0, cv.width, cv.height); }
    else { cx.drawImage(src, 0, 0); if (fn) { const im = cx.getImageData(0, 0, cv.width, cv.height); fn(im.data); cx.putImageData(im, 0, 0); } }
    const bl = await toBlob(cv); if (resultUrl) URL.revokeObjectURL(resultUrl); resultUrl = URL.createObjectURL(bl); show(resultUrl, resultUrl); $('#styleMsg').textContent = label + ' applied.';
  }));
  Object.entries(AI).forEach(([k, label]) => chip($('#styleAi'), k, label, async (b) => {
    if (!src) return;
    const all = $('#styleAi').querySelectorAll('button'); all.forEach((x) => (x.disabled = true));
    $('#styleMsg').textContent = 'She is drawing it... this takes about 10 to 20 seconds.';
    try {
      const sm = document.createElement('canvas'), s = Math.min(1, 640 / Math.max(src.width, src.height)); sm.width = Math.round(src.width * s); sm.height = Math.round(src.height * s); sm.getContext('2d').drawImage(src, 0, 0, sm.width, sm.height);
      const bl = await toBlob(sm, .85), r = await App.api('/api/restyle?style=' + k, { body: await bl.arrayBuffer(), headers: { 'Content-Type': 'image/jpeg' } });
      show(r.url, r.url); $('#styleMsg').textContent = label + ' done. ' + r.left + ' more AI styles today.';
    } catch (e) { $('#styleMsg').textContent = e.message || 'Could not change it.'; } finally { all.forEach((x) => (x.disabled = false)); }
  }));

  $('#styleFile').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    const img = new Image(), url = URL.createObjectURL(f);
    img.onload = () => {
      const s = Math.min(1, 1024 / Math.max(img.width, img.height)), cv = document.createElement('canvas'); cv.width = Math.round(img.width * s); cv.height = Math.round(img.height * s);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height); src = cv; URL.revokeObjectURL(url);
      $('#styleStage').hidden = false; show(cv.toDataURL('image/jpeg', .9), ''); $('#styleMsg').textContent = 'Pick a look below.';
    };
    img.onerror = () => App.toast('I could not open that picture.');
    img.src = url;
  });
  $('#styleBtn').addEventListener('click', () => { $('#styleModal').hidden = false; });
  $('#styleClose').addEventListener('click', () => { $('#styleModal').hidden = true; });
  $('#styleModal').addEventListener('click', (e) => { if (e.target.id === 'styleModal') $('#styleModal').hidden = true; });
})();
