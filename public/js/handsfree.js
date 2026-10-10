/* Hands-free: say "Hey Tiny" and voice chat opens. Works while this page is open (browsers do not let a page listen when it is closed). */
(function () {
  'use strict';
  const { $, LS } = App;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const toggle = $('#hfOn');
  let rec = null, want = LS.get('mai_hf') === '1', running = false, paused = false, retry = 0;

  const ALIAS = { tiny: 'tiny|tinny|teeny|tini|tinie|tiney|tinnie', byte: 'byte|bite|bait|bight' };
  function wakeRe() {
    const n = (App.settings.persona.name || 'Tiny').toLowerCase().replace(/[^a-z0-9 ]/g, '').trim() || 'tiny';
    const names = ALIAS[n] || n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('\\b(hey|hi|hello|hay|ok|okay|oye|arre|suno)[,.!]?\\s+(' + names + ')\\b', 'i');
  }
  const pill = document.createElement('span');
  pill.className = 'chip hf-pill'; pill.hidden = true; pill.setAttribute('role', 'status');
  pill.innerHTML = '<svg class="ic"><use href="#i-mic"/></svg><span></span>';
  const top = document.querySelector('.topbar'); if (top) top.insertBefore(pill, $('#memChip'));
  const paint = () => { pill.hidden = !(want && SR); pill.lastChild.textContent = paused ? 'Hands-free paused' : 'Say "Hey ' + (App.settings ? App.settings.persona.name : 'Tiny') + '"'; };

  function beep() {
    try { const c = new (window.AudioContext || window.webkitAudioContext)(), o = c.createOscillator(), g = c.createGain(); o.type = 'sine'; o.frequency.value = 880; g.gain.setValueAtTime(0.0001, c.currentTime); g.gain.exponentialRampToValueAtTime(0.18, c.currentTime + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.25); o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + 0.27); setTimeout(() => c.close(), 500); } catch { /* ignore */ }
  }
  function start() {
    if (!SR || !want || running || paused || document.hidden) return;
    try {
      rec = new SR(); rec.continuous = true; rec.interimResults = true; rec.lang = 'en-IN'; rec.maxAlternatives = 3;
      rec.onresult = (e) => {
        let t = ''; for (let i = e.resultIndex; i < e.results.length; i++) for (let j = 0; j < e.results[i].length; j++) t += ' ' + e.results[i][j].transcript;
        if (wakeRe().test(t)) { retry = 0; stop(); beep(); App.flashPose('wave', 2500); paused = true; paint(); App.openVoice(); }
      };
      rec.onerror = (e) => {
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { want = false; LS.set('mai_hf', '0'); toggle.checked = false; App.toast('Allow the microphone to use hands-free'); paint(); }
      };
      rec.onend = () => { running = false; if (want && !paused) setTimeout(start, Math.min(5000, 300 + retry++ * 400)); };
      rec.onstart = () => { running = true; };
      rec.start(); running = true;
    } catch { running = false; }
  }
  function stop() { const r = rec; rec = null; running = false; if (r) { r.onend = null; try { r.stop(); } catch { /* ignore */ } } }

  document.addEventListener('voice:closed', () => { paused = false; paint(); setTimeout(start, 600); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else start(); });

  toggle.addEventListener('change', () => {
    if (!SR) { toggle.checked = false; App.toast('Hands-free needs Chrome or Edge'); return; }
    want = toggle.checked; LS.set('mai_hf', want ? '1' : '0'); paused = false; paint();
    if (want) { start(); App.toast('Say "Hey ' + App.settings.persona.name + '" any time'); } else stop();
  });
  const prev = App.hooks.onBoot;
  App.hooks.onBoot = () => { if (prev) prev(); toggle.checked = want && !!SR; paint(); start(); };
  const prevS = App.hooks.onSettings;
  App.hooks.onSettings = (s) => { if (prevS) prevS(s); paint(); };
})();
