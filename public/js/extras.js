/* v2 extras: Notes, Reminders and routines, review-before-remember, slash commands, call receipt. */
(function () {
  'use strict';
  const { $, $$, esc, icon } = App;
  const ago = (t) => { const s = Math.max(1, (Date.now() - t) / 1000); if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + ' min ago'; if (s < 86400) return Math.floor(s / 3600) + ' h ago'; return new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); };
  const IST = { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' };
  const when = (t) => new Date(t).toLocaleString('en-IN', IST);
  const debounce = (fn, ms) => { let t; const f = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; f.now = (...a) => { clearTimeout(t); return fn(...a); }; return f; };

  // ================= Notes =================
  const home = $('#notesHome'), ed = $('#noteEd');
  let cur = null, dirty = false, saving = false, mode = 'edit';
  const setState = (txt, cls = '') => { const el = $('#nState'); el.textContent = txt; el.className = 'save-state ' + cls; };

  async function loadNotes() {
    const q = $('#noteSearch').value.trim(), grid = $('#noteGrid');
    try {
      const d = await App.api('/api/notes' + (q ? '?q=' + encodeURIComponent(q) : ''));
      grid.innerHTML = '';
      if (!d.notes.length) { grid.innerHTML = `<div class="empty" style="grid-column:1/-1">${q ? 'No notes match.' : 'No notes yet. Press New note, or save any reply with its Note button.'}</div>`; return; }
      d.notes.forEach((n) => {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'note-card glass';
        b.innerHTML = `<b>${n.pinned ? icon('i-pin') : ''}${esc(n.title)}</b><p>${esc(n.snippet || '')}</p><small>${ago(n.updated_at)}</small>`;
        b.addEventListener('click', () => openNote(n.id)); grid.appendChild(b);
      });
    } catch (e) { grid.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  }
  async function openNote(id) {
    try {
      const d = await App.api('/api/notes/' + id); cur = d.note; dirty = false;
      home.hidden = true; ed.hidden = false; ed.style.display = 'flex';
      $('#nTitle').value = cur.title === 'Untitled' ? '' : cur.title; $('#nBody').value = cur.content; $('#nWarn').hidden = true;
      $('#nPin span').textContent = cur.pinned ? 'Unpin' : 'Pin'; setMode('edit'); setState('Saved');
      if (!cur.content) $('#nBody').focus();
    } catch (e) { App.toast(e.message); }
  }
  async function closeNote() {
    if (dirty) await save.now();
    cur = null; ed.hidden = true; ed.style.display = 'none'; home.hidden = false; loadNotes();
  }
  function setMode(m) {
    mode = m; $$('#nMode button').forEach((b) => b.classList.toggle('on', b.dataset.v === m));
    $('#nBody').hidden = m !== 'edit'; $('#nView').hidden = m !== 'view';
    if (m === 'view') $('#nView').innerHTML = App.md($('#nBody').value) || '<p style="color:var(--muted)">Nothing here yet.</p>';
  }
  const save = debounce(async () => {
    if (!cur || saving) { if (cur && dirty) setTimeout(save, 500); return; }
    saving = true; setState('Saving…', 'busy');
    const body = { title: $('#nTitle').value, content: $('#nBody').value, rev: cur.rev };
    try {
      const d = await App.api('/api/notes/' + cur.id, { method: 'PATCH', body });
      cur = d.note; dirty = ($('#nBody').value !== body.content) || ($('#nTitle').value !== body.title); setState('Saved');
    } catch (e) {
      if (e.status === 409) { $('#nWarn').hidden = false; setState('Not saved', 'bad'); cur = { ...cur, rev: -1 }; window._newerNote = e.data && e.data.note; }
      else setState('Not saved. Your text is still here.', 'bad');
    }
    saving = false;
  }, 900);
  const touch = () => { dirty = true; setState('Editing…'); save(); };
  $('#nTitle').addEventListener('input', touch); $('#nBody').addEventListener('input', touch);
  $('#nMode').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setMode(b.dataset.v); });
  $('#nBack').addEventListener('click', closeNote);
  $('#nReload').addEventListener('click', () => { if (window._newerNote) { cur = window._newerNote; $('#nTitle').value = cur.title; $('#nBody').value = cur.content; dirty = false; $('#nWarn').hidden = true; setState('Saved'); } });
  $('#noteNew').addEventListener('click', async () => { try { const d = await App.api('/api/notes', { body: { title: '', content: '' } }); await openNote(d.note.id); $('#nTitle').focus(); } catch (e) { App.toast(e.message); } });
  let st; $('#noteSearch').addEventListener('input', () => { clearTimeout(st); st = setTimeout(loadNotes, 300); });
  $('#nPin').addEventListener('click', async () => { if (!cur) return; try { await save.now(); const d = await App.api('/api/notes/' + cur.id, { method: 'PATCH', body: { pinned: !cur.pinned, rev: cur.rev } }); cur = d.note; $('#nPin span').textContent = cur.pinned ? 'Unpin' : 'Pin'; } catch (e) { App.toast(e.message); } });
  $('#nDel').addEventListener('click', async () => { if (!cur || !confirm('Delete this note?')) return; try { await App.api('/api/notes/' + cur.id, { method: 'DELETE' }); dirty = false; cur = null; closeNote(); } catch (e) { App.toast(e.message); } });
  $('#nAsk').addEventListener('click', async () => {
    if (!cur) return; await save.now(); App.noteId = cur.id; showCtx(cur.title || 'Untitled');
    App.showView('chat'); $('#input').focus(); if (!$('#input').value) $('#input').placeholder = 'Ask about your note…';
  });
  const ctx = $('#noteCtx');
  function showCtx(t) { $('#noteCtxTitle').textContent = t; ctx.hidden = false; }
  $('#noteCtxX').addEventListener('click', () => { App.noteId = null; ctx.hidden = true; $('#input').placeholder = 'Message your friend…'; });
  const origNew = App.newChat; App.newChat = () => { App.noteId = null; ctx.hidden = true; origNew(); };
  $('#newChat').replaceWith($('#newChat').cloneNode(true)); $('#newChat').addEventListener('click', () => App.newChat());

  // Save any text (a reply, or a whole chat) as a note.
  App.saveAsNote = async (text, title) => {
    const first = String(text).replace(/[#*_`>]/g, '').trim().split('\n')[0].slice(0, 70);
    try { const d = await App.api('/api/notes', { body: { title: title || first || 'Saved note', content: text } }); App.toast('Saved to Notes'); return d.note; } catch (e) { App.toast(e.message); return null; }
  };
  async function chatAsNote() {
    if (!App.convId) { App.toast('Say something first, then I can save the chat.'); return; }
    const d = await App.api(`/api/conversations/${App.convId}/messages`);
    const me = App.settings.userName || 'You', her = App.settings.persona.name;
    const md = d.messages.map((m) => `**${m.role === 'user' ? me : her}:** ${m.content}`).join('\n\n');
    const t = (App.conversations || []).find((c) => c.id === App.convId);
    App.saveAsNote(md, 'Chat: ' + (t ? t.title : 'saved chat'));
  }

  // ================= Reminders and routines =================
  async function loadTasks() {
    const box = $('#taskList');
    try {
      const d = await App.api('/api/tasks'); box.innerHTML = '';
      if (!d.tasks.length) { box.innerHTML = '<div class="empty">Nothing scheduled yet. Try: “Every morning at 8, cheer me on.”</div>'; return; }
      const REP = { 60: 'every hour', 1440: 'every day', 10080: 'every week' };
      d.tasks.forEach((t) => {
        const el = document.createElement('div'); el.className = 'task glass' + (t.enabled ? '' : ' off');
        const rep = t.interval_minutes ? (REP[t.interval_minutes] || 'every ' + t.interval_minutes + ' min') : 'once';
        el.innerHTML = `<div class="grow"><p>${esc(t.prompt)}</p><small>${t.enabled ? 'Next: ' + when(t.run_at) : 'Done or paused'} · ${rep}</small>${t.last_result ? `<small>Last: ${ago(t.last_run)}</small><div class="res">${esc(t.last_result)}</div>` : ''}</div><div class="tools" style="display:flex;gap:2px"><button class="mini" data-a="run" title="Run now">${icon('i-play2')}</button><button class="mini" data-a="tog" title="${t.enabled ? 'Pause' : 'Turn on'}">${icon(t.enabled ? 'i-bell' : 'i-clock')}</button><button class="mini" data-a="del" title="Delete">${icon('i-trash')}</button></div>`;
        el.addEventListener('click', async (e) => {
          const b = e.target.closest('button[data-a]'); if (!b) return;
          try {
            if (b.dataset.a === 'del') { if (!confirm('Delete this reminder?')) return; await App.api('/api/tasks/' + t.id, { method: 'DELETE' }); }
            else if (b.dataset.a === 'tog') await App.api('/api/tasks/' + t.id, { method: 'PATCH', body: { enabled: !t.enabled } });
            else { b.disabled = true; App.toast('Running it now…'); await App.api(`/api/tasks/${t.id}/run`, { method: 'POST', body: {} }); }
            loadTasks();
          } catch (er) { App.toast(er.message); loadTasks(); }
        });
        box.appendChild(el);
      });
    } catch (e) { box.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  }
  async function addByText(text) {
    const p = await App.api('/api/tasks/parse', { body: { text } });
    await App.api('/api/tasks', { body: p });
    App.toast('Set for ' + when(p.runAt) + (p.intervalMinutes ? ' and repeating' : ''), 4200);
  }
  $('#tAdd').addEventListener('click', async () => {
    const v = $('#tText').value.trim(); if (!v) return; const b = $('#tAdd'); b.disabled = true;
    try { await addByText(v); $('#tText').value = ''; loadTasks(); } catch (e) { App.toast(e.message, 4500); }
    b.disabled = false;
  });
  $('#tText').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#tAdd').click(); } });
  $('#tSave').addEventListener('click', async () => {
    const what = $('#tWhat').value.trim(), w = $('#tWhen').value;
    if (!what || !w) { App.toast('Add what to do and when.'); return; }
    try { await App.api('/api/tasks', { body: { prompt: what, runAt: Date.parse(w + ':00+05:30'), intervalMinutes: $('#tRepeat').value || null } }); $('#tWhat').value = ''; App.toast('Saved'); loadTasks(); } catch (e) { App.toast(e.message); }
  });

  // ================= Birthdays and special days =================
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  async function loadDates() {
    const box = $('#dateList');
    try {
      const d = await App.api('/api/dates');
      box.innerHTML = d.dates.map((x) => `<div class="card glass mood-row"><div><b>${App.esc(x.title)}</b> <small>${x.day} ${MON[x.month - 1]}${x.years ? ' · turns ' + x.years : ''}</small><p>${x.days === 0 ? 'Today!' : x.days === 1 ? 'Tomorrow' : 'In ' + x.days + ' days'}</p></div><button class="icon-btn" data-id="${x.id}" type="button" aria-label="Delete"><svg class="ic"><use href="#i-trash"/></svg></button></div>`).join('') || '<div class="empty">No dates yet. Tell her in chat: “Riya’s birthday is 14 March”.</div>';
    } catch { box.innerHTML = ''; }
  }
  $('#dateList').addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-id]'); if (!b) return;
    try { await App.api('/api/dates/' + b.dataset.id, { method: 'DELETE' }); loadDates(); } catch (err) { App.toast(err.message); }
  });
  $('#dAdd').addEventListener('click', async () => {
    const t = $('#dTitle').value.trim(), w = $('#dWhen').value;
    if (!t || !w) { App.toast('Add whose date and the day.'); return; }
    const [y, m, d] = w.split('-').map(Number);
    try { await App.api('/api/dates', { body: { title: t, month: m, day: d, year: y < new Date().getFullYear() ? y : null, kind: $('#dKind').value } }); $('#dTitle').value = ''; App.toast('I will remember'); loadDates(); } catch (e) { App.toast(e.message); }
  });

  // ================= Review before remembering =================
  let lastPending = 0;
  async function drawPending() {
    const d = await App.api('/api/pending'), box = $('#pendBox'), list = $('#pendList');
    list.innerHTML = ''; box.hidden = !d.pending.length;
    $('#pendTitle').textContent = d.pending.length === 1 ? '1 thing waiting for your OK' : d.pending.length + ' things waiting for your OK';
    d.pending.forEach((p) => {
      const el = document.createElement('div'); el.className = 'pend';
      el.innerHTML = `<p>${esc(p.text)}</p><button class="btn" data-a="approve" type="button">Remember</button><button class="btn ghost" data-a="decline" type="button">No</button>`;
      el.addEventListener('click', async (e) => { const b = e.target.closest('button[data-a]'); if (!b) return; try { await App.api('/api/pending/' + p.id, { body: { action: b.dataset.a } }); drawPending(); App.refreshPending(false); App.refreshStatus(); if (App.view === 'memory') $('#memSearch').dispatchEvent(new Event('input')); } catch (er) { App.toast(er.message); } });
      list.appendChild(el);
    });
    return d.pending.length;
  }
  $('#pendAll').addEventListener('click', async () => { try { const r = await App.api('/api/pending/all', { body: { action: 'approve' } }); App.toast('Remembered ' + r.saved + ' things'); drawPending(); App.refreshPending(false); App.refreshStatus(); } catch (e) { App.toast(e.message); } });
  App.refreshPending = async (announce) => {
    try {
      const d = await App.api('/api/pending'), n = d.pending.length, b = $('#memBadge');
      b.hidden = !n; b.textContent = n;
      if (announce && n > lastPending) App.toast(App.settings.persona.name + ' wants to remember: ' + d.pending[n - 1].text + '. Review it in Memory.', 5200);
      lastPending = n;
    } catch { /* ignore */ }
  };

  // ================= Slash commands =================
  const CMDS = [
    ['/note', 'Save this chat as a note'], ['/remember', 'Remember something: /remember I love mango lassi'], ['/remind', 'Set a reminder: /remind tomorrow 6 pm call mom'],
    ['/today', 'See ideas for today'], ['/play', 'Open the games'], ['/voice', 'Start a voice chat'], ['/new', 'Start a fresh chat'],
  ];
  const menu = $('#slash'), inp = $('#input'); let sel = 0, items = [];
  function drawMenu() {
    const v = inp.value;
    if (!v.startsWith('/') || /\s/.test(v)) { menu.hidden = true; return; }
    items = CMDS.concat(App.skillCmds ? App.skillCmds() : []).filter((c) => c[0].startsWith(v.toLowerCase())); sel = Math.min(sel, Math.max(0, items.length - 1));
    if (!items.length) { menu.hidden = true; return; }
    menu.innerHTML = ''; menu.hidden = false;
    items.forEach((c, i) => { const b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'option'); b.className = i === sel ? 'on' : ''; b.innerHTML = `<b>${c[0]}</b><span>${esc(c[1])}</span>`; b.addEventListener('click', () => pickCmd(c[0])); menu.appendChild(b); });
  }
  function pickCmd(c) { const wait = ['/remember', '/remind'].includes(c) || c.startsWith('/skill-'); inp.value = c + (wait ? ' ' : ''); menu.hidden = true; inp.focus(); inp.dispatchEvent(new Event('input')); if (!wait) App.send(); }
  inp.addEventListener('input', () => { sel = 0; drawMenu(); });
  inp.addEventListener('keydown', (e) => {
    if (menu.hidden) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = (sel + 1) % items.length; drawMenu(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = (sel - 1 + items.length) % items.length; drawMenu(); }
    else if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && items[sel] && inp.value.toLowerCase() !== items[sel][0])) { e.preventDefault(); e.stopImmediatePropagation(); pickCmd(items[sel][0]); }
    else if (e.key === 'Escape') menu.hidden = true;
  }, true);
  App.slash = async (text) => {
    const [cmd, ...r] = text.split(/\s+/), arg = r.join(' ').trim(); menu.hidden = true;
    try {
      switch (cmd.toLowerCase()) {
        case '/note': await chatAsNote(); return true;
        case '/remember': if (!arg) { App.toast('Tell me what: /remember I love mango lassi'); return true; } await App.api('/api/memories', { body: { text: arg, pinned: true, importance: 5 } }); App.toast('Saved. I will remember that.'); App.refreshStatus(); return true;
        case '/remind': if (!arg) { App.toast('Try: /remind tomorrow 6 pm call mom'); return true; } await addByText(arg); return true;
        case '/today': App.showView('today'); return true;
        case '/play': App.showView('play'); return true;
        case '/voice': $('#voiceOpen').click(); return true;
        case '/new': App.newChat(); return true;
        default: return false;
      }
    } catch (e) { App.toast(e.message, 4500); return true; }
  };

  // ================= hooks =================
  const prevSettings = App.hooks.onSettings;
  App.hooks.onSettings = (s) => {
    if (prevSettings) prevSettings(s);
    $('#rvMem').checked = !!s.reviewMemories;
    if (!App._rvWired) { App._rvWired = true; $('#rvMem').addEventListener('change', (e) => App.saveSettings({ reviewMemories: e.target.checked })); }
  };
  const prevView = App.hooks.onView;
  App.hooks.onView = (v) => {
    if (prevView) prevView(v);
    if (v === 'notes') { if (cur) return; ed.style.display = 'none'; ed.hidden = true; home.hidden = false; loadNotes(); }
    else if (v === 'tasks') { loadTasks(); loadDates(); }
    else if (v === 'memory') drawPending().catch(() => {});
  };
  ed.style.display = 'none';
  window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
})();
