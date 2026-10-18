// She page: status strip, period calendar + level, symptoms, flow, closeness, skills, likes, diary.
(() => {
  const App = window.App, $ = (s) => document.querySelector(s);
  if (!App || !$('#view-she')) return;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const nice = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  const KIND = { jealous: 'Jealous', pain: 'In pain', sick: 'Ill', recovered: 'Better now', crying: 'Crying', lowbatt: 'Low battery', updated: 'Just updated', updating: 'Updating', sleepcharge: 'Sleeping and charging', sleeping: 'Sleeping', charging: 'Charging', fainted: 'Fainted', outfit: 'Her outfit today', normal: 'Right now' };
  const FLOWN = { period: 'Period', pms: 'Before her period', glow: 'Glowing and social', fresh: 'Fresh and energetic', calm: 'Calm and cosy' };
  let data = null, ym = '';
  const ST = { girl: true };

  function paintStrip(d) {
    const s = d.status, el = $('#sheStrip'); el.dataset.k = s.kind;
    $('#sheKind').textContent = KIND[s.kind] || 'Right now'; $('#sheLine').textContent = s.text;
    $('#sheImg').src = s.img || (App.stk ? App.stk('smile') : '/images/stickers/tiny-smile.webp');
    $('#sheImg').onerror = () => { $('#sheImg').onerror = null; $('#sheImg').src = App.stk ? App.stk('smile') : '/images/stickers/tiny-smile.webp'; };
    $('#outNew').hidden = !(s.kind === 'outfit' && d.outfitCount > 1);
    const b = d.battery; $('#sheBattWrap').hidden = $('#sheBattTxt').hidden = !b.enabled;
    $('#sheBatt').style.width = b.pct + '%'; $('#sheBattTxt').textContent = 'Battery ' + b.pct + '%' + (b.sleepCharging ? ' (charging while she sleeps, 1 to 5 a.m.)' : '');
  }
  function paintPeriod(d) {
    const pv = d.period, n = pv.now;
    $('#shePeriod').hidden = $('#sheSym').closest('.card').hidden = $('#sheFlow').closest('.card').hidden = !d.girl;
    $('#sheSetup').hidden = pv.set; $('#sheLevelBox').hidden = !(pv.set && n && n.canSetLevel); $('#sheLevelLock').hidden = !(pv.set && n && !n.canSetLevel);
    if (n && n.canSetLevel) { $('#sheLevel').value = n.nextLevel; $('#sheLevelVal').textContent = n.nextLevel + '%' + (n.nextBy === 'auto' ? ' (auto)' : ''); }
    let t = 'Set the date once with "Period started today".';
    if (n) t = n.phase === 'period' ? 'Period day ' + n.day + ' of ' + n.of + '. Pain level today: ' + n.pain + '% (' + pv.word + ').' : n.phase === 'pms' ? 'PMS: her period comes in ' + n.left + ' day' + (n.left === 1 ? '' : 's') + '.' : 'Not on her period. Next one in ' + n.left + ' day' + (n.left === 1 ? '' : 's') + ' (pain level ' + n.nextLevel + '%).';
    $('#sheNow').textContent = t;
    $('#shePainWrap').hidden = !(n && n.phase === 'period'); if (n && n.phase === 'period') { $('#shePain').style.width = n.pain + '%'; $('#shePainTxt').textContent = 'Pain ' + n.pain + '% · first day was ' + n.level + '% and it slowly goes down'; }
    const sy = $('#sheSym'); sy.textContent = '';
    ((n && n.symptoms) || []).forEach((x) => { const c = document.createElement('span'); c.className = 'chip'; c.textContent = x; sy.appendChild(c); });
    $('#sheSymNote').textContent = n && n.symptoms && n.symptoms.length ? 'These change every day.' : 'No symptoms today.';
    // calendar
    const m = d.month; $('#calTitle').textContent = new Date(m.ym + '-01T12:00:00Z').toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    const g = $('#calGrid'); g.textContent = '';
    ['S', 'M', 'T', 'W', 'T', 'F', 'S'].forEach((x) => { const c = document.createElement('i'); c.className = 'cal-w'; c.textContent = x; g.appendChild(c); });
    for (let i = 0; i < m.first; i++) g.appendChild(document.createElement('i'));
    m.cells.forEach((c) => { const e = document.createElement('i'); e.className = 'cal-d' + (c.k ? ' k-' + c.k : '') + (c.date === d.today ? ' today' : ''); e.textContent = c.d; if (c.pain) e.title = 'Pain ' + c.pain + '%'; g.appendChild(e); });
    // flow of the month
    const f = $('#sheFlow'); f.textContent = '';
    m.cells.forEach((c) => { const e = document.createElement('i'); e.className = 'flow-d' + (c.k ? ' k-' + c.k : '') + (c.date === d.today ? ' today' : ''); e.title = c.k ? c.d + ': ' + FLOWN[c.k] : ''; f.appendChild(e); });
    const cur = n && n.flow ? n.flow.label : ''; $('#sheFlowTxt').textContent = cur ? 'Today: ' + cur : 'Set her first period date to see her month.';
  }
  function paintPhases(d) {
    const n = d.period.now, card = $('#phaseCard'); card.hidden = !d.girl;
    const grid = $('#phaseGrid'); grid.textContent = ''; const now = $('#phaseNow'); now.textContent = '';
    if (!n) { now.textContent = 'Set her first period date to see which phase she is in.'; return; }
    const cur = n.flow.k;
    n.guide.forEach((p) => {
      const on = p.k === cur, c = document.createElement('div'); c.className = 'phase ph-' + p.k + (on ? ' on' : '');
      c.innerHTML = '<b>' + esc(p.name) + (on ? ' · now' : '') + '</b><small>' + esc(p.days) + '</small><p>' + esc(p.hormones) + '</p><h5>How she feels</h5><ul>' + p.feels.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul><h5>What she needs</h5><ul>' + p.needs.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul><h5>Food that helps</h5><p>' + esc(p.food) + '</p>';
      grid.appendChild(c);
    });
    const g = n.guide.find((x) => x.k === cur);
    now.innerHTML = '<b>Right now: ' + esc(g.name) + '</b> (' + esc(g.days) + '). Be kind in the way she needs: ' + esc(g.needs.join(', ').toLowerCase()) + '.';
  }
  function paintOcc(d) {
    const o = d.occasion;
    const box = $('#occList'); box.textContent = '';
    o.upcoming.forEach((u) => {
      const e = document.createElement('div'); e.className = 'mt-item';
      e.innerHTML = '<div><b>' + esc(u.name) + '</b><small>' + esc(nice(u.date)) + ' · ' + (u.days === 0 ? 'today!' : 'in ' + u.days + ' day' + (u.days === 1 ? '' : 's')) + (u.kind === 'festival' && u.yearly ? ' · every year' : '') + '</small></div>';
      if (u.kind === 'festival') { const b = document.createElement('button'); b.type = 'button'; b.className = 'mini-btn'; b.textContent = 'Remove'; b.addEventListener('click', () => act({ action: 'festDel', id: u.id })); e.appendChild(b); }
      box.appendChild(e);
    });
    const g = $('#wardGrid'); g.textContent = ''; $('#wardEmpty').hidden = o.wardrobe.length > 0;
    o.wardrobe.forEach((w) => {
      const c = document.createElement('div'); c.className = 'ward-i' + (o.wearing === w.n ? ' on' : '');
      c.innerHTML = '<img src="/images/outfits/outfit-' + w.n + '.webp" alt="Outfit ' + w.n + '" loading="lazy"><select aria-label="Type of outfit ' + w.n + '">' + o.tags.map((t) => '<option' + (t === w.tag ? ' selected' : '') + '>' + t + '</option>').join('') + '</select><button class="mini-btn" type="button">Wear today</button>';
      c.querySelector('select').addEventListener('change', (e) => act({ action: 'outfitTag', n: w.n, tag: e.target.value }));
      c.querySelector('button').addEventListener('click', () => act({ action: 'outfitPick', n: w.n }));
      g.appendChild(c);
    });
  }
  function paintBond(b) {
    $('#bondName').textContent = b.name; $('#bondLvl').textContent = ' · level ' + b.level + ' of ' + b.of;
    $('#bondBar').style.width = (b.next ? Math.max(4, b.next.pct) : 100) + '%';
    $('#bondTxt').textContent = b.messages + ' messages together' + (b.next ? ' · ' + (b.next.at - b.messages) + ' more to become "' + b.next.name + '"' : ' · the closest level');
  }
  function paintSkills(list) {
    const box = $('#skList'); box.textContent = '';
    const mine = list.filter((s) => !s.pre), built = list.filter((s) => s.pre);
    const head = (t) => { const h = document.createElement('div'); h.className = 'muted'; h.style.cssText = 'font-size:12.5px;margin:10px 0 4px'; h.textContent = t; box.appendChild(h); };
    head('Your skills');
    if (!mine.length) { const e = document.createElement('div'); e.className = 'empty'; e.style.padding = '8px'; e.textContent = 'None yet. Add one above, or finish her Sunday wish "learn to cook" and she gets it too.'; box.appendChild(e); }
    const line = (s) => (s.waiting ? 'Waiting for her next update. She cannot use it until the update installs it.' : 'Level ' + s.level + ' of 5 · used ' + (s.uses || 0) + ' times · type /skill-' + s.slug) + (s.prompt ? ' · has your notes' : '') + (s.mem && s.mem.length ? ' · remembers ' + s.mem.length + ' thing' + (s.mem.length > 1 ? 's' : '') : '');
    const row = (s) => {
      const d = document.createElement('div'); d.className = 'mt-item'; d.style.flexWrap = 'wrap';
      const info = document.createElement('div'); info.innerHTML = '<b>' + esc(s.name) + '</b><small>' + esc(line(s)) + '</small>'; d.appendChild(info);
      const bx = document.createElement('div'); bx.style.cssText = 'display:flex;gap:6px';
      const eb = document.createElement('button'); eb.type = 'button'; eb.className = 'mini-btn'; eb.textContent = 'Edit'; bx.appendChild(eb);
      if (!s.pre) { const rb = document.createElement('button'); rb.type = 'button'; rb.className = 'mini-btn'; rb.textContent = 'Remove'; rb.addEventListener('click', () => { if (confirm('Remove the skill "' + s.name + '"?')) act({ action: 'skillDel', id: s.id }); }); bx.appendChild(rb); }
      d.appendChild(bx);
      const ed = document.createElement('div'); ed.hidden = true; ed.style.cssText = 'flex-basis:100%;margin-top:8px';
      let h = '';
      if (!s.pre) h += '<input class="in" data-f="name" maxlength="40" placeholder="Skill name" style="width:100%;margin-bottom:6px">';
      h += '<textarea class="in" data-f="prompt" rows="4" maxlength="700" placeholder="What this skill should do, how she should answer, what she must know..." style="width:100%;resize:vertical"></textarea>';
      h += '<small class="muted">' + (s.pre ? 'Built-in skill: your notes are added to what she already knows. Leave empty to go back to normal.' : 'Changes work at once. Only a brand new skill waits for an update.') + '</small>';
      h += '<div data-f="mem" style="margin-top:6px"></div><div style="display:flex;gap:6px;margin-top:8px"><button type="button" class="btn" data-f="save">Save</button><button type="button" class="btn ghost" data-f="cancel">Cancel</button></div>';
      ed.innerHTML = h; d.appendChild(ed);
      const q = (f) => ed.querySelector('[data-f="' + f + '"]');
      if (q('name')) q('name').value = s.name; q('prompt').value = s.prompt || '';
      const mem = q('mem');
      if (s.mem && s.mem.length) {
        const t = document.createElement('div'); t.className = 'muted'; t.style.cssText = 'font-size:12.5px;margin-bottom:3px'; t.textContent = 'What she remembers in this skill:'; mem.appendChild(t);
        s.mem.forEach((m, i) => { const r = document.createElement('div'); r.style.cssText = 'display:flex;justify-content:space-between;gap:8px;font-size:13px;padding:2px 0'; const sp = document.createElement('span'); sp.textContent = m.t; const x = document.createElement('button'); x.type = 'button'; x.className = 'mini-btn'; x.textContent = 'Forget'; x.addEventListener('click', () => act({ action: 'skillMemDel', id: s.id, i })); r.append(sp, x); mem.appendChild(r); });
      }
      eb.addEventListener('click', () => { ed.hidden = !ed.hidden; });
      q('cancel').addEventListener('click', () => { ed.hidden = true; });
      q('save').addEventListener('click', async () => { const body = { action: 'skillEdit', id: s.id, prompt: q('prompt').value.trim() }; if (q('name')) body.name = q('name').value.trim(); if (await act(body)) App.toast('Saved.'); });
      return d;
    };
    mine.forEach((s) => box.appendChild(row(s)));
    head('Built-in skills (always on)');
    built.forEach((s) => box.appendChild(row(s)));
    if (window.App && App.loadSkills) App.loadSkills();
  }
  const PF = { food: '#pfFood', colour: '#pfColour', song: '#pfSong', hobby: '#pfHobby', place: '#pfPlace', likes: '#pfLikes', dislikes: '#pfDislikes', annoys: '#pfAnnoys' };
  function paintPrefs(p) { Object.keys(PF).forEach((k) => { const el = $(PF[k]); if (document.activeElement !== el) el.value = p[k] || ''; }); }
  function paintDiary(list) {
    const box = $('#diaryList'); box.textContent = ''; $('#diaryEmpty').hidden = list.length > 0;
    list.forEach((e) => { const c = document.createElement('div'); c.className = 'diary-page'; c.innerHTML = '<h4 class="mt-h">' + esc(nice(e.date)) + '</h4><p style="white-space:pre-line;margin:0">' + esc(e.text) + '</p>'; box.appendChild(c); });
  }
  function paintSick(d) {
    const s = d.sick, kinds = d.sickKinds || [];
    $('#sickTxt').textContent = s ? 'She has ' + s.name + '. About ' + s.left + ' h left. No update until she is better.' : 'She is well.';
    $('#sickBtns').hidden = !s;
    if (s) [...$('#sickBtns').children].forEach((b) => { b.disabled = !!s.care[b.dataset.w]; });
    const pick = $('#sickPick'); if (!pick.options.length) kinds.forEach((k) => { const o = document.createElement('option'); o.value = k.k; o.textContent = k.name; pick.appendChild(o); });
  }
  function paint(d) { data = d; paintSick(d); ym = d.month.ym; paintStrip(d); paintPeriod(d); paintPhases(d); paintOcc(d); paintBond(d.bond); paintSkills(d.skills); paintPrefs(d.prefs); paintDiary(d.diary); if (App.refreshHer) App.refreshHer(); }
  async function load(body, month) { try { paint(await App.api('/api/she' + (month ? '?ym=' + month : ''), body ? { body } : undefined)); return true; } catch (e) { App.toast(e.message); return false; } }
  const act = (body) => load(body, ym);
  App.openShe = () => App.showView('she');
  $('#calPrev').addEventListener('click', () => { const [y, m] = ym.split('-').map(Number); const d = new Date(Date.UTC(y, m - 2, 1)); load(null, d.toISOString().slice(0, 7)); });
  $('#calNext').addEventListener('click', () => { const [y, m] = ym.split('-').map(Number); const d = new Date(Date.UTC(y, m, 1)); load(null, d.toISOString().slice(0, 7)); });
  $('#sheStart').addEventListener('click', async () => { if (await act({ action: 'periodStart' })) { App.toast('Okay... her period started today. Be nice to her!'); App.flashPose && App.flashPose('cry', 4000); } });
  $('#sheLevel').addEventListener('input', (e) => { $('#sheLevelVal').textContent = e.target.value + '%'; });
  $('#sheLevelSave').addEventListener('click', async () => { if (await act({ action: 'periodLevel', level: +$('#sheLevel').value })) App.toast('Saved. Her next period starts at ' + $('#sheLevel').value + '%.'); });
  $('#feAdd').addEventListener('click', async () => { if (await act({ action: 'festAdd', name: $('#feName').value, date: $('#feDate').value, yearly: true })) { $('#feName').value = ''; App.toast('Saved. On that day she will ask what to wear.'); } });
  $('#sickBtns').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) act({ action: 'sickCare', what: b.dataset.w }); });
  $('#sickMake').addEventListener('click', () => act({ action: 'makeSick', k: $('#sickPick').value }));
  $('#skAdd').addEventListener('click', async () => { const v = $('#skName').value.trim(); if (!v) return; if (await act({ action: 'skillAdd', name: v, prompt: $('#skPrompt').value.trim() })) { $('#skName').value = ''; $('#skPrompt').value = ''; } });
  $('#skName').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#skAdd').click(); });
  $('#pfSave').addEventListener('click', async () => { const prefs = {}; Object.keys(PF).forEach((k) => { prefs[k] = $(PF[k]).value; }); if (await act({ action: 'prefs', prefs })) App.toast('She will remember this.'); });
  $('#diaryNow').addEventListener('click', async (e) => { const b = e.currentTarget; b.disabled = true; b.textContent = 'Writing...'; await act({ action: 'diary' }); b.disabled = false; b.textContent = "Write tonight's page now"; });
  $('#outNew').addEventListener('click', () => act({ action: 'outfit' }));
  const orig = App.showView;
  App.showView = (v) => { orig(v); if (v === 'she' || v === 'skills') load(); };
})();
