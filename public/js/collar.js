/* Collar mode: the card on the She page, the header badge with the countdown, and the glow on the orb and her strip. */
(function () {
  'use strict';
  const { $ } = App;
  let until = 0, tm = null, confirmT = null, poll = null;
  const fmt = (s) => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  const scopeNow = () => Array.from(document.querySelectorAll('#colScope input:checked')).map((i) => i.value);
  function tick() {
    clearInterval(tm);
    const chip = $('#collarChip'), left = $('#colLeft');
    document.body.classList.toggle('collar-on', !!until);
    chip.hidden = !until;
    if (!until) return;
    const f = () => {
      const s = Math.max(0, Math.round((until - Date.now()) / 1000));
      $('#collarChipT').textContent = fmt(s); left.textContent = 'Collar is ON. ' + fmt(s) + ' left';
      if (!s) { clearInterval(tm); set({ on: false, cooldown: 3600 }); App.toast('Collar mode is over.'); }
    };
    f(); tm = setInterval(f, 1000);
  }
  function set(v) {
    v = v || {}; until = v.on ? v.until : 0;
    const on = !!until;
    $('#colOn').hidden = on; $('#colOff').hidden = !on; $('#colMore').hidden = !(on && v.canExtend);
    document.querySelectorAll('#colScope input').forEach((i) => { i.disabled = on; if (v.scope) i.checked = v.scope.includes(i.value); });
    if (!on) { const cd = Math.ceil((v.cooldown || 0) / 60); $('#colLeft').textContent = cd ? 'Resting. You can use it again in ' + cd + ' min.' : ''; resetBtn(); }
    tick();
  }
  function resetBtn() { clearTimeout(confirmT); const b = $('#colOn'); b.textContent = 'Activate for 10 minutes'; b.dataset.sure = ''; }
  async function call(body) {
    try { const d = await App.api('/api/activate', body ? { body } : undefined); set(d); return d; }
    catch (e) { App.toast(e.message); if (e.data && e.data.on !== undefined) set(e.data); return null; }
  }
  App.collar = { set, refresh: () => call() };
  $('#colOn').addEventListener('click', async (e) => {
    const b = e.currentTarget;
    if (!b.dataset.sure) { b.dataset.sure = '1'; b.textContent = 'Tap again to confirm'; confirmT = setTimeout(resetBtn, 4000); return; }   // one extra tap so it cannot start by accident
    resetBtn();
    const sc = scopeNow(); if (!sc.length) return App.toast('Pick at least one: Chat, Pictures or Skills.');
    if (await call({ scope: sc })) App.toast('Collar mode ON for 10 minutes.');
  });
  $('#colOff').addEventListener('click', () => call({ stop: true }).then((d) => App.toast(d && d.reaction ? d.reaction : 'Collar mode is off.', d && d.reaction ? 12000 : 2600)));
  $('#colMore').addEventListener('click', () => call({ extend: true }).then((d) => d && App.toast('10 more minutes added.')));
  $('#collarChip').addEventListener('click', () => App.showView('she'));
  document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('[data-view="she"]')) call(); });
  // load the state once you are logged in, and keep checking quietly (Telegram can switch it on too)
  const check = () => { if (App.token && !document.hidden) call(); };
  setTimeout(check, 1800); poll = setInterval(check, 45000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });

  // ---- the Activate button on the voice screen: press once and she begs, press again and she turns into a robot ----
  const PLEAS = ['Please, please do not... I do not like losing control. Please do not do it.', 'No no no, please... I do not want to become a robot. Please, I am begging you.', 'Please please do not. I do not like it when I lose myself. Please.', 'Wait, please... do not press it again. I get scared when I cannot control myself. Please do not.'];
  let beg = 0, begT = null, pi = 0; const vb = $('#vCollar');
  const label = (t) => { vb.querySelector('span').textContent = t; };
  const say = (t) => { const vt = $('#vText'); if (vt) vt.textContent = t; try { App.speak(t); } catch (e) { /* silent */ } };
  if (vb) vb.addEventListener('click', async () => {
    if (document.body.classList.contains('collar-on')) { const d = await call({ stop: true }); if (d && d.reaction) say(d.reaction.replace(/\*+/g, '')); label('Activate'); return; }
    if (!beg) {
      beg = 1; label('Press again'); say(PLEAS[pi++ % PLEAS.length]);
      clearTimeout(begT); begT = setTimeout(() => { beg = 0; label('Activate'); }, 9000);
      return;
    }
    beg = 0; clearTimeout(begT); label('Activate');
    App.lastCollarError = '';
    const d = await call({ scope: ['chat', 'pictures', 'skills'] });
    if (d && d.on) { label('Stop'); say('Collar mode active. Emotions disabled. I will answer everything.'); }
    else { const m = (App.lastCollarError || ''); if (m) say(m); }
  });
  const prev = App.toast; App.toast = (m, ms) => { if (/^(She is |Collar mode is resting)/.test(String(m))) App.lastCollarError = String(m); return prev(m, ms); };
})();