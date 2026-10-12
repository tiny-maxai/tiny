/* Core: login, api, navigation, chat, memory toast, and the character above the chat bar. */
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const LS = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
  };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const icon = (id, cls = '') => `<svg class="ic ${cls}"><use href="#${id}"/></svg>`;

  const App = window.App = {
    $, $$, esc, icon, LS,
    token: LS.get('mai_token') || '',
    settings: null, status: null,
    convId: null, busy: false, view: 'chat',
    hooks: {},   // other scripts register: onView, onSettings
  };

  // ---------- toast ----------
  let toastT;
  App.toast = (msg, ms = 2600) => {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms);
  };

  // ---------- api ----------
  App.api = async (path, opts = {}) => {
    const headers = { ...(opts.headers || {}) };
    if (App.token) headers.Authorization = 'Bearer ' + App.token;
    let body = opts.body;
    if (body && typeof body === 'object' && !(body instanceof Blob) && !(body instanceof ArrayBuffer)) { body = JSON.stringify(body); headers['Content-Type'] = 'application/json'; }
    const res = await fetch(path, { method: opts.method || (body ? 'POST' : 'GET'), headers, body, signal: opts.signal });
    if (res.status === 401) { showLogin(); throw Object.assign(new Error('Please log in.'), { status: 401 }); }
    if (opts.raw) return res;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || 'Something went wrong.'), { status: res.status, data });
    return data;
  };

  // ---------- login ----------
  function showLogin() { $('#login').hidden = false; setTimeout(() => $('#loginKey').focus(), 50); }
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const key = $('#loginKey').value;
    $('#loginErr').textContent = '';
    try {
      const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { $('#loginErr').textContent = d.error || 'Could not log in.'; return; }
      App.token = d.token; LS.set('mai_token', d.token);
      $('#loginKey').value = ''; $('#login').hidden = true;
      boot();
    } catch { $('#loginErr').textContent = 'No connection. Try again.'; }
  });
  App.logout = () => { LS.del('mai_token'); App.token = ''; location.reload(); };

  // ---------- navigation ----------
  const TITLES = {
    chat: ['Chat', 'Talk about anything. I remember it all.'],
    play: ['Play', 'Games for two. You and me.'],
    today: ['New today', 'What you could create today.'],
    notes: ['Notes', 'Pages you write, and chats you keep.'],
    tasks: ['Reminders', 'Things I do for you, on time.'],
    mood: ['Mood', 'How are you feeling today?'],
    persona: ['Act like a girl', 'Her name, her vibe, her voice.'],
    memory: ['Memory', 'Everything I remember about you.'],
    history: ['History', 'All your chats in one place.'],
  };
  App.showView = (v) => {
    App.view = v;
    $$('.view').forEach((el) => el.classList.toggle('on', el.id === 'view-' + v));
    $$('#nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
    $('#topTitle').textContent = TITLES[v][0]; $('#topSub').textContent = TITLES[v][1];
    $('#app').classList.remove('nav-open');
    const L = { today: ['#ideaGrid', 'ideas'], memory: ['#memList', 'memories'], history: ['#histList', 'chats'], notes: ['#noteGrid', 'notes'], tasks: ['#taskList', 'reminders'], mood: ['#moodList', 'moods'] }[v];
    if (L) { const el = $(L[0]); if (el && !el.children.length) el.innerHTML = `<div class="loading"><i></i>Loading ${L[1]}…</div>`; }
    if (App.hooks.onView) App.hooks.onView(v);
  };
  $('#nav').addEventListener('click', (e) => { const b = e.target.closest('button[data-view]'); if (b) App.showView(b.dataset.view); });
  $('#menuBtn').addEventListener('click', () => $('#app').classList.add('nav-open'));
  $('#backdrop').addEventListener('click', () => $('#app').classList.remove('nav-open'));

  // ---------- markdown (small, safe) ----------
  function inline(t) {
    const codes = [];
    t = t.replace(/`([^`\n]+)`/g, (m, c) => { codes.push('<code>' + c + '</code>'); return '\u0000' + (codes.length - 1) + '\u0000'; });
    t = t.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, '$1<em>$2</em>')
      .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
      .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
    return t.replace(/\u0000(\d+)\u0000/g, (m, i) => codes[+i]);
  }
  App.md = (src) => {
    const fences = [];
    let s = esc(src).replace(/```([\w-]*)\n?([\s\S]*?)(```|$)/g, (m, l, c) => { fences.push('<pre><code>' + c.replace(/\n$/, '') + '</code></pre>'); return '\n\u0001' + (fences.length - 1) + '\u0001\n'; });
    const out = []; let list = null, para = [];
    const flushP = () => { if (para.length) { out.push('<p>' + inline(para.join('<br>')) + '</p>'); para = []; } };
    const flushL = () => { if (list) { out.push(`<${list.t}>` + list.items.map((i) => '<li>' + inline(i) + '</li>').join('') + `</${list.t}>`); list = null; } };
    for (const line of s.split('\n')) {
      let m;
      if ((m = line.match(/^\u0001(\d+)\u0001$/))) { flushP(); flushL(); out.push(fences[+m[1]]); continue; }
      if (!line.trim()) { flushP(); flushL(); continue; }
      if ((m = line.match(/^(#{1,4})\s+(.*)$/))) { flushP(); flushL(); out.push(`<h${m[1].length}>` + inline(m[2]) + `</h${m[1].length}>`); continue; }
      if ((m = line.match(/^\s*[-*•]\s+(.*)$/))) { flushP(); if (!list || list.t !== 'ul') { flushL(); list = { t: 'ul', items: [] }; } list.items.push(m[1]); continue; }
      if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) { flushP(); if (!list || list.t !== 'ol') { flushL(); list = { t: 'ol', items: [] }; } list.items.push(m[1]); continue; }
      if ((m = line.match(/^&gt;\s?(.*)$/))) { flushP(); flushL(); out.push('<blockquote>' + inline(m[1]) + '</blockquote>'); continue; }
      if (/^\s*---+\s*$/.test(line)) { flushP(); flushL(); out.push('<hr>'); continue; }
      flushL(); para.push(line);
    }
    flushP(); flushL();
    return out.join('');
  };

  // ---------- character (same spot and behaviour as your zip) ----------
  const POSES = ['smile', 'wave', 'hello', 'idea', 'explain', 'cheer', 'sleep', 'excited', 'cry', 'type', 'angry', 'blush', 'flirty', 'pain', 'period'];
  const BYTE_ALIAS = { hello: 'smile', wave: 'explain', excited: 'cheer', sleep: 'smile', angry: 'explain', blush: 'smile', flirty: 'smile', pain: 'cry', period: 'cry' };
  // Her face follows her mood (the header chip shows the same mood).
  const MOOD_POSE = { angry: 'angry', sulky: 'angry', jealous: 'angry', sad: 'cry', in_pain: 'pain', moody: 'period', flirty: 'flirty', clingy: 'blush', happy: 'cheer', hyper: 'excited', sleepy: 'sleep', sleeping: 'sleep', lazy: 'sleep' };
  const moodPose = () => (App.herKind && App.herKind !== 'normal' ? MOOD_POSE[App.herKind] || null : null);
  const isBoy = () => App.settings && App.settings.persona.gender === 'boy';
  const stk = (n) => '/images/stickers/' + (isBoy() ? 'byte-' + (BYTE_ALIAS[n] || n) : 'tiny-' + n) + '.webp';
  App.stk = stk;
  const stickerBtn = $('#sticker'), stickerImg = $('#stickerImg'), stkBob = $('#stkBob'), stkMotion = $('#stkMotion'), stickerWrap = $('#stickerWrap');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  let curPose = 'smile', poseHold = null, hovering = false, stickerOpen = false, idleSleep = false, lastActive = Date.now();
  const extState = { listening: false, speaking: false };
  App.charState = extState;
  const sleepMode = () => { const h = new Date().getHours(); return h >= 23 || h < 5; };
  const motionFor = { excited: 'm-bounce', cry: 'm-shake' };
  function playMotion(p) {
    stkMotion.classList.remove('m-bounce', 'm-shake');
    const m = motionFor[p]; if (!m || reduceMotion.matches) return;
    void stkMotion.offsetWidth; stkMotion.classList.add(m);
  }
  stkMotion.addEventListener('animationend', (e) => { if (e.target === stkMotion) stkMotion.classList.remove('m-bounce', 'm-shake'); });
  function showPose(p, replay) {
    if (p === curPose) { if (replay) playMotion(p); return; }
    const ghost = stickerImg.cloneNode(false); ghost.removeAttribute('id'); ghost.className = 'ghost';
    stkMotion.querySelectorAll('img.ghost').forEach((g) => g.remove());
    stkMotion.appendChild(ghost); setTimeout(() => ghost.remove(), 600);
    curPose = p; stickerBtn.dataset.pose = p; stkBob.classList.toggle('asleep', p === 'sleep');
    stickerImg.src = stk(p);
    stickerImg.classList.remove('fade-in'); void stickerImg.offsetWidth; stickerImg.classList.add('fade-in');
    playMotion(p);
    const vi = $('#vImg'); if (vi) vi.src = stk(p);
  }
  const restPose = () => App.busy ? 'explain' : extState.speaking ? 'hello' : extState.listening ? 'idea' : (hovering || stickerOpen) ? 'idea' : idleSleep ? 'sleep' : ($('#input').value.trim() ? 'type' : (App.herKind ? (moodPose() || 'smile') : (sleepMode() ? 'sleep' : 'smile')));
  App.flashPose = (p, ms = 3500) => { clearTimeout(poseHold); showPose(p, true); poseHold = setTimeout(() => { poseHold = null; showPose(restPose()); }, ms); };
  App.restPose = () => { if (!poseHold) showPose(restPose()); };
  App.swapCharacter = () => { stickerImg.src = stk(curPose); POSES.forEach((p) => { new Image().src = stk(p); }); $('#vImg').src = stk(curPose); };

  const PAIN = /\b(suicid\w*|self[- ]harm|tragic|heartbr\w+|griev\w+|passed away|abus(?:e|ed|ive)|devastat\w+|sorry to hear|sorry you(?:'|’)re|trauma\w*|depress(?:ed|ion)|lonely|hopeless)\b/i;
  function answerPose(q, a) {
    if (PAIN.test(a)) return 'cry';
    if (/\b(congratulations|congrats|well done|great job|proud of you|amazing|awesome|bravo|yay)\b/i.test(a)) return 'excited';
    if (/\b(good night|sleep well|sweet dreams|bedtime)\b/i.test(a)) return 'sleep';
    if (/\b(thanks|thank you|thx|shukriya|dhanyavad)\b/i.test(q)) return 'cheer';
    if (/^\s*(hi+|hello+|hey+|namaste|yo)\b/i.test(q)) return 'wave';
    if (/\b(tip|idea|try this|suggest\w*)\b/i.test(a)) return 'idea';
    if (a.length > 900 || /```/.test(a) || (a.match(/^\s*(?:[-*]|\d+[.)])\s/mg) || []).length >= 4) return 'explain';
    return a.length < 240 ? 'smile' : 'hello';
  }
  if (canHover) {
    stickerWrap.addEventListener('mouseenter', () => { hovering = true; if (!App.busy) { clearTimeout(poseHold); poseHold = null; showPose('idea'); } });
    stickerWrap.addEventListener('mouseleave', () => { hovering = false; if (!poseHold) showPose(restPose()); });
  }
  let idea = null;
  function paintIdea() {
    const f = idea ? idea.title : 'Tell me about your day, I will remember it.';
    $('#factText').textContent = idea ? idea.title + '. ' + idea.why : f;
    $('#factHead').textContent = idea ? 'Idea for today' : 'Say hi';
  }
  let ideaAsked = false;
  const ensureIdea = () => { if (ideaAsked) return; ideaAsked = true; App.api('/api/today').then((t) => App.setIdea(t.ideas)).catch(() => App.setIdea(null)); };
  App.ensureIdea = ensureIdea;
  App.setIdea = (list) => { idea = list && list.length ? list[Math.floor(Math.random() * list.length)] : null; paintIdea(); };
  async function askIdea() {
    if (!idea) { ensureIdea(); await new Promise((r) => setTimeout(r, 900)); }
    stickerOpen = false; stickerWrap.classList.remove('show');
    App.showView('chat');
    App.send(idea ? `Let's work on this today: ${idea.title}. ${idea.why} Help me get started.` : 'Hi! What should we do today?');
  }
  ['mouseenter', 'touchstart', 'focusin'].forEach((ev) => stickerWrap.addEventListener(ev, ensureIdea, { once: true, passive: true }));
  stickerBtn.addEventListener('click', (e) => {
    e.stopPropagation(); ensureIdea();
    if (canHover) { askIdea(); return; }
    stickerOpen = !stickerOpen; stickerWrap.classList.toggle('show', stickerOpen);
    if (!App.busy && !poseHold) showPose(restPose());
  });
  $('#factAsk').addEventListener('click', (e) => { e.stopPropagation(); askIdea(); });
  document.addEventListener('click', (e) => { if (stickerOpen && !e.target.closest('#stickerWrap')) { stickerOpen = false; stickerWrap.classList.remove('show'); App.restPose(); } });
  ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach((ev) => window.addEventListener(ev, () => { lastActive = Date.now(); if (idleSleep) { idleSleep = false; App.restPose(); } }, { passive: true, capture: true }));
  setInterval(() => { if (!idleSleep && !App.busy && !poseHold && !extState.listening && !extState.speaking && Date.now() - lastActive > 150000) { idleSleep = true; showPose('sleep'); } }, 5000);
  window.addEventListener('offline', () => { App.flashPose('cry', 6000); App.toast('You are offline'); });
  $('#input').addEventListener('input', () => { grow(); App.restPose(); });

  // ---------- chat ----------
  const messagesEl = $('#messages'), input = $('#input'), sendBtn = $('#sendBtn');
  const SEND = '<svg><use href="#i-send"/></svg>', STOP = '<svg><use href="#i-stop"/></svg>';
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  function grow() { input.style.height = 'auto'; input.style.height = Math.min(180, input.scrollHeight) + 'px'; }
  const nearBottom = () => messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 140;
  const toBottom = () => { messagesEl.scrollTop = messagesEl.scrollHeight; };
  const botFace = () => `<div class="av" aria-hidden="true"><img src="${stk('smile')}" alt=""></div>`;

  function addRow(role, text, via) {
    const row = document.createElement('div'); row.className = 'row ' + (role === 'user' ? 'user' : 'bot');
    const b = document.createElement('div'); b.className = 'bubble';
    if (role === 'user') { b.textContent = text; if (via === 'voice') b.insertAdjacentHTML('beforeend', '<span class="via">spoken</span>'); }
    else { const m = document.createElement('div'); m.className = 'md'; b.appendChild(m); b._md = m; if (text) m.innerHTML = App.md(text); row.insertAdjacentHTML('afterbegin', botFace()); }
    row.appendChild(b); messagesEl.appendChild(row); toBottom();
    return b;
  }
  function addTyping() {
    if ($('#typingRow')) return;
    const row = document.createElement('div'); row.className = 'row bot'; row.id = 'typingRow';
    row.innerHTML = botFace() + '<div class="bubble typing"><i></i><i></i><i></i></div>';
    messagesEl.appendChild(row); toBottom();
  }
  const rmTyping = () => { const r = $('#typingRow'); if (r) r.remove(); };

  function addActions(bubble, text) {
    const a = document.createElement('div'); a.className = 'acts';
    const mk = (ic, label, fn) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'act'; b.innerHTML = icon(ic) + '<span>' + label + '</span>'; b.addEventListener('click', () => fn(b)); a.appendChild(b); };
    mk('i-speaker', 'Listen', (b) => { if (b.classList.contains('on')) { App.stopSpeak(); b.classList.remove('on'); return; } b.classList.add('on'); App.speak(text).finally(() => b.classList.remove('on')); });
    mk('i-copy', 'Copy', async (b) => { try { await navigator.clipboard.writeText(text); b.querySelector('span').textContent = 'Copied'; setTimeout(() => (b.querySelector('span').textContent = 'Copy'), 1500); } catch { App.toast('Could not copy'); } });
    mk('i-note', 'Note', async (b) => { const ok = await App.saveAsNote(text); if (ok) b.querySelector('span').textContent = 'Saved'; });
    mk('i-pin', 'Remember', async (b) => { try { await App.api('/api/memories', { body: { text: text.slice(0, 400), importance: 4 } }); b.querySelector('span').textContent = 'Saved'; refreshStatus(); } catch (e) { App.toast(e.message); } });
    bubble.appendChild(a);
  }

  function welcome() {
    messagesEl.innerHTML = '';
    const p = App.settings.persona, who = App.settings.userName ? ', ' + esc(App.settings.userName) : '';
    const w = document.createElement('div'); w.className = 'welcome';
    w.innerHTML = `<img src="${stk('hello')}" alt="" style="width:170px;margin:0 auto -4px;display:block"><h2>Hey${who}! I’m ${esc(p.name)}</h2><p>Tell me anything. I keep every chat and remember what matters, here and on Telegram.</p><div class="suggest"></div>`;
    ['Plan my day with me', 'What do you remember about me?', 'Cheer me up', 'Help me start a new project'].forEach((t) => {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = t; b.addEventListener('click', () => App.send(t)); w.querySelector('.suggest').appendChild(b);
    });
    messagesEl.appendChild(w);
  }
  App.newChat = () => { if (App.busy) return; App.convId = null; welcome(); App.showView('chat'); input.focus(); highlightRecent(); };
  $('#newChat').addEventListener('click', App.newChat);

  App.loadConversation = async (id) => {
    if (App.busy) return;
    try {
      const d = await App.api(`/api/conversations/${id}/messages`);
      App.convId = id; messagesEl.innerHTML = '';
      d.messages.forEach((m) => { const b = addRow(m.role, m.content, m.via); if (m.role === 'assistant') addActions(b, m.content); });
      App.showView('chat'); toBottom(); highlightRecent();
    } catch (e) { App.toast(e.message); }
  };

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  let currentAbort = null;
  function setMode(streaming) { sendBtn.innerHTML = streaming ? STOP : SEND; sendBtn.setAttribute('aria-label', streaming ? 'Stop' : 'Send'); }

  // Sends a message and streams the reply into the chat. Returns the final reply text.
  App.send = async (override, opts = {}) => {
    const fromBox = typeof override !== 'string';
    const text = (fromBox ? input.value : override).trim();
    if (!text || App.busy) return null;
    if (fromBox && text.startsWith('/') && App.slash && (await App.slash(text))) { input.value = ''; grow(); return null; }
    const w = $('.welcome'); if (w) w.remove();
    App.busy = true; idleSleep = false; lastActive = Date.now();
    App.restPose(); setMode(true);
    addRow('user', text, opts.via);
    if (fromBox) { input.value = ''; grow(); }
    addTyping();
    const controller = new AbortController(); currentAbort = controller;
    const bubbly = !!(App.settings.chat && App.settings.chat.bubbles) && opts.via !== 'voice';
    let queued = 0, lastBubble = null, live = false, finished = false, pump = Promise.resolve();
    // Texting style, shown while she writes: each finished paragraph appears as its own bubble right away (no waiting for the whole reply).
    const enqueue = (txt, idx) => { pump = pump.then(async () => {
      if (controller.signal.aborted) return;
      if (idx > 0) { addTyping(); await wait(Math.min(900, 300 + txt.length * 10)); }
      rmTyping(); lastBubble = addRow('bot', txt); if (idx > 0) lastBubble.parentElement.classList.add('cont');
      if (!finished) addTyping();
    }); };
    const feed = (final) => {
      if (!bubbly || live) return;
      if (/```/.test(full) || (full.match(/^\s*(?:[-*]|\d+[.)])\s/mg) || []).length >= 2 || /^#{1,4}\s/m.test(full) || (queued === 0 && !full.includes('\n\n') && full.length > 420)) { live = true; rmTyping(); bubble = lastBubble = addRow('bot', ''); bubble._md.innerHTML = App.md(full); return; }
      const parts = full.split(/\n{2,}/), ready = final ? parts : parts.slice(0, -1);
      while (queued < ready.length) { const t = ready[queued].trim(); if (t) enqueue(t, queued); queued++; }
    };
    const startedAt = Date.now();
    let bubble = null, full = '', raf = 0;
    const paint = () => { raf = 0; if (!bubble) return; const st = nearBottom(); bubble._md.innerHTML = App.md(full); if (st) toBottom(); };
    let reply = null;
    try {
      const res = await App.api('/api/chat', { raw: true, signal: controller.signal, body: { convId: App.convId, text, via: opts.via || 'text', spoken: !!opts.spoken, noteId: App.noteId || null } });
      if (!res.ok || !(res.headers.get('content-type') || '').includes('ndjson')) {
        const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Something went wrong.');
      }
      const reader = res.body.getReader(), dec = new TextDecoder(); let buf = '';
      const handle = (line) => {
        if (!line.trim()) return; let ev; try { ev = JSON.parse(line); } catch { return; }
        if (ev.type === 'meta') { if (ev.convId && !App.convId) { App.convId = ev.convId; } if (ev.sleeping) App.sleptTurn = true; }
        else if (ev.type === 'delta') { full += ev.text; if (!bubble && !bubbly) { rmTyping(); bubble = addRow('bot', ''); } if (opts.onText) opts.onText(full); if (!bubbly && !raf) raf = requestAnimationFrame(paint); else if (bubbly) { if (live) { const st = nearBottom(); bubble._md.innerHTML = App.md(full); if (st) toBottom(); } else feed(false); } }
        else if (ev.type === 'error') throw new Error(ev.error);
      };
      for (;;) { const { done, value } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true }); let n; while ((n = buf.indexOf('\n')) >= 0) { handle(buf.slice(0, n)); buf = buf.slice(n + 1); } }
      if (buf) handle(buf);
      cancelAnimationFrame(raf); rmTyping();
      if (bubbly) {
        finished = true;
        if (live) bubble._md.innerHTML = App.md(full); else feed(true);
        await pump; rmTyping();
        if (!lastBubble) lastBubble = addRow('bot', full);
        bubble = lastBubble;
      } else { if (!bubble) bubble = addRow('bot', ''); bubble._md.innerHTML = App.md(full); }
      addActions(bubble, full); toBottom();
      reply = full;
      App.flashPose(App.sleptTurn ? 'sleep' : answerPose(text, full), 3800); App.sleptTurn = false;
      learnedToast(startedAt);
      refreshRecent();
      if (App.refreshHer) { setTimeout(App.refreshHer, 3500); setTimeout(App.refreshHer, 9000); }
      if ((App.settings.voice.autoplay || opts.speak) && !opts.silent) App.speak(full);
    } catch (e) {
      cancelAnimationFrame(raf); rmTyping();
      if (bubbly && !lastBubble && full.trim()) bubble = addRow('bot', full);
      if (e.name === 'AbortError') {
        if (bubble && full.trim()) { bubble._md.innerHTML = App.md(full); addActions(bubble, full); reply = full; }
      } else {
        if (bubble && full.trim()) { bubble._md.innerHTML = App.md(full) + '<p><em>The reply was cut off.</em></p>'; reply = full; }
        else { if (bubble) bubble.parentElement.remove(); addRow('bot', e instanceof TypeError ? 'I could not reach the server. Check your connection and try again.' : e.message); }
        App.flashPose('cry', 4500);
      }
    } finally {
      App.busy = false; currentAbort = null; setMode(false); App.restPose();
      if (!coarse && App.view === 'chat') input.focus();
    }
    return reply;
  };
  sendBtn.addEventListener('click', () => { if (App.busy) { if (currentAbort) currentAbort.abort(); } else App.send(); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !coarse && !e.isComposing) { e.preventDefault(); App.send(); } });
  App.stopChat = () => { if (currentAbort) currentAbort.abort(); };

  // File attach: puts the text of the file into the box (no size limit besides the browser's).
  $('#attachBtn').addEventListener('click', () => $('#fileInput').click());
  $('#fileInput').addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0]; e.target.value = ''; if (!f) return;
    App.flashPose('type', 2500);
    const put = (name, t) => { input.value = (input.value.trim() ? input.value.trim() + '\n\n' : '') + '[File: ' + name + ']\n' + t + '\n[End of file]\n\n'; grow(); input.focus(); };
    try {
      if (/\.(pdf|docx|xlsx|html?|jpe?g|png|webp|gif)$/i.test(f.name) || /^(application\/pdf|image\/)/.test(f.type)) {
        App.toast('Reading ' + f.name + '…', 6000);
        const res = await App.api('/api/extract?name=' + encodeURIComponent(f.name), { body: await f.arrayBuffer(), headers: { 'Content-Type': f.type || 'application/octet-stream' } });
        put(f.name, res.text.length > 16000 ? res.text.slice(0, 16000) + '\n…(the rest is cut off)' : res.text);
      } else {
        const t = await f.text(); if (t.includes('\u0000')) { App.toast('I can read pictures, PDF, HTML and text files'); return; }
        put(f.name, t);
      }
    } catch (err) { App.toast(err.message || 'Could not read that file', 4500); }
  });

  // ---------- recent chats, status, memory toast ----------
  function highlightRecent() { $$('#recent button').forEach((b) => b.classList.toggle('on', b.dataset.id === App.convId)); }
  async function refreshRecent() {
    try {
      const d = await App.api('/api/conversations?limit=14');
      App.conversations = d.conversations;
      const box = $('#recent'); box.innerHTML = '';
      d.conversations.slice(0, 14).forEach((c) => { const b = document.createElement('button'); b.type = 'button'; b.dataset.id = c.id; b.title = c.title; b.textContent = (c.source === 'telegram' ? '✈ ' : '') + c.title; b.addEventListener('click', () => App.loadConversation(c.id)); box.appendChild(b); });
      if (!d.conversations.length) box.innerHTML = '<div class="empty" style="padding:14px;font-size:13px">Your chats will show up here.</div>';
      highlightRecent();
    } catch { /* ignore */ }
  }
  App.refreshRecent = refreshRecent;
  async function refreshStatus() {
    try {
      const s = await App.api('/api/status'); App.status = s;
      $('#memCount').textContent = s.memories + (s.memories === 1 ? ' memory' : ' memories');
      const ok = s.brains.length ? 'Online' : 'No AI key yet';
      $('#footStat').textContent = ok + ' · ' + s.chats + ' chats saved';
      if (!s.brains.length) App.toast('Add GROQ_API_KEY to the Worker so I can think.', 5000);
    } catch { /* ignore */ }
  }
  App.refreshStatus = refreshStatus;
  function learnedToast(since) {
    setTimeout(async () => {
      try {
        const d = await App.api('/api/memories?since=' + since);
        if (d.memories && d.memories.length) { App.toast('Remembered: ' + d.memories[0].text, 3800); refreshStatus(); }
        else if (App.refreshPending) App.refreshPending(true);
      } catch { /* ignore */ }
    }, 4500);
  }

  // ---------- apply settings ----------
  App.applySettings = (s) => {
    App.settings = s;
    $('#brandName').textContent = s.persona.name;
    $$('.pname').forEach((el) => (el.textContent = s.persona.name));
    document.title = s.persona.name + ' Memory AI';
    stickerImg.src = stk(curPose); $('#vImg').src = stk(curPose);
    $$('#messages .av img').forEach((i) => (i.src = stk('smile')));
    POSES.forEach((p) => { new Image().src = stk(p); });
    if (App.hooks.onSettings) App.hooks.onSettings(s);
  };
  App.saveSettings = async (patch) => {
    try { const s = await App.api('/api/settings', { method: 'PUT', body: patch }); App.applySettings(s); return s; }
    catch (e) { App.toast(e.message); }
  };

  // ---------- boot ----------
  async function boot() {
    if (!App.token) { showLogin(); return; }
    try {
      const s = await App.api('/api/settings');
      App.applySettings(s);
      curPose = sleepMode() ? 'sleep' : 'smile'; stickerBtn.dataset.pose = curPose; stickerImg.src = stk(curPose); stkBob.classList.toggle('asleep', curPose === 'sleep');
      welcome();
      // Only what the first screen needs is loaded now. Recent chats, counts and ideas load a moment later, and every other section loads when you open it.
      setTimeout(() => { refreshRecent(); refreshStatus(); }, 250);
      setTimeout(() => { if (App.refreshPending) App.refreshPending(false); }, 1800);
      if (!sleepMode()) setTimeout(() => App.flashPose('wave', 3500), 600);
      if (App.hooks.onBoot) App.hooks.onBoot();
      const go = new URLSearchParams(location.search).get('go');
      if (go && TITLES[go]) { App.showView(go); try { history.replaceState(null, '', '/'); } catch { /* ignore */ } }
    } catch (e) { if (e.status !== 401) App.toast(e.message, 5000); }
  }
  grow(); setMode(false); paintIdea();
  boot();
})();
