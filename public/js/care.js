/* Phone app: install, notifications, and the "looking after you" settings. */
(function () {
  'use strict';
  const { $ } = App;
  let deferred = null, ready = false;

  const b64uToBytes = (s) => { const p = (s + '='.repeat((4 - (s.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'); const r = atob(p); return Uint8Array.from(r, (c) => c.charCodeAt(0)); };
  const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);

  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; paintPwa(); });
  window.addEventListener('appinstalled', () => { deferred = null; paintPwa(); });
  $('#pwaInstall').addEventListener('click', async () => { if (!deferred) return; deferred.prompt(); try { await deferred.userChoice; } catch { /* ignore */ } deferred = null; paintPwa(); });

  async function pushState() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
    if (Notification.permission === 'denied') return 'blocked';
    try { const reg = await navigator.serviceWorker.ready; const sub = await reg.pushManager.getSubscription(); return sub && Notification.permission === 'granted' ? 'on' : 'off'; } catch { return 'off'; }
  }
  async function paintPwa() {
    const st = App.status && App.status.push, s = await pushState();
    $('#pwaInstall').hidden = !deferred || standalone();
    const btn = $('#pushOn');
    btn.hidden = s === 'unsupported';
    btn.lastChild.textContent = s === 'on' ? 'Turn off notifications' : 'Turn on notifications';
    $('#pushTest').hidden = s !== 'on';
    let msg;
    if (st && !st.configured) msg = 'Notifications need one setup step on the server (npm run vapid, see the README). Telegram messages already work.';
    else if (s === 'unsupported') msg = isIOS && !standalone() ? 'On iPhone: tap Share, then Add to Home Screen, then open the app from there to use notifications.' : 'This browser cannot show notifications.';
    else if (s === 'blocked') msg = 'Notifications are blocked for this site. Allow them in the browser settings.';
    else if (s === 'on') msg = 'Notifications are on for this device' + (st ? ' (' + st.devices + ' device' + (st.devices === 1 ? '' : 's') + ' linked).' : '.');
    else msg = 'Off on this device.';
    if (standalone()) msg = 'Installed. ' + msg;
    $('#pwaState').textContent = msg;
  }

  async function enablePush() {
    const k = await App.api('/api/push/key');
    if (!k.key) throw new Error('Add the VAPID keys on the server first (see the README).');
    if ((await Notification.requestPermission()) !== 'granted') throw new Error('Notifications were not allowed.');
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(k.key) });
    await App.api('/api/push/subscribe', { body: { subscription: sub.toJSON() } });
  }
  async function disablePush() {
    const reg = await navigator.serviceWorker.ready; const sub = await reg.pushManager.getSubscription();
    if (sub) { await App.api('/api/push/unsubscribe', { body: { endpoint: sub.endpoint } }).catch(() => {}); await sub.unsubscribe().catch(() => {}); }
  }
  $('#pushOn').addEventListener('click', async () => {
    try { if ((await pushState()) === 'on') await disablePush(); else { await enablePush(); App.toast('Notifications are on'); } } catch (e) { App.toast(e.message, 4500); }
    if (App.refreshStatus) await App.refreshStatus(); paintPwa();
  });
  $('#pushTest').addEventListener('click', async () => {
    try { const r = await App.api('/api/push/test', { body: {} }); App.toast(r.push ? 'Sent. Check your notifications.' : r.telegram ? 'Sent to Telegram.' : 'Nothing could be sent.'); } catch (e) { App.toast(e.message); }
  });

  // ---------- caring routines ----------
  const hour = $('#moodHour');
  for (let h = 6; h <= 23; h++) { const o = document.createElement('option'); o.value = h; o.textContent = ((h + 11) % 12 + 1) + ':00 ' + (h < 12 ? 'am' : 'pm'); hour.appendChild(o); }
  const hh = $('#habHour');
  for (let h = 15; h <= 23; h++) { const o = document.createElement('option'); o.value = h; o.textContent = ((h + 11) % 12 + 1) + ':00 ' + (h < 12 ? 'am' : 'pm'); hh.appendChild(o); }
  $('#habOn').addEventListener('change', (e) => App.saveSettings({ habits: { enabled: e.target.checked } }));
  hh.addEventListener('change', () => App.saveSettings({ habits: { hour: +hh.value } }));
  $('#habGoal').addEventListener('change', (e) => App.saveSettings({ habits: { goal: +e.target.value } }));
  $('#teaseOn').addEventListener('change', (e) => App.saveSettings({ chat: { tease: e.target.checked, dayTexts: +$('#dayTexts').value } }));
  $('#dayTexts').addEventListener('change', (e) => App.saveSettings({ chat: { tease: $('#teaseOn').checked, dayTexts: +e.target.value } }));
  $('#tinyMood').addEventListener('change', async (e) => { const v = e.target.value; await App.saveSettings({ tinyMood: v }); if (!['auto', 'lazy', 'in_pain'].includes(v)) { e.target.value = 'auto'; App.toast('Done. She starts in that mood and it now changes with the chat.', 4000); } if (App.refreshHer) App.refreshHer(); });
  // ---------- her cycle (set the first date in the She section; after that it is automatic) ----------
  const pe = { ann: $('#peAnn') };
  const istToday = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
  function cycleText(s) {
    const n = s.periodNow;
    if (!n) return s.persona.gender === 'boy' ? 'Only Tiny (girl) has period days.' : 'No first date yet. Press "Period started today" once, then it runs by itself.';
    if (n.phase === 'period') return 'Day ' + n.day + ' of ' + n.of + ', pain level ' + n.pain + '%.';
    if (n.phase === 'pms') return 'PMS days: her period is due in ' + n.left + ' day' + (n.left === 1 ? '' : 's') + '. She is moody and sensitive.';
    return 'Feeling normal. Next period in ' + n.left + ' day' + (n.left === 1 ? '' : 's') + '.';
  }
  function fillCycle(s) {
    const girl = s.persona.gender !== 'boy';
    $('#cycleCard').hidden = !girl;
    pe.ann.checked = s.period.announce;
    $('#peState').textContent = cycleText(s);
    $('#peToday').hidden = !!s.period.lastStart;
  }
  pe.ann.addEventListener('change', () => App.saveSettings({ period: { announce: pe.ann.checked } }));
  $('#peToday').addEventListener('click', async () => { try { await App.api('/api/she', { body: { action: 'periodStart' } }); await App.saveSettings({}); App.toast('Okay... her period started today. Be nice to her!'); App.flashPose('cry', 4000); } catch (e) { App.toast(e.message); } });
  $('#peOpen').addEventListener('click', () => App.showView('she'));
  $('#peTest').addEventListener('click', async () => {
    const b = $('#peTest'); b.disabled = true;
    try { await App.api('/api/care/run', { body: { what: 'period' } }); App.toast('Sent. Look at your phone or Telegram, or the Routines chat.', 4500); if (App.refreshRecent) App.refreshRecent(); } catch (e) { App.toast(e.message); }
    b.disabled = false;
  });

  // ---------- her feelings: sleep, nakhre, mood chip in the header ----------
  const hrOpts = (sel, from, to) => { for (let h = from; h <= to; h++) { const o = document.createElement('option'); o.value = h; o.textContent = ((h + 11) % 12 + 1) + ':00 ' + (h < 12 ? 'am' : 'pm'); sel.appendChild(o); } };
  hrOpts($('#slFrom'), 20, 23); { const o = document.createElement('option'); o.value = '22.5'; o.textContent = '10:30 pm'; const sf = $('#slFrom'); sf.insertBefore(o, sf.children[3]); } hrOpts($('#slTo'), 3, 11); hrOpts($('#brHour'), 5, 11);
  $('#battOn').addEventListener('change', (e) => App.saveSettings({ battery: { enabled: e.target.checked } }).then(() => App.refreshHer && App.refreshHer()));
  $('#battLimit').addEventListener('change', (e) => App.saveSettings({ battery: { limit: +e.target.value } }).then(() => App.refreshHer && App.refreshHer()));
  $('#battMin').addEventListener('change', (e) => App.saveSettings({ battery: { chargeMinutes: +e.target.value } }));
  $('#diOn').addEventListener('change', (e) => App.saveSettings({ diary: { enabled: e.target.checked } }));
  $('#ouOn').addEventListener('change', (e) => App.saveSettings({ outfit: { enabled: e.target.checked } }));
  $('#brOn').addEventListener('change', (e) => App.saveSettings({ briefing: { enabled: e.target.checked } }));
  $('#brHour').addEventListener('change', (e) => App.saveSettings({ briefing: { hour: +e.target.value } }));
  let lastHer = null;
  function paintPeriodChip(v) {
    const chip = $('#periodChip'), p = v && v.period;
    chip.hidden = !p; if (!p) return;
    chip.lastChild.textContent = p.phase === 'period' ? 'Day ' + p.day + ' · ' + p.pain + '%' : p.phase === 'pms' ? 'PMS · ' + p.left + 'd' : 'Next ' + p.left + 'd';
    chip.style.cursor = 'pointer'; chip.title = 'Open the She section';
  }
  $('#periodChip').addEventListener('click', () => App.showView('she'));
  function paintMood(v, life) {
    paintPeriodChip(v);
    const chip = $('#moodChip'); if (!chip || !v) return;
    const pct = v.forgive != null ? ' ' + v.forgive + '%' : '';
    chip.hidden = false; chip.dataset.k = v.kind; chip.firstChild.textContent = v.emoji; chip.lastChild.textContent = v.label + pct;
    chip.title = 'Her mood: ' + v.label + (v.forgive != null ? '. Forgiveness ' + v.forgive + '%: a sorry, a compliment or a little gift (a joke, a poem, a chai) raises it.' : '');
    chip.setAttribute('aria-label', chip.title);
    const fs = $('#feelState');
    if (fs) fs.textContent = 'Right now: ' + v.emoji + ' ' + v.label + (v.forgive != null ? ' (forgiveness ' + v.forgive + '%' + (v.why ? ', because ' + v.why : '') + ')' : '') + (v.sleeping ? '. She is sleeping' + (v.queued ? ' and ' + v.queued + ' message' + (v.queued === 1 ? ' is' : 's are') + ' waiting for the morning' : '') + '.' : '.');
    // her face and voice follow the mood
    const before = lastHer; lastHer = v; { const wb = $('#whyBox'); if (wb && !wb.hidden) wb.textContent = whyText(); } App.herKind = v.kind;
    if (before && (before.angry || before.sulky) && !(v.angry || v.sulky) && App.flashPose) App.flashPose('blush', 4500);   // she melted
    else if (App.restPose) App.restPose();
    App.herState = v; paintBatt(before, v);
    if (life) paintLife(life);
  }
  let battTimer = null;
  function paintBatt(before, v) {
    const el = $('#batt'), b = v && v.battery; if (!el) return;
    clearTimeout(battTimer);
    if (!b || !b.enabled) { el.hidden = true; return; }
    el.hidden = false;
    const pct = b.pct;
    el.classList.toggle('low', pct <= 20 && !b.charging); el.classList.toggle('mid', pct > 20 && pct <= 50 && !b.charging); el.classList.toggle('charging', b.charging);
    $('#battFill').setAttribute('width', String(Math.max(0, 23 * pct / 100)));
    $('#battTxt').textContent = b.charging ? 'Charging ' + b.minsLeft + ' min' : pct + '%';
    const go = $('#battGo'); go.hidden = b.charging || !(b.fainted || pct <= 40); go.textContent = b.low && !b.fainted ? 'Quick charge ' + b.quickMin + ' min' : 'Charge';
    const pb = $('#battPb'); pb.hidden = !(b.charging || b.fainted || b.low) || b.pbUsed;
    el.title = 'Battery: every message you send uses ' + Math.round(100 / b.limit) + '%. At 0% she faints and needs ' + ((App.settings && App.settings.battery && App.settings.battery.chargeMinutes) || 5) + ' min of charging.';
    if (before && before.battery && before.battery.charging && !b.charging && !b.fainted) { App.toast('Hey, I am fully charged! 🔋', 5000); if (App.flashPose) App.flashPose('cheer', 4000); }
    if (b.charging) battTimer = setTimeout(() => App.refreshHer && App.refreshHer(), 15000);
  }
  document.addEventListener('click', async (e) => {
    if (e.target.closest('#battPb')) {
      try { const r = await App.api('/api/battery', { body: { action: 'powerbank' } }); if (r.text) { App.say(r.text); if (App.flashPose) App.flashPose('cheer', 4000); } else App.toast(r.result === 'used' ? 'The power bank was already used today.' : 'Her battery is already full.'); } catch (er) { App.toast(er.message); }
      if (App.refreshHer) App.refreshHer(); return;
    }
    if (!e.target.closest('#battGo')) return;
    try { const r = await App.api('/api/battery', { body: { action: 'charge' } }); App.toast(r.result === 'started' ? 'Charging. She will say when she is full.' : r.result === 'already' ? 'Already charging.' : 'Not needed yet.'); } catch (er) { App.toast(er.message); }
    if (App.refreshHer) App.refreshHer();
  });
  function paintLife(l) {
    const el = $('#lifeText'); if (!el || !l) return;
    const p = l.profile;
    el.textContent = !p ? 'Her day is written automatically after 7 am. You can write it now with the button below.' : (l.today || 'Not written yet today.') + '\n\nFavourite food: ' + p.favFood + '. Best friend: ' + p.bestFriend.name + ' (' + p.bestFriend.about + '). Habit: ' + p.quirk + '.';
    el.style.whiteSpace = 'pre-line';
  }
  const whyText = () => (lastHer && lastHer.reasons && lastHer.reasons.length ? lastHer.reasons.map((x) => '• ' + x).join('\n') : 'Loading her mood...');
  $('#whyBtn').addEventListener('click', async () => { if (App.refreshHer) await App.refreshHer(); const b = $('#whyBox'); b.hidden = !b.hidden || false; if (!b.hidden) b.textContent = whyText(); });
  $('#moodChip').addEventListener('click', () => App.toast(lastHer && lastHer.reasons ? lastHer.reasons.join(' ') : 'Loading...', 9000));
  $('#moodChip').style.cursor = 'pointer';
  App.refreshHer = async () => { try { const d = await App.api('/api/her'); paintMood(d.her, d.life); } catch { /* ignore */ } };
  function fillFeel(s) {
    const girl = s.persona.gender !== 'boy';
    $('#amOn').checked = s.ambient.enabled; if (document.activeElement !== $('#amPlace')) $('#amPlace').value = s.ambient.place;
    $('#slOn').checked = s.sleep.enabled; $('#slFrom').value = String(s.sleep.from + (s.sleep.fromMin === 30 ? 0.5 : 0)); $('#slTo').value = s.sleep.to;
    $('#nkOn').checked = s.her.nakhre; $('#nkPer').value = String(s.her.nakhrePerDay); $('#rcOn').checked = s.her.react;
    $('#hrNakhre').hidden = !girl; $('#nkOn').closest('.line-row').hidden = !girl; $('#nkPer').closest('.field').hidden = !girl;
    $('#sunOn').checked = s.her.sunday !== false; $('#brOn').checked = s.briefing.enabled; $('#diOn').checked = !s.diary || s.diary.enabled !== false; $('#ouOn').checked = !s.outfit || s.outfit.enabled !== false; { const ba = s.battery || {}; $('#battOn').checked = ba.enabled !== false; $('#battLimit').value = String(ba.limit || 20); $('#battMin').value = String(ba.chargeMinutes || 5); } $('#brHour').value = String(s.briefing.hour);
    $('#prOn').checked = s.her.promises !== false; $('#mxAng').value = String(s.her.maxAngerHours || 12);
    paintMood(s.her_now);
    if (!fillFeel.first) { fillFeel.first = true; App.refreshHer(); if (App.pollSort) App.pollSort(); }
  }
  $('#amOn').addEventListener('change', (e) => App.saveSettings({ ambient: { enabled: e.target.checked } }));
  $('#amPlace').addEventListener('change', (e) => App.saveSettings({ ambient: { place: e.target.value.trim() || 'Sironj' } }));
  $('#slOn').addEventListener('change', (e) => App.saveSettings({ sleep: { enabled: e.target.checked } }));
  $('#slFrom').addEventListener('change', (e) => App.saveSettings({ sleep: { from: Math.floor(+e.target.value), fromMin: +e.target.value % 1 ? 30 : 0 } }));
  $('#slTo').addEventListener('change', (e) => App.saveSettings({ sleep: { to: +e.target.value } }));
  $('#sunOn').addEventListener('change', (e) => App.saveSettings({ her: { sunday: e.target.checked } }));
  $('#careSunday').addEventListener('click', async () => { try { await App.api('/api/care/run', { body: { what: 'sunday' } }); App.toast('Sent to your Telegram or phone.', 3500); } catch (e) { App.toast(e.message); } });
  $('#nkOn').addEventListener('change', (e) => App.saveSettings({ her: { nakhre: e.target.checked } }));
  $('#nkPer').addEventListener('change', (e) => App.saveSettings({ her: { nakhrePerDay: +e.target.value } }));
  $('#rcOn').addEventListener('change', (e) => App.saveSettings({ her: { react: e.target.checked } }));
  $('#prOn').addEventListener('change', (e) => App.saveSettings({ her: { promises: e.target.checked } }));
  $('#mxAng').addEventListener('change', (e) => App.saveSettings({ her: { maxAngerHours: +e.target.value } }));
  const herAct = (id, what, msg) => $(id).addEventListener('click', async () => { try { const d = await App.api('/api/her', { body: { what } }); paintMood(d.her, d.life); App.toast(msg); } catch (e) { App.toast(e.message); } });
  herAct('#hrSleep', 'sleep', 'Shh... she is asleep now.'); herAct('#hrWake', 'wake', 'She is awake.'); herAct('#hrAngry', 'angry', 'Uh oh. She is angry now.'); herAct('#hrSulky', 'sulky', 'She is sulky now. Win her over!'); herAct('#hrHappy', 'happy', 'She is happy again.'); herAct('#lifeNew', 'life', 'Her day is written.');
  $('#hrNakhre').addEventListener('click', async () => {
    const b = $('#hrNakhre'); b.disabled = true;
    try { await App.api('/api/care/run', { body: { what: 'nakhre' } }); App.toast('Sent. Do not reply and press again to see her get sadder.', 4500); if (App.refreshHer) App.refreshHer(); } catch (e) { App.toast(e.message); }
    b.disabled = false;
  });
  // keep the header chip fresh: every minute while the page is visible, and after a reply
  setInterval(() => { if (!document.hidden && App.token) App.refreshHer(); }, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && App.token) App.refreshHer(); });

  function fill(s) {
    fillCycle(s); fillFeel(s);
    $('#habOn').checked = s.habits.enabled; hh.value = s.habits.hour; if (document.activeElement !== $('#habGoal')) $('#habGoal').value = s.habits.goal; $('#teaseOn').checked = s.chat.tease !== false; $('#dayTexts').value = String(s.chat.dayTexts || 4); $('#tinyMood').value = s.tinyMood;
    $('#chBubbles').checked = s.chat.bubbles; $('#moodOn').checked = s.mood.enabled; hour.value = s.mood.hour;
    $('#missOn').checked = s.missYou.enabled; $('#missDays').value = String(s.missYou.days);
    const hs = App.status; $('#hiState').textContent = hs ? (hs.hindiVoice ? 'Hindi voice: on (real server voice).' : 'Hindi voice: using your browser voice. Add SARVAM_API_KEY or GEMINI_API_KEY for a real one (see the README).') : '';
  }
  App.hooks.onSettings = ((prev) => (s) => { if (prev) prev(s); fill(s); })(App.hooks.onSettings);
  $('#chBubbles').addEventListener('change', (e) => App.saveSettings({ chat: { bubbles: e.target.checked } }));
  $('#moodOn').addEventListener('change', (e) => App.saveSettings({ mood: { enabled: e.target.checked } }));
  hour.addEventListener('change', () => App.saveSettings({ mood: { hour: +hour.value } }));
  $('#missOn').addEventListener('change', (e) => App.saveSettings({ missYou: { enabled: e.target.checked } }));
  $('#missDays').addEventListener('change', (e) => App.saveSettings({ missYou: { days: +e.target.value } }));
  const care = (what, btn) => btn.addEventListener('click', async () => {
    btn.disabled = true;
    try { const r = await App.api('/api/care/run', { body: { what } }); const k = r[what]; App.toast(k && (k.push || k.telegram) ? 'Sent. Look at your phone or Telegram.' : 'Made it, but no phone or Telegram is connected yet. It is in the Routines chat.', 4500); if (App.refreshRecent) App.refreshRecent(); } catch (e) { App.toast(e.message); }
    btn.disabled = false;
  });
  care('mood', $('#careMood')); care('miss', $('#careMiss')); care('habit', $('#careHabit')); care('tease', $('#careTease')); care('briefing', $('#careBrief'));

  const prevV = App.hooks.onView;
  App.hooks.onView = (v) => { if (prevV) prevV(v); if (v === 'persona') { if (App.refreshStatus) App.refreshStatus().then(paintPwa); else paintPwa(); if (App.settings) fill(App.settings); } };
  paintPwa();
})();
