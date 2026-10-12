/* Pages: New Today, Act like a girl (persona + voice + Telegram + data), Memory, History. */
(function () {
  'use strict';
  const { $, $$, esc, icon } = App;
  const ago = (t) => {
    const s = Math.max(1, (Date.now() - t) / 1000);
    if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + ' min ago'; if (s < 86400) return Math.floor(s / 3600) + ' h ago';
    if (s < 86400 * 7) return Math.floor(s / 86400) + ' d ago';
    return new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  };
  const confirmBox = (msg) => window.confirm(msg);

  // ================= New today =================
  const TAGNAME = { build: 'Build', learn: 'Learn', write: 'Write', design: 'Design', relax: 'Relax' };
  async function loadToday(force) {
    const grid = $('#ideaGrid'), greet = $('#todayGreet'), btn = $('#todayRefresh');
    btn.disabled = true;
    if (force || !grid.children.length) { grid.innerHTML = ''; greet.textContent = force ? 'Thinking of new ideas for you…' : 'Loading ideas…'; }
    try {
      const d = await App.api(force ? '/api/today/refresh' : '/api/today', { method: force ? 'POST' : 'GET' });
      greet.textContent = d.greeting;
      grid.innerHTML = '';
      d.ideas.forEach((i) => {
        const el = document.createElement('article'); el.className = 'idea glass';
        el.innerHTML = `<span class="tag">${icon('t-' + i.tag)}${TAGNAME[i.tag] || 'Idea'}</span><h3>${esc(i.title)}</h3><p>${esc(i.why)}</p>${i.steps.length ? '<ol>' + i.steps.map((s) => '<li>' + esc(s) + '</li>').join('') + '</ol>' : ''}<div class="foot"><span>About ${i.minutes} min</span><button class="btn" type="button">Let’s do it</button></div>`;
        el.querySelector('button').addEventListener('click', () => { App.showView('chat'); App.send(`Let's work on this today: ${i.title}. ${i.why} Help me get started, step by step.`); });
        grid.appendChild(el);
      });
      App.setIdea(d.ideas);
    } catch (e) { greet.textContent = e.message; }
    btn.disabled = false;
  }
  $('#todayRefresh').addEventListener('click', () => loadToday(true));

  // ================= Persona =================
  let personaReady = false;
  function setSeg(id, val) { $$('#' + id + ' button').forEach((b) => b.classList.toggle('on', b.dataset.v === val)); }
  function fillPersona(s) {
    setSeg('segGender', s.persona.gender); setSeg('segVibe', s.persona.vibe); setSeg('segLang', s.persona.language); setSeg('segBrain', s.brain); setSeg('segVGirl', s.voice.girl); setSeg('segVBoy', s.voice.boy);
    if (document.activeElement !== $('#pName')) $('#pName').value = s.persona.name;
    if (document.activeElement !== $('#uName')) $('#uName').value = s.userName;
    if (document.activeElement !== $('#pCustom')) $('#pCustom').value = s.persona.custom;
    $('#vAuto').checked = s.voice.autoplay; $('#vBrowser').checked = s.voice.engine === 'browser';
    $('#vRate').value = s.voice.rate; $('#vPitch').value = s.voice.pitch;
  }
  function wirePersona() {
    if (personaReady) return; personaReady = true;
    const seg = (id, fn) => $('#' + id).addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) fn(b.dataset.v); });
    seg('segGender', (v) => { const wasDefault = ['Tiny', 'Byte'].includes(App.settings.persona.name); App.saveSettings({ persona: { gender: v, ...(wasDefault ? { name: v === 'boy' ? 'Byte' : 'Tiny' } : {}) } }).then(() => App.swapCharacter()); });
    seg('segVibe', (v) => App.saveSettings({ persona: { vibe: v } }));
    seg('segVGirl', (v) => App.saveSettings({ voice: { girl: v } }).then(() => $('#vTest').click()));
    seg('segVBoy', (v) => App.saveSettings({ voice: { boy: v } }).then(() => $('#vTest').click()));
    seg('segLang', (v) => App.saveSettings({ persona: { language: v } }));
    seg('segBrain', (v) => App.saveSettings({ brain: v }));
    const debounce = (fn, ms = 600) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
    $('#pName').addEventListener('input', debounce(() => App.saveSettings({ persona: { name: $('#pName').value } })));
    $('#uName').addEventListener('input', debounce(() => App.saveSettings({ userName: $('#uName').value })));
    $('#pCustom').addEventListener('input', debounce(() => App.saveSettings({ persona: { custom: $('#pCustom').value } }), 900));
    $('#vAuto').addEventListener('change', (e) => App.saveSettings({ voice: { autoplay: e.target.checked } }));
    $('#vBrowser').addEventListener('change', (e) => App.saveSettings({ voice: { engine: e.target.checked ? 'browser' : 'auto' } }));
    $('#vRate').addEventListener('input', debounce(() => App.saveSettings({ voice: { rate: +$('#vRate').value } })));
    $('#vPitch').addEventListener('input', debounce(() => App.saveSettings({ voice: { pitch: +$('#vPitch').value } })));
    $('#logout').addEventListener('click', App.logout);
    $('#bkNow').addEventListener('click', async (e) => { e.currentTarget.disabled = true; try { const r = await App.api('/api/backup', { method: 'POST', body: {} }); App.toast(`Backed up ${r.memories} memories and ${r.messages} messages`); } catch (er) { App.toast(er.message); } e.currentTarget.disabled = false; });
    $('#bkExport').addEventListener('click', async () => {
      try { const r = await App.api('/api/export', { raw: true }); const b = await r.blob(); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'memory-ai-backup.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); } catch (er) { App.toast(er.message); }
    });
    $('#tgConnect').addEventListener('click', async (e) => {
      e.currentTarget.disabled = true;
      try { const r = await App.api('/api/tg/setup', { method: 'POST', body: {} }); App.toast(r.ok ? 'Telegram connected' : (r.detail || 'Could not connect')); } catch (er) { App.toast(er.message); }
      e.currentTarget.disabled = false; loadTg();
    });
  }
  async function loadTg() {
    const el = $('#tgState');
    try {
      const st = App.status || await App.api('/api/status');
      if (!st.telegram.botSet) { el.textContent = 'Add TELEGRAM_BOT_TOKEN and TG_WEBHOOK_SECRET as Worker secrets, then press Connect.'; return; }
      const t = await App.api('/api/tg/status');
      el.textContent = t.connected ? (t.ownerSet ? 'Connected. Message your bot to talk.' : 'Connected, but OWNER_TG_ID is not set. Message the bot once: it will tell you your ID.') : 'Not connected yet. Press Connect.';
      if (t.lastError) el.textContent += ' Last error: ' + t.lastError;
    } catch { el.textContent = 'Could not check Telegram.'; }
  }

  // ================= Memory =================
  let mems = [];
  const CATN = { profile: 'About you', preference: 'Likes', project: 'Projects', people: 'People', plan: 'Plans', other: 'Other', self: 'About her' };
  let memTab = 'me';
  function renderMem() {
    const q = $('#memSearch').value.trim().toLowerCase();
    const box = $('#memList'); box.innerHTML = '';
    const nHer = mems.filter((m) => m.category === 'self').length;
    $('#memCntMe').textContent = '(' + (mems.length - nHer) + ')'; $('#memCntHer').textContent = '(' + nHer + ')';
    const mine = mems.filter((m) => (m.category === 'self') === (memTab === 'her'));
    const list = mine.filter((m) => !q || m.text.toLowerCase().includes(q) || (CATN[m.category] || '').toLowerCase().includes(q));
    if (!list.length) { box.innerHTML = `<div class="empty">${mine.length ? 'Nothing matches.' : memTab === 'her' ? 'Nothing about her yet. Tell her who she is (or say "I am going to update you") and she will keep it here.' : 'Nothing remembered yet. Chat with me and I will start keeping track.'}</div>`; return; }
    list.forEach((m) => {
      const el = document.createElement('div'); el.className = 'mem glass';
      el.innerHTML = `<div class="grow"><span class="cat">${CATN[m.category] || 'Other'}</span><p>${esc(m.text)}</p><small style="color:var(--muted)">${ago(m.updated_at)}${m.source === 'telegram' ? ' · Telegram' : ''}</small></div><div class="tools"><button class="mini" data-a="pin" title="${m.pinned ? 'Unpin' : 'Pin: always remembered'}" style="${m.pinned ? '' : 'opacity:.45'}">${icon('i-pin')}</button><button class="mini" data-a="edit" title="Edit">${icon('t-write')}</button><button class="mini" data-a="del" title="Forget">${icon('i-trash')}</button></div>`;
      el.addEventListener('click', async (e) => {
        const b = e.target.closest('button[data-a]'); if (!b) return;
        try {
          if (b.dataset.a === 'pin') { await App.api('/api/memories/' + m.id, { method: 'PATCH', body: { pinned: !m.pinned } }); }
          else if (b.dataset.a === 'del') { await App.api('/api/memories/' + m.id, { method: 'DELETE' }); }
          else { const t = window.prompt('Edit this memory', m.text); if (t === null || !t.trim()) return; await App.api('/api/memories/' + m.id, { method: 'PATCH', body: { text: t } }); }
          loadMem(); App.refreshStatus();
        } catch (er) { App.toast(er.message); }
      });
      box.appendChild(el);
    });
  }
  async function loadMem() { try { mems = (await App.api('/api/memories')).memories; renderMem(); } catch (e) { $('#memList').innerHTML = `<div class="empty">${esc(e.message)}</div>`; } }
  $('#memSearch').addEventListener('input', renderMem);
  $('#memTabs').addEventListener('click', (e) => { const b = e.target.closest('button[data-t]'); if (!b) return; memTab = b.dataset.t; $('#memTabs').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); renderMem(); });
  // Sorting the old memories into "mine" and "hers" starts by itself the first time the app is opened after the update.
  const sortLine = (s) => !s ? '' : s.done ? `Sorted: ${s.moved} memories moved to her memory, ${s.kept} stay in yours, ${s.added || 0} new facts found in your old chats.` : `Sorting your memories into mine and hers... ${s.phase === 'memories' ? s.cursor + ' of ' + s.total + ' memories' : 'reading your old chats'}`;
  let sortTimer = null;
  async function pollSort(first) {
    clearTimeout(sortTimer);
    try {
      const { sort } = await App.api('/api/memory/sort'); const box = $('#sortState');
      if (sort) { box.hidden = false; box.textContent = sortLine(sort); }
      if (sort && sort.done) {
        let seen = null; try { seen = localStorage.getItem('sortSeen'); } catch { /* ignore */ }
        if (String(sort.startedAt) !== seen) { try { localStorage.setItem('sortSeen', String(sort.startedAt)); } catch { /* ignore */ } App.toast('Memories sorted: ' + sort.moved + ' moved to her memory.', 4500); if (!first) loadMem(); }
        return;
      }
      if (sort) sortTimer = setTimeout(() => pollSort(false), 12000);
    } catch { /* offline or not signed in yet */ }
  }
  App.pollSort = () => pollSort(true);
  $('#memSort').addEventListener('click', async () => { try { await App.api('/api/memory/sort', { method: 'POST', body: { force: true } }); App.toast('Sorting again...'); pollSort(false); } catch (e) { App.toast(e.message); } });
  $('#memAddBtn').addEventListener('click', () => { const a = $('#memAdd'); a.hidden = !a.hidden; if (!a.hidden) $('#memNew').focus(); });
  $('#memSave').addEventListener('click', async () => {
    const t = $('#memNew').value.trim(); if (!t) return;
    try { const her = $('#memOwner').value === 'her'; await App.api('/api/memories', { body: { text: t, pinned: true, importance: 5, category: her ? 'self' : undefined } }); $('#memNew').value = ''; $('#memAdd').hidden = true; if (her) { memTab = 'her'; $('#memTabs').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x.dataset.t === 'her')); } App.toast(her ? 'Saved in her memory.' : 'Saved. I will remember that.'); loadMem(); App.refreshStatus(); } catch (e) { App.toast(e.message); }
  });
  $('#memClear').addEventListener('click', async () => {
    if (!mems.length) return;
    if (!confirmBox('Forget everything in both memories (about you and about her)? Your chats stay, but the memories are deleted for good.')) return;
    try { await App.api('/api/memories', { method: 'DELETE' }); App.toast('All memories forgotten'); loadMem(); App.refreshStatus(); } catch (e) { App.toast(e.message); }
  });

  // ================= History =================
  async function loadHist() {
    const q = $('#histSearch').value.trim(); const box = $('#histList');
    try {
      const d = await App.api('/api/conversations' + (q ? '?q=' + encodeURIComponent(q) : ''));
      box.innerHTML = '';
      if (!d.conversations.length) { box.innerHTML = `<div class="empty">${q ? 'No chats match.' : 'No chats yet.'}</div>`; return; }
      d.conversations.forEach((c) => {
        const el = document.createElement('div'); el.className = 'mem glass'; el.style.cursor = 'pointer';
        el.innerHTML = `<div class="grow"><span class="cat">${c.source === 'telegram' ? 'Telegram' : 'Website'}</span><p>${esc(c.title)}</p><small style="color:var(--muted)">${ago(c.updated_at)}</small></div><div class="tools"><button class="mini" data-a="del" title="Delete chat">${icon('i-trash')}</button></div>`;
        el.addEventListener('click', async (e) => {
          if (e.target.closest('[data-a="del"]')) { if (!confirmBox('Delete this whole chat?')) return; try { await App.api('/api/conversations/' + c.id, { method: 'DELETE' }); if (App.convId === c.id) App.newChat(); loadHist(); App.refreshRecent(); App.refreshStatus(); } catch (er) { App.toast(er.message); } return; }
          App.loadConversation(c.id);
        });
        box.appendChild(el);
      });
    } catch (e) { box.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  }
  let ht; $('#histSearch').addEventListener('input', () => { clearTimeout(ht); ht = setTimeout(loadHist, 300); });

  // ================= hooks =================
  App.hooks.onSettings = (s) => { fillPersona(s); wirePersona(); };
  App.hooks.onView = (v) => {
    if (v === 'today') loadToday(false);
    else if (v === 'memory') { loadMem(); pollSort(false); }
    else if (v === 'history') loadHist();
    else if (v === 'persona') { fillPersona(App.settings); loadTg(); }
  };
})();
