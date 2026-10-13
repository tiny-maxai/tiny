// Lists: speak or type, she makes short points with fixed grammar. Tick things off.
(() => {
  const App = window.App, $ = (s) => document.querySelector(s);
  if (!App || !$('#view-lists')) return;
  let lists = [], cur = null, saveT = null, rec = null;

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const uid = () => 'i' + Math.random().toString(36).slice(2, 10);

  async function load() {
    try { lists = (await App.api('/api/lists')).lists || []; } catch (e) { App.toast(e.message); return; }
    paintGrid();
  }
  function paintGrid() {
    const g = $('#listGrid'); g.textContent = '';
    $('#listEmpty').hidden = lists.length > 0;
    lists.forEach((l) => {
      const done = l.items.filter((x) => x.done).length, pct = l.items.length ? Math.round((done / l.items.length) * 100) : 0;
      const b = document.createElement('button'); b.type = 'button'; b.className = 'note-card glass';
      b.innerHTML = '<b><svg class="ic"><use href="#i-list"/></svg>' + esc(l.title) + '</b><p>' + esc(l.items.slice(0, 4).map((x) => (x.done ? '✓ ' : '• ') + x.t).join('\n') || 'Empty list') + '</p><small class="muted">' + done + ' of ' + l.items.length + ' done</small><div class="l-prog"><i style="width:' + pct + '%"></i></div>';
      b.addEventListener('click', () => open(l));
      g.appendChild(b);
    });
  }
  function open(l) {
    cur = l; $('#listsHome').hidden = true; $('#listEd').hidden = false;
    $('#lTitle').value = l.title; paintItems();
  }
  function closeEd() { flush(); cur = null; $('#listEd').hidden = true; $('#listsHome').hidden = false; load(); }
  function paintItems() {
    const box = $('#lItems'); box.textContent = '';
    cur.items.forEach((it) => {
      const row = document.createElement('div'); row.className = 'l-row' + (it.done ? ' done' : '');
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!it.done; cb.setAttribute('aria-label', 'Done');
      const t = document.createElement('input'); t.className = 'l-t'; t.value = it.t; t.maxLength = 400; t.setAttribute('aria-label', 'Point');
      const x = document.createElement('button'); x.type = 'button'; x.className = 'l-x'; x.textContent = '×'; x.setAttribute('aria-label', 'Remove');
      cb.addEventListener('change', () => { it.done = cb.checked ? 1 : 0; row.classList.toggle('done', cb.checked); queue(); count(); });
      t.addEventListener('input', () => { it.t = t.value; queue(); });
      x.addEventListener('click', () => { cur.items = cur.items.filter((y) => y !== it); paintItems(); queue(); });
      row.append(cb, t, x); box.appendChild(row);
    });
    count();
  }
  const count = () => { $('#lCount').textContent = cur ? cur.items.filter((x) => x.done).length + ' of ' + cur.items.length + ' done' : ''; };
  function queue() { clearTimeout(saveT); saveT = setTimeout(flush, 600); }
  async function flush() {
    clearTimeout(saveT); if (!cur) return;
    const body = { title: $('#lTitle').value.trim() || 'New list', items: cur.items.filter((x) => String(x.t).trim()) };
    try { const r = await App.api('/api/lists/' + cur.id, { method: 'PATCH', body }); cur.title = r.list.title; } catch (e) { App.toast(e.message); }
  }
  function addPoints(points) {
    if (!cur) return;
    points.forEach((p) => { if (String(p).trim()) cur.items.push({ id: uid(), t: String(p).trim(), done: 0 }); });
    paintItems(); queue();
  }

  // ---------- recording (tap to start, tap again to stop) ----------
  async function record(btn, label) {
    if (rec) { rec.stop(); return null; }
    if (!navigator.mediaDevices || !window.MediaRecorder) { App.toast('Voice input is not supported in this browser'); return null; }
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); } catch { App.toast('Microphone permission is blocked'); return null; }
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find((t) => MediaRecorder.isTypeSupported(t)) || '';
    const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : {}), chunks = [];
    mr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    const span = btn.querySelector('span') || btn, old = span.textContent;
    btn.classList.add('rec'); span.textContent = 'Stop';
    const auto = setTimeout(() => mr.state !== 'inactive' && mr.stop(), 120000);
    return new Promise((resolve) => {
      rec = { stop: () => mr.state !== 'inactive' && mr.stop() };
      mr.onstop = () => {
        clearTimeout(auto); rec = null; stream.getTracks().forEach((t) => t.stop()); btn.classList.remove('rec'); span.textContent = old;
        resolve(chunks.length ? new Blob(chunks, { type: (mr.mimeType || mime || 'audio/webm').split(';')[0] }) : null);
      };
      mr.start(250);
    });
  }
  let lang = 'en';
  try { lang = localStorage.getItem('tiny.listLang') || 'en'; } catch (e) {}
  const paintLang = () => document.querySelectorAll('#lLang button').forEach((b) => b.classList.toggle('on', b.dataset.l === lang));
  document.querySelectorAll('#lLang button').forEach((b) => b.addEventListener('click', () => { lang = b.dataset.l; try { localStorage.setItem('tiny.listLang', lang); } catch (e) {} paintLang(); }));
  paintLang();
  async function speak(btn) {
    const blob = await record(btn);
    if (!blob) return null;
    btn.disabled = true; App.toast('Listening to your recording...', 8000);
    try {
      const r = await App.api('/api/lists/speech?lang=' + lang, { body: blob, headers: { 'Content-Type': blob.type || 'audio/webm' } });
      App.toast('Done. ' + r.points.length + ' point' + (r.points.length === 1 ? '' : 's') + ' added.');
      return r;
    } catch (e) { App.toast(e.message); return null; } finally { btn.disabled = false; }
  }

  // ---------- buttons ----------
  $('#listNew').addEventListener('click', async () => {
    try { const r = await App.api('/api/lists', { body: { title: 'New list', items: [] } }); lists.unshift(r.list); open(r.list); setTimeout(() => $('#lTitle').select(), 50); } catch (e) { App.toast(e.message); }
  });
  $('#listVoiceNew').addEventListener('click', async (e) => {
    const r = await speak(e.currentTarget); if (!r) return;
    try {
      const c = await App.api('/api/lists', { body: { title: r.title || 'New list', items: r.points.map((t) => ({ id: uid(), t, done: 0 })) } });
      lists.unshift(c.list); open(c.list);
    } catch (er) { App.toast(er.message); }
  });
  $('#lMic').addEventListener('click', async (e) => {
    const r = await speak(e.currentTarget); if (!r || !cur) return;
    addPoints(r.points); if (r.title && (!cur.title || cur.title === 'New list')) { $('#lTitle').value = r.title; cur.title = r.title; queue(); }
  });
  const addTyped = async () => {
    const inp = $('#lAdd'), v = inp.value.trim(); if (!v) return;
    inp.value = '';
    addPoints([v]);
  };
  $('#lAddBtn').addEventListener('click', addTyped);
  $('#lAdd').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addTyped(); } });
  $('#lTitle').addEventListener('input', queue);
  $('#lBack').addEventListener('click', closeEd);
  $('#lDel').addEventListener('click', async () => {
    if (!cur || !confirm('Delete this list?')) return;
    try { await App.api('/api/lists/' + cur.id, { method: 'DELETE' }); cur = null; $('#listEd').hidden = true; $('#listsHome').hidden = false; load(); } catch (e) { App.toast(e.message); }
  });
  $('#lClear').addEventListener('click', () => { if (!cur) return; cur.items = cur.items.filter((x) => !x.done); paintItems(); queue(); });
  $('#lFix').addEventListener('click', async (e) => {
    if (!cur || !cur.items.length) return;
    const b = e.currentTarget; b.disabled = true;
    try {
      const r = await App.api('/api/lists/tidy', { body: { text: cur.items.map((x) => x.t).join('\n'), mode: 'fix', lang } });
      if (r.points && r.points.length === cur.items.length) { cur.items.forEach((x, i) => { x.t = r.points[i]; }); paintItems(); queue(); App.toast('Grammar fixed.'); }
      else App.toast('Could not fix it this time. Try again.');
    } catch (er) { App.toast(er.message); } finally { b.disabled = false; }
  });

  const orig = App.showView;
  App.showView = (v) => { orig(v); if (v === 'lists' && !cur) load(); };
})();
