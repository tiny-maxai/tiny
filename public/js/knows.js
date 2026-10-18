// "What she knows about you": her memories grouped by topic, with Forget on every line.
(() => {
  const App = window.App, $ = (s) => document.querySelector(s);
  if (!App || !$('#view-knows')) return;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  async function load() {
    const box = $('#knowsBox');
    let d; try { d = await App.api('/api/knows'); } catch (e) { App.toast(e.message); return; }
    box.textContent = '';
    if (!d.groups.length) { box.innerHTML = '<div class="empty">She does not know much yet. Talk to her a little and this page fills up.</div>'; return; }
    const sum = document.createElement('p'); sum.className = 'muted'; sum.textContent = d.total + ' things she remembers about you.'; box.appendChild(sum);
    d.groups.forEach((g) => {
      const card = document.createElement('div'); card.className = 'card glass kn-g';
      const h = document.createElement('h3'); h.className = 'mt-h'; h.textContent = g.title + ' (' + g.items.length + ')'; card.appendChild(h);
      g.items.forEach((it) => {
        const row = document.createElement('div'); row.className = 'kn-row';
        const t = document.createElement('span'); t.innerHTML = esc(it.text) + (it.pinned ? ' <small class="muted">· pinned</small>' : '');
        const b = document.createElement('button'); b.type = 'button'; b.className = 'mini-btn'; b.textContent = 'Forget';
        b.addEventListener('click', async () => {
          b.disabled = true;
          try {
            if (it.kind === 'mem') await App.api('/api/memories/' + it.id, { method: 'DELETE' });
            else await App.api('/api/she', { body: { action: 'skillMemDel', id: it.sid, i: it.i } });
            row.remove(); if (App.refreshStatus) App.refreshStatus();
          } catch (e) { b.disabled = false; App.toast(e.message); }
        });
        row.append(t, b); card.appendChild(row);
      });
      box.appendChild(card);
    });
  }
  const orig = App.showView;
  App.showView = (v) => { orig(v); if (v === 'knows') load(); };
})();
