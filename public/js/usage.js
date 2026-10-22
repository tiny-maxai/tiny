/* Settings: the free-limits meter and the Sarvam Hindi voice key. */
(function () {
  'use strict';
  const { $, esc } = App;
  const bar = (pct) => '<div class="us-bar"><i style="width:' + Math.max(2, pct || 0) + '%" class="' + (pct >= 80 ? 'hot' : pct >= 50 ? 'mid' : '') + '"></i></div>';
  const num = (n) => Number(n || 0).toLocaleString('en-IN');
  async function loadUsage() {
    const box = $('#usBody'); if (!box) return;
    try {
      const d = await App.api('/api/usage');
      let h = d.items.filter((x) => x.k !== 'kv:list' || x.used).map((x) => '<div class="us-row"><div><b>' + esc(x.label) + '</b><span>' + num(x.used) + ' of ' + num(x.limit) + ' (' + x.pct + '%)</span></div>' + bar(x.pct) + (x.note && x.pct >= 30 ? '<small class="muted">' + esc(x.note) + '</small>' : '') + '</div>').join('');
      h += '<div class="us-row"><div><b>Groq</b><span>' + num(d.groq.calls) + ' calls today</span></div>' + (d.groq.models.length ? d.groq.models.map((m) => '<div class="us-sub"><span>' + esc(m.model) + '</span><span>' + num(m.left) + ' of ' + num(m.limit) + ' left</span></div>' + bar(m.pct)).join('') : '<small class="muted">Numbers appear after her next reply.</small>') + '</div>';
      h += '<div class="us-row"><div><b>Workers AI</b><span>' + num(d.ai.calls) + ' calls today</span></div>' + d.ai.models.map((m) => '<div class="us-sub"><span>' + esc(m.model) + '</span><span>' + num(m.calls) + '</span></div>').join('') + '<small class="muted">' + esc(d.ai.note) + '</small></div>';
      box.innerHTML = h;
    } catch (e) { box.innerHTML = '<p class="muted">Could not load: ' + esc(e.message) + '</p>'; }
  }
  $('#usRefresh').addEventListener('click', loadUsage);
  document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('[data-view="persona"]')) { loadUsage(); loadKey(); } });

  async function loadKey() {
    try { const d = await App.api('/api/voice/sarvam'); const own = !d.viaEnv; ['#srKey', '#srSave', '#srClear'].forEach((q) => { const el = $(q); if (el) el.hidden = !own; }); $('#srState').textContent = d.set ? (d.viaEnv ? 'Your Sarvam key is set in Cloudflare, so nothing to paste here. Hindi uses it. Press Test to hear it.' : 'A key is saved. Hindi uses it. Press Test to hear it.') : 'No key yet. Get a free one at dashboard.sarvam.ai, paste it here, Save, then Test.'; } catch (e) { /* offline */ }
  }
  $('#srSave').addEventListener('click', async () => {
    const k = $('#srKey').value.trim(); if (!k) return App.toast('Paste the key first.');
    try { await App.api('/api/voice/sarvam', { body: { key: k } }); $('#srKey').value = ''; App.toast('Saved. Press Test Hindi voice.'); loadKey(); } catch (e) { App.toast(e.message); }
  });
  $('#srClear').addEventListener('click', async () => { try { await App.api('/api/voice/sarvam', { body: { clear: true } }); App.toast('Key removed.'); loadKey(); } catch (e) { App.toast(e.message); } });
  $('#srTest').addEventListener('click', async () => {
    const b = $('#srTest'); b.disabled = true; b.textContent = 'Testing...';
    try {
      const r = await App.api('/api/voice/sarvam/test', { raw: true, body: {} });
      if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || 'Sarvam did not work.'); }
      const url = URL.createObjectURL(await r.blob()); const a = new Audio(url); a.onended = () => URL.revokeObjectURL(url); await a.play();
      App.toast('Sarvam works. This is her Hindi voice.', 4000);
    } catch (e) { App.toast(e.message, 9000); }
    b.disabled = false; b.textContent = 'Test Hindi voice';
  });
})();
