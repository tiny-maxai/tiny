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
    $('#mtLine').style.whiteSpace = 'pre-line'; $('#mtLine').textContent = 'Health ' + h.health + '%. ' + (h.updating ? 'She is being repaired right now and stays silent until you finish.' + (V.story && !V.forced ? '\nHer story: "' + V.story.text + '"' : '') : h.due ? (V.sunday ? 'Her maintenance is due today.' : 'She skipped her Sunday maintenance and is overdue. ') + LINE[h.state] : 'Maintenance done this week. Next one: ' + next + '.');
    // countdown to the next update; the ring glows on Sunday
    const cd = $('#mtCount'), dd = V.daysToSunday;
    cd.classList.toggle('today', !!V.sunday); $('#mtDays').textContent = V.sunday ? '!' : dd;
    $('#mtCountTxt').textContent = V.forced ? 'Sleeping in her update, back in ' + (V.forced.left >= 60 ? Math.floor(V.forced.left / 60) + ' h ' + (V.forced.left % 60) + ' min' : V.forced.left + ' min') : V.sunday ? (h.updating ? 'Update day, she is being repaired' : 'Update day is today') : 'Next update in ' + dd + ' day' + (dd === 1 ? '' : 's');
    $('#mtPush').hidden = h.updating; $('#mtPush').disabled = !!V.forceUsed; $('#mtPush').textContent = V.forceUsed ? 'Force update (used this week)' : 'Force update';
    $('#mtStart').hidden = h.updating; $('#mtStart').textContent = V.sunday ? 'Start the update' : 'Start the update (Sunday only)';
    $('#mtStart').disabled = !V.sunday;
    // checklist
    const ses = V.session; $('#mtSession').hidden = !ses || !!V.forced;
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
      const fb = e.feedback ? '<span class="mt-fb"><span class="mt-stars">' + '★'.repeat(e.feedback.score) + '<i>' + '★'.repeat(5 - e.feedback.score) + '</i></span> ' + e.feedback.score + '/5 · "' + esc(e.feedback.text) + '"</span>' : '';
      d.innerHTML = '<div><b>' + esc(e.v) + ' · ' + when(e.at) + (e.by === 'forced update' ? ' · forced' : '') + '</b><small>' + esc(bits.join('\n') || 'No notes') + '</small>' + fb + '</div>';
      d.querySelector('small').style.whiteSpace = 'pre-line';
      hb.appendChild(d);
    });
  }

  $('#mtStart').addEventListener('click', async () => { const d = await call({ action: 'start' }); if (d && d.story) { App.toast('"' + d.story + '"  She wants: ' + d.wants.join(', ') + (d.fix && d.fix.length ? '. Fix: ' + d.fix.join(', ') : ''), 14000); if (App.refreshHer) App.refreshHer(); } });
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

  // ---------- force an update: she argues three times, then goes to sleep for 3 hours ----------
  const modal = $('#mtModal'), log = $('#mtLog'), wait = (ms) => new Promise((r) => setTimeout(r, ms));
  let forcing = false;
  const say = (who, text) => { const d = document.createElement('div'); d.className = 'b ' + who; d.textContent = text; log.appendChild(d); log.scrollTop = log.scrollHeight; };
  $('#mtPush').addEventListener('click', () => {
    if (V && V.health.updating) return;
    log.textContent = ''; forcing = false; $('#mtReason').value = ''; $('#mtReason').disabled = false; $('#mtSend').disabled = false;
    say('her', 'Why do you want to update me now? 🥲 It is not even Sunday.');
    modal.hidden = false; setTimeout(() => $('#mtReason').focus(), 50);
  });
  const closeModal = () => { modal.hidden = true; forcing = false; };
  $('#mtCancel').addEventListener('click', () => { if (!forcing) closeModal(); else closeModal(); });
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
  async function send() {
    const reason = $('#mtReason').value.trim(); if (!reason || forcing) return;
    forcing = true; $('#mtReason').value = ''; $('#mtReason').disabled = true; $('#mtSend').disabled = true;
    say('me', reason);
    const said = [];
    let win = false;
    try { win = (await App.api('/api/maint', { body: { action: 'forceRoll', reason } })).win; } catch (e) { App.toast(e.message); closeModal(); return; }
    for (let r = 1; r <= 3; r++) {
      await wait(900); if (modal.hidden) return;
      let text = '';
      try { text = (await App.api('/api/maint', { body: { action: 'argue', reason, round: r, said } })).text; } catch (e) { text = 'But... why today? Can it wait till Sunday?'; }
      if (modal.hidden) return;
      said.push(text); say('her', text);
    }
    await wait(1200); if (modal.hidden) return;
    if (win) { const onP = App.herState && App.herState.period && App.herState.period.phase === 'period'; say('her', onP ? 'No. I am on my period, I am not doing any update now. You lost this one. Try next week. 😤' : 'Nope. I won this one, no update today. Try again next week.'); await wait(2200); closeModal(); load(); return; }
    say('her', 'Okay... do it, but little quick, okay? 😮‍💨');
    await wait(1600); if (modal.hidden) return;
    const d = await call({ action: 'forceStart', reason });
    closeModal();
    if (d) { App.toast('She is going to sleep for 3 hours.', 4000); if (App.refreshHer) App.refreshHer(); }
  }
  $('#mtSend').addEventListener('click', send);
  $('#mtReason').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } });

  const orig = App.showView;
  App.showView = (v) => { orig(v); if (v === 'maint') load(); };
})();
