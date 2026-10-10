/* Voice: listen (mic + silence detection), speak (cloud voice, browser voice as backup), dictation, and the voice chat screen. */
(function () {
  'use strict';
  const { $, $$, esc } = App;
  const DEV = /[ऀ-ॿ]/;

  // ---------- audio unlock (phones only allow sound after a tap) ----------
  const audio = new Audio();
  let unlocked = false;
  function unlock() {
    if (unlocked) return; unlocked = true;
    try { audio.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA='; audio.play().catch(() => {}); } catch { /* ignore */ }
    try { if (window.speechSynthesis) speechSynthesis.getVoices(); } catch { /* ignore */ }
  }
  document.addEventListener('pointerdown', unlock, { once: true, capture: true });

  // ---------- speak ----------
  const plain = (t) => String(t || '').replace(/```[\s\S]*?```/g, ' ').replace(/`([^`]*)`/g, '$1').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/https?:\/\/\S+/g, '').replace(/^#{1,6}\s*/gm, '').replace(/[*_~>#]+/g, '').replace(/^\s*[-+]\s+/gm, '').replace(/\s*\.{3,}|…/g, ', ').replace(/\s+/g, ' ').trim();
  function chunk(text) {
    const parts = text.match(/[^.!?।\n]+[.!?।]*\s*/g) || [text];
    const out = []; let cur = '';
    for (const p of parts) { if ((cur + p).length > 260 && cur) { out.push(cur.trim()); cur = p; } else cur += p; }
    if (cur.trim()) out.push(cur.trim());
    return out.slice(0, 14);
  }
  let token = 0, curUrl = null;
  function fetchClip(text) {
    return App.api('/api/tts', { raw: true, body: { text } }).then(async (r) => { if (!r.ok) return null; return URL.createObjectURL(await r.blob()); }).catch(() => null);
  }
  function playUrl(url, my) {
    return new Promise((resolve) => {
      if (my !== token) return resolve();
      const done = () => { audio.onended = audio.onerror = null; resolve(); };
      audio.onended = done; audio.onerror = done;
      audio.src = url; audio.playbackRate = App.settings.voice.rate || 1;
      audio.play().catch(done);
    });
  }
  function pickVoice(lang) {
    const vs = speechSynthesis.getVoices(); if (!vs.length) return null;
    const girl = App.settings.persona.gender !== 'boy';
    const want = girl ? /female|woman|zira|samantha|heera|neerja|swara|veena|google .*(female|hindi|india)/i : /male|man|david|mark|ravi|prabhat|google uk english male/i;
    const pool = vs.filter((v) => v.lang.toLowerCase().startsWith(lang.slice(0, 2)));
    return pool.find((v) => want.test(v.name) && v.lang.toLowerCase() === lang.toLowerCase()) || pool.find((v) => want.test(v.name)) || pool.find((v) => v.lang.toLowerCase() === lang.toLowerCase()) || pool[0] || null;
  }
  function playBrowser(text, my) {
    return new Promise((resolve) => {
      if (my !== token || !window.speechSynthesis) return resolve();
      const u = new SpeechSynthesisUtterance(text);
      const lang = DEV.test(text) ? 'hi-IN' : 'en-IN'; u.lang = lang;
      const v = pickVoice(lang); if (v) u.voice = v;
      const v2 = App.settings.voice;
      u.rate = v2.rate || 1; u.pitch = App.settings.persona.gender === 'boy' ? Math.max(0.6, (v2.pitch || 1) - 0.45) : Math.max(1.15, v2.pitch || 1.25);
      u.onend = u.onerror = () => resolve();
      speechSynthesis.speak(u);
    });
  }
  App.stopSpeak = () => {
    token++;
    try { audio.pause(); } catch { /* ignore */ }
    try { if (window.speechSynthesis) speechSynthesis.cancel(); } catch { /* ignore */ }
    App.charState.speaking = false; setOrb(null); App.restPose();
  };
  App.speak = async (text) => {
    const clean = plain(text); if (!clean) return;
    App.stopSpeak();
    const my = ++token;
    App.charState.speaking = true; App.restPose(); setOrb('speaking');
    try {
      const browserOnly = App.settings.voice.engine === 'browser';
      const parts = chunk(clean);
      const clips = browserOnly ? [] : parts.map(fetchClip);
      for (let i = 0; i < parts.length; i++) {
        if (my !== token) break;
        const url = browserOnly ? null : await clips[i];
        if (url) { await playUrl(url, my); URL.revokeObjectURL(url); }
        else await playBrowser(parts[i], my);
      }
    } finally {
      if (my === token) { App.charState.speaking = false; setOrb(null); App.restPose(); }
    }
  };

  // ---------- listen ----------
  function listen({ maxMs = 90000, idleMs = 9000, silenceMs = 1500, onLevel } = {}) {
    let stream, rec, ac, timer, stopped = false, cancelled = false, spoke = false;
    const chunks = [];
    const handle = {
      stop() { stopped = true; if (rec && rec.state !== 'inactive') rec.stop(); },
      cancel() { cancelled = true; handle.stop(); },
      timedOut: false,
    };
    handle.promise = (async () => {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
      rec = new MediaRecorder(stream, mime ? { mimeType: mime } : {});
      rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      ac = new (window.AudioContext || window.webkitAudioContext)();
      const an = ac.createAnalyser(); an.fftSize = 1024; ac.createMediaStreamSource(stream).connect(an);
      const buf = new Uint8Array(an.fftSize);
      const t0 = Date.now(); let lastVoice = t0, floor = 0, n = 0;
      return new Promise((resolve) => {
        const cleanup = () => { clearInterval(timer); try { stream.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ } try { ac.close(); } catch { /* ignore */ } };
        rec.onstop = () => { cleanup(); resolve(cancelled || !spoke ? null : new Blob(chunks, { type: (rec.mimeType || mime || 'audio/webm').split(';')[0] })); };
        rec.start(250);
        timer = setInterval(() => {
          an.getByteTimeDomainData(buf);
          let s = 0; for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; s += v * v; }
          const rms = Math.sqrt(s / buf.length), now = Date.now();
          if (now - t0 < 400) { floor = (floor * n + rms) / (n + 1); n++; }
          const thr = Math.max(0.025, floor * 2.6);
          if (onLevel) onLevel(Math.min(1, rms * 6));
          if (rms > thr) { spoke = true; lastVoice = now; }
          if (spoke && now - lastVoice > silenceMs) handle.stop();
          else if (!spoke && now - t0 > idleMs) { handle.timedOut = true; handle.cancel(); }
          else if (now - t0 > maxMs) handle.stop();
        }, 80);
      });
    })();
    return handle;
  }
  async function transcribe(blob) {
    const r = await App.api('/api/stt', { body: blob, headers: { 'Content-Type': blob.type || 'audio/webm' } });
    return (r.text || '').trim();
  }
  const micError = (e) => App.toast(e && /denied|permission|notallowed/i.test(e.name + e.message) ? 'Microphone permission is blocked' : (e.message || 'Could not use the microphone'));

  // ---------- dictation button in the chat bar ----------
  const micBtn = $('#micBtn'); let dict = null;
  micBtn.addEventListener('click', async () => {
    unlock();
    if (dict) { dict.stop(); return; }
    if (!navigator.mediaDevices || !window.MediaRecorder) { App.toast('Voice input is not supported in this browser'); return; }
    try {
      dict = listen({ idleMs: 12000, silenceMs: 2200 });
      micBtn.classList.add('rec'); App.charState.listening = true; App.restPose();
      const blob = await dict.promise;
      micBtn.classList.remove('rec'); App.charState.listening = false; App.restPose();
      const was = dict; dict = null;
      if (!blob) { if (was.timedOut) App.toast('I did not hear anything'); return; }
      micBtn.disabled = true;
      const t = await transcribe(blob);
      if (t) { const i = $('#input'); i.value = (i.value.trim() ? i.value.trim() + ' ' : '') + t; i.dispatchEvent(new Event('input')); i.focus(); }
    } catch (e) { dict = null; micBtn.classList.remove('rec'); App.charState.listening = false; App.restPose(); micError(e); }
    finally { micBtn.disabled = false; }
  });

  // ---------- voice chat screen ----------
  const ov = $('#voiceOv'), orb = $('#orb'), vState = $('#vState'), vText = $('#vText');
  let on = false, handle = null, phase = 'idle', muted = false, turns = 0, t0 = 0, tick = null;
  const fmt = (ms) => { const s2 = Math.floor(ms / 1000); return Math.floor(s2 / 60) + ':' + String(s2 % 60).padStart(2, '0'); };
  function setOrb(cls) { orb.classList.toggle('speaking', cls === 'speaking'); orb.classList.toggle('listening', cls === 'listening'); }
  function setPhase(p, msg) {
    phase = p;
    vState.textContent = { idle: 'Tap the orb and talk', listening: 'Listening…', thinking: 'Thinking…', speaking: App.settings.persona.name + ' is talking' }[p];
    if (msg !== undefined) vText.textContent = msg;
    setOrb(p === 'listening' ? 'listening' : p === 'speaking' ? 'speaking' : null);
    if (p === 'thinking') App.flashPose('explain', 20000);
  }
  async function loop() {
    while (on) {
      let blob = null;
      try {
        setPhase('listening'); App.charState.listening = true; App.restPose();
        handle = listen({ onLevel: (l) => { orb.style.transform = 'scale(' + (1 + l * 0.18).toFixed(3) + ')'; } });
        blob = await handle.promise;
      } catch (e) { micError(e); break; }
      finally { orb.style.transform = ''; App.charState.listening = false; }
      const timedOut = handle && handle.timedOut; handle = null;
      if (!on || muted) break;
      if (!blob) { if (timedOut) { setPhase('idle', 'Tap the orb when you want to talk.'); break; } continue; }
      setPhase('thinking');
      let text = '';
      try { text = await transcribe(blob); } catch (e) { App.toast(e.message); break; }
      if (!text) continue;
      if (/^\s*(stop|bye|goodbye|close|that'?s all|band kar)\b/i.test(text)) { close(); break; }
      $('#vYou').textContent = 'You: ' + text; vText.textContent = ''; turns++;
      const reply = await App.send(text, { via: 'voice', spoken: true, silent: true, onText: (t) => { vText.textContent = t.slice(-280); } });
      if (!on) break;
      if (!reply) { setPhase('idle', 'Something went wrong. Tap the orb to try again.'); break; }
      vText.textContent = reply.length > 320 ? reply.slice(0, 320) + '…' : reply;
      setPhase('speaking'); await App.speak(reply);
    }
    if (on && phase !== 'idle') setPhase('idle');
  }
  function setMuted(m) {
    muted = m; $('#vMute span').textContent = m ? 'Unmute' : 'Mute';
    if (m) { if (handle) handle.cancel(); App.stopSpeak(); setPhase('idle', 'Muted. Press Unmute to keep talking.'); }
    else if (on) { setPhase('idle', ''); loop(); }
  }
  function open() {
    unlock();
    if (!navigator.mediaDevices || !window.MediaRecorder) { App.toast('Voice chat is not supported in this browser'); return; }
    on = true; muted = false; turns = 0; t0 = Date.now(); $('#vMute span').textContent = 'Mute'; $('#vYou').textContent = ''; vText.textContent = '';
    ov.classList.add('on'); $('#vTimer').textContent = '0:00'; clearInterval(tick); tick = setInterval(() => { $('#vTimer').textContent = fmt(Date.now() - t0); }, 1000);
    App.showView('chat'); loop();
  }
  function close() {
    if (!on) return;
    on = false; ov.classList.remove('on'); clearInterval(tick);
    if (turns > 0) { const m = $('#messages'), r = document.createElement('div'); r.className = 'receipt'; r.textContent = 'Voice chat · ' + fmt(Date.now() - t0) + ' · ' + turns + (turns === 1 ? ' turn' : ' turns'); m.appendChild(r); m.scrollTop = m.scrollHeight; }
    if (handle) handle.cancel(); App.stopSpeak(); App.stopChat();
    App.charState.listening = false; App.restPose(); setOrb(null);
    document.dispatchEvent(new CustomEvent('voice:closed'));
  }
  orb.addEventListener('click', () => {
    unlock();
    if (phase === 'listening' && handle) { handle.stop(); return; }   // done talking, send it now
    if (phase === 'speaking') { App.stopSpeak(); if (on) { setPhase('idle'); loop(); } return; }
    if (phase === 'thinking') return;
    if (muted) { App.toast('You are muted'); return; }
    if (!on) on = true;
    loop();
  });
  App.openVoice = () => { if (!on) open(); };
  App.voiceIsOn = () => on;
  $('#voiceOpen').addEventListener('click', open);
  $('#vClose').addEventListener('click', close);
  $('#vMute').addEventListener('click', () => setMuted(!muted));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && on) close(); });
  $('#vTest').addEventListener('click', () => { unlock(); App.speak('Hi! This is how I sound. Tell me if you want me softer or faster.'); });
})();
