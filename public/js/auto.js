// Automation page: goals she does by herself at a set time.
(() => {
  const App = window.App, $ = (s) => document.querySelector(s);
  if (!App || !$('#view-auto')) return;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const REP = { daily: 'Every day', weekdays: 'Weekdays', weekends: 'Weekends', monthly: 'Every month', once: 'One time' }, OUT = { text: 'text', html: 'HTML page', pdf: 'PDF', docx: 'Word file', xlsx: 'Excel file', csv: 'CSV', md: 'Markdown' };
  let items = [], editing = null;
  const hhmm = (t) => { const [h, m] = t.split(':').map(Number); return ((h + 11) % 12 + 1) + ':' + String(m).padStart(2, '0') + ' ' + (h < 12 ? 'am' : 'pm'); };
  for (let d = 1; d <= 31; d++) { const o = document.createElement('option'); o.value = d; o.textContent = d; $('#auDay').appendChild(o); }
  { const d = $('#auDay'); for (let i = 1; i <= 31; i++) { const o = document.createElement('option'); o.value = i; o.textContent = i + (i === 1 ? 'st' : i === 2 ? 'nd' : i === 3 ? 'rd' : 'th'); d.appendChild(o); } }
  const toggleRep = () => { const r = $('#auRepeat').value; $('#auDayBox').hidden = r !== 'monthly'; $('#auDateBox').hidden = r !== 'once'; if (r === 'once' && !$('#auDate').value) $('#auDate').value = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10); };
  $('#auRepeat').addEventListener('change', toggleRep);
  const when = (a) => a.repeat === 'monthly' ? 'Every month on the ' + a.day + (a.day === 1 ? 'st' : a.day === 2 ? 'nd' : a.day === 3 ? 'rd' : 'th') : a.repeat === 'once' ? 'Once on ' + a.date : REP[a.repeat];
  const toggleGroup = () => { $('#auGroupBox').hidden = $('#auTarget').value !== 'group'; };
  $('#auTarget').addEventListener('change', toggleGroup);

  async function load() { try { items = (await App.api('/api/auto')).items; paint(); } catch (e) { App.toast(e.message); } }
  async function act(body) { try { const d = await App.api('/api/auto', { body }); items = d.items; paint(); return d; } catch (e) { App.toast(e.message); return null; } }
  function reset() { editing = null; ['#auName', '#auGoal', '#auGroup'].forEach((q) => { $(q).value = ''; }); $('#auTime').value = '08:00'; $('#auRepeat').value = 'daily'; $('#auDate').value = ''; $('#auDay').value = '1'; toggleRep(); $('#auTarget').value = 'me'; $('#auOut').value = 'text'; $('#auSave').textContent = 'Save automation'; $('#auCancel').hidden = true; toggleGroup(); }
  function paint() {
    const box = $('#auList'); box.textContent = '';
    if (!items.length) { box.innerHTML = '<div class="empty" style="padding:14px">Nothing yet. Add your first goal above.</div>'; return; }
    items.forEach((a) => {
      const d = document.createElement('div'); d.className = 'mt-item' + (a.enabled ? '' : ' fixed');
      const where = a.target === 'group' ? 'Group ' + esc(a.groupLabel || a.group) : 'Me';
      d.innerHTML = '<div><b>' + esc(a.name) + '</b><small>' + REP[a.repeat] + (a.repeat === 'monthly' ? ' (day ' + a.day + ')' : a.repeat === 'once' ? ' (' + a.date + ')' : '') + ' at ' + hhmm(a.time) + ' · ' + where + ' · ' + OUT[a.output] + (a.enabled ? '' : ' · paused') + '\n' + esc(a.goal) + (a.lastResult ? '\nLast: ' + esc(a.lastResult.slice(0, 160)) : '') + '</small></div>';
      d.querySelector('small').style.whiteSpace = 'pre-line';
      const mk = (label, fn) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'mini-btn'; b.textContent = label; b.addEventListener('click', fn); d.appendChild(b); };
      mk('Send now', async (e) => { const b = e.currentTarget; b.disabled = true; b.textContent = 'Sending...'; const r = await act({ action: 'run', id: a.id }); if (r) App.toast(r.result, 5000); });
      mk('Edit', () => { editing = a.id; $('#auName').value = a.name; $('#auGoal').value = a.goal; $('#auTime').value = a.time; $('#auRepeat').value = a.repeat; $('#auDay').value = String(a.day || 1); $('#auDate').value = a.date || ''; toggleRep(); $('#auTarget').value = a.target; $('#auOut').value = a.output; $('#auGroup').value = a.groupLabel || a.group || ''; $('#auSave').textContent = 'Save changes'; $('#auCancel').hidden = false; toggleGroup(); $('#auGoal').scrollIntoView({ behavior: 'smooth', block: 'center' }); });
      mk(a.enabled ? 'Pause' : 'Resume', () => act({ action: 'toggle', id: a.id }));
      mk('Delete', () => { if (confirm('Delete this automation?')) act({ action: 'delete', id: a.id }); });
      box.appendChild(d);
    });
  }
  $('#auSave').addEventListener('click', async () => {
    const body = { id: editing || undefined, name: $('#auName').value, goal: $('#auGoal').value, time: $('#auTime').value, repeat: $('#auRepeat').value, day: $('#auDay').value, date: $('#auDate').value, target: $('#auTarget').value, output: $('#auOut').value, group: $('#auGroup').value };
    const old = editing && items.find((x) => x.id === editing); if (old) body.enabled = old.enabled;
    const d = await act(body); if (d) { App.toast('Saved. She will do it at ' + hhmm($('#auTime').value) + '.', 3500); reset(); }
  });
  $('#auCancel').addEventListener('click', reset);
  const orig = App.showView;
  App.showView = (v) => { orig(v); if (v === 'auto') load(); };
  toggleGroup(); toggleRep();
})();
