// Updates page: her health, version history, checklist, parts, wishes and the bug log.
(() => {
  const App = window.App, $ = (s) => document.querySelector(s);
  if (!App || !$('#view-maint')) return;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let V = null, R = null;
  const when = (t) => new Date(t).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' });
  const LINE = { good: 'She is in good shape.', tired: 'She is getting tired. Her maintenance is due.', 'needs fixing': 'She really needs her maintenance now.' };

  async function call(body) {
    try { const d = await App.api('/api/maint', { body }); V = d.view; R = d.report; paint(); return d; }
    catch (e) { App.toast(e.message); if (e.data && e.data.left) { /* checklist still has steps */ } return null; }
  }
  async function load() { try { const d = await App.api('/api/maint'); V = d.view; R = d.report; paint(); } catch (e) { App.toast(e.message); } }

  function paint() {
    if (!V) return;
    const h = V.health;
    $('#mtImg').src = '/images/update/' + V.pose + '.webp';
    $('#mtVer').textContent = V.version;
    const st = $('#mtState'); st.textContent = h.updating ? 'Under maintenance' : h.state; st.className = 'chip';
    const bar = $('#mtBar'); bar.dataset.s = h.state; bar.setAttribute('aria-valuenow', h.health); $('#mtFill').style.width = h.health + '%';
    const next = new Date(V.nextSunday).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric', month: 'short' });
    $('#mtLine').textContent = 'Health ' + h.health + '%. ' + (h.updating ? 'She is being repaired right now and stays silent until you finish.' : h.due ? (V.sunday ? 'Her maintenance is due today.' : 'She skipped her Sunday maintenance and is overdue. ') + LINE[h.state] : 'Maintenance done this week. Next one: ' + next + '.');
    $('#mtStart').hidden = h.updating; $('#mtStart').textContent = V.sunday ? 'Start the update' : 'Start the update (Sunday only)';
    $('#mtStart').disabled = !V.sunday;
    // checklist
    const ses = V.session; $('#mtSession').hidden = !ses;
    if (ses) {
      const box = $('#mtSteps'); box.textContent = '';
      ses.steps.forEach((s) => {
        const l = document.createElement('label'); l.className = 'mt-step';
        const c = document.createElement('input'); c.type = 'checkbox'; c.checked = !!s.done;
        c.addEventListener('change', () => call({ action: 'step', k: s.k, done: c.checked }));
        const t = document.createElement('span'); t.textContent = s.label;
        l.append(c, t); box.appendChild(l);
      });
      $('#mtNotes').textContent = ses.notes.length ? 'Notes so far:\n' + ses.notes.map((n) => '• ' + n).join('\n') : 'Tell her what to change in the chat (she saves it as notes), or add wishes below.';
    }
    // report
    const ch = $('#mtChecks'); ch.textContent = '';
    (R ? R.checks : []).forEach((c) => { const d = document.createElement('div'); d.className = 'mt-check'; d.dataset.s = c.status; d.innerHTML = '<span class="dot"></span><div><b>' + esc(c.name) + '</b><small>' + esc(c.note) + '</small></div><span class="tag' + (c.status === 'needs fixing' ? ' red' : '') + '">' + esc(c.status) + '</span>'; ch.appendChild(d); });
    // parts
    const pb = $('#mtParts'); pb.textContent = '';
    V.parts.forEach((p) => {
      const d = document.createElement('div'); d.className = 'mt-part';
      d.innerHTML = '<div><b>' + esc(p.name) + '</b><small class="muted" style="display:block">' + esc(p.hint) + '</small></div><span class="mt-lv" aria-label="Level ' + p.level + '">' + Array.from({ length: 10 }, (_, i) => '<i class="' + (i < p.level ? 'on' : '') + '"></i>').join('') + '</span><button class="mini-btn" type="button" aria-label="Level up ' + esc(p.name) + '">+ level</button>';
      d.querySelector('button').addEventListener('click', () => call({ action: 'partUp', k: p.k }));
      pb.appendChild(d);
    });
    // wishes
    const wb = $('#mtWishes'); wb.textContent = '';
    if (!V.wishes.length) wb.innerHTML = '<div class="empty" style="padding:14px">No wishes yet. On Sunday she tells you what she wants.</div>';
    V.wishes.forEach((w) => {
      const d = document.createElement('div'); d.className = 'mt-item ' + w.status;
      d.innerHTML = '<div><b>' + esc(w.text) + '</b><small>' + esc(w.part === 'other' ? 'general' : w.part) + ' · ' + when(w.at) + (w.by === 'her' ? ' · her wish' : '') + '</small></div>';
      const mk = (label, status) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'mini-btn'; b.textContent = label; b.addEventListener('click', () => call({ action: 'wishStatus', id: w.id, status })); return b; };
      if (w.status === 'open') d.append(mk('Done', 'done'), mk('Not now', 'skip')); else d.append(mk('Reopen', 'open'));
      if (w.status !== 'open') d.insertAdjacentHTML('beforeend', '<span class="tag">' + (w.status === 'done' ? 'done' : 'skipped') + '</span>');
      wb.appendChild(d);
    });
    // bugs
    const bb = $('#mtBugs'); bb.textContent = '';
    if (!V.bugs.length) bb.innerHTML = '<div class="empty" style="padding:14px">No bugs. Good.</div>';
    V.bugs.forEach((b) => {
      const d = document.createElement('div'); d.className = 'mt-item ' + (b.status === 'fixed' ? 'fixed' : '');
      d.innerHTML = '<div><b>' + esc(b.text) + '</b><small>' + when(b.at) + (b.by === 'her' ? ' · she noticed it' : '') + (b.times > 1 ? ' · came back ' + (b.times - 1) + 'x' : '') + '</small></div><span class="tag' + (b.sev === 'big' || b.status === 'back' ? ' red' : '') + '">' + (b.status === 'back' ? 'came back' : b.status === 'fixed' ? 'fixed' : b.sev === 'big' ? 'big' : 'small') + '</span>';
      const x = document.createElement('button'); x.type = 'button'; x.className = 'mini-btn'; x.textContent = b.status === 'fixed' ? 'Reopen' : 'Fixed';
      x.addEventListener('click', () => call({ action: 'bugStatus', id: b.id, status: b.status === 'fixed' ? 'open' : 'fixed' }));
      d.appendChild(x); bb.appendChild(d);
    });
    // history
    const hb = $('#mtHist'); hb.textContent = '';
    if (!V.history.length) hb.innerHTML = '<div class="empty" style="padding:14px">No updates yet. The first Sunday update will appear here.</div>';
    V.history.forEach((e) => {
      const d = document.createElement('div'); d.className = 'mt-item';
      const bits = [];
      if (e.notes.length) bits.push('Changed: ' + e.notes.join('; '));
      if (e.bugsFixed.length) bits.push('Bugs fixed: ' + e.bugsFixed.join('; '));
      if (e.wishesDone.length) bits.push('Wishes done: ' + e.wishesDone.join('; '));
      d.innerHTML = '<div><b>' + esc(e.v) + ' · ' + when(e.at) + '</b><small>' + esc(bits.join('\n') || 'No notes') + '</small></div>';
      d.querySelector('small').style.whiteSpace = 'pre-line';
      hb.appendChild(d);
    });
  }

  $('#mtStart').addEventListener('click', () => call({ action: 'start' }));
  $('#mtTest').addEventListener('click', async (e) => {
    const b = e.currentTarget; b.disabled = true; b.textContent = 'Testing...';
    const d = await call({ action: 'test' });
    b.disabled = false; b.textContent = 'Run her self-test';
    if (d) App.toast(d.ok ? 'Self-test passed.' : 'Self-test found something to fix. See the health report.', 4000);
  });
  $('#mtDone').addEventListener('click', async () => { const d = await call({ action: 'complete' }); if (d) App.toast('Update complete. She is awake and in her new dress.', 4000); });
  $('#mtForce').addEventListener('click', async () => { if (!confirm('Finish without ticking every step?')) return; const d = await call({ action: 'complete', force: true }); if (d) App.toast('Update complete.', 3000); });
  const addWish = () => { const i = $('#mtWishIn'), v = i.value.trim(); if (!v) return; i.value = ''; call({ action: 'wish', text: v }); };
  $('#mtWishAdd').addEventListener('click', addWish); $('#mtWishIn').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addWish(); } });
  const addBug = () => { const i = $('#mtBugIn'), v = i.value.trim(); if (!v) return; i.value = ''; call({ action: 'bugAdd', text: v, sev: $('#mtBugBig').checked ? 'big' : 'small' }); $('#mtBugBig').checked = false; };
  $('#mtBugAdd').addEventListener('click', addBug); $('#mtBugIn').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addBug(); } });

  const orig = App.showView;
  App.showView = (v) => { orig(v); if (v === 'maint') load(); };
})();
