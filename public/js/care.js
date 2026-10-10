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
  function fill(s) {
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
  care('mood', $('#careMood')); care('miss', $('#careMiss'));

  const prevV = App.hooks.onView;
  App.hooks.onView = (v) => { if (prevV) prevV(v); if (v === 'persona') { if (App.refreshStatus) App.refreshStatus().then(paintPwa); else paintPwa(); if (App.settings) fill(App.settings); } };
  paintPwa();
})();
