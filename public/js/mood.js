/* Mood: one tap a day. She replies with a sticker and a soft line, and remembers it. */
(function () {
  'use strict';
  const { $, esc } = App;
  const WORDS = { 1: 'Rough', 2: 'Low', 3: 'Okay', 4: 'Good', 5: 'Great' };
  const POSE = { 1: 'cry', 2: 'cry', 3: 'smile', 4: 'cheer', 5: 'excited' };
  let picked = 0, moods = [];

  const faces = $('#moodFaces');
  [1, 2, 3, 4, 5].forEach((n) => {
    const b = document.createElement('button'); b.type = 'button'; b.dataset.n = n; b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', 'false'); b.setAttribute('aria-label', WORDS[n]);
    b.innerHTML = `<svg class="ic"><use href="#m-${n}"/></svg><span>${WORDS[n]}</span>`;
    b.addEventListener('click', () => { picked = n; [...faces.children].forEach((x) => { const on = +x.dataset.n === n; x.classList.toggle('on', on); x.setAttribute('aria-checked', on); }); $('#moodSave').disabled = false; });
    faces.appendChild(b);
  });

  const dayName = (d) => new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  const todayIST = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);

  function paint() {
    const byDay = {}; moods.forEach((m) => { (byDay[m.day] = byDay[m.day] || []).push(m); });
    const days = []; for (let i = 13; i >= 0; i--) days.push(new Date(Date.now() + 330 * 60000 - i * 86400000).toISOString().slice(0, 10));
    $('#moodChart').innerHTML = '<div class="bars">' + days.map((d) => {
      const list = byDay[d]; const last = list && list[0];
      const h = last ? last.score * 18 + 6 : 6;
      return `<div class="bar-col" title="${esc(dayName(d))}${last ? ': ' + WORDS[last.score] : ''}"><div class="bar${last ? ' s' + last.score : ''}" style="height:${h}px"></div><span>${d.slice(8)}</span></div>`;
    }).join('') + '</div>';
    $('#moodList').innerHTML = moods.slice(0, 14).map((m) => `<div class="card glass mood-row"><svg class="ic" style="width:34px;height:34px"><use href="#m-${m.score}"/></svg><div><b>${WORDS[m.score]}</b> <small>${esc(dayName(m.day))}</small>${m.note ? `<p>${esc(m.note)}</p>` : ''}</div><button class="icon-btn" data-id="${m.id}" type="button" aria-label="Delete"><svg class="ic"><use href="#i-trash"/></svg></button></div>`).join('') || '<div class="empty">Nothing yet. Tap how you feel above.</div>';
  }
  async function load() { try { moods = (await App.api('/api/moods')).moods; paint(); } catch { /* ignore */ } }

  $('#moodSave').addEventListener('click', async () => {
    if (!picked) return;
    const btn = $('#moodSave'); btn.disabled = true;
    try {
      const d = await App.api('/api/moods', { body: { score: picked, note: $('#moodNote').value } });
      $('#moodNote').value = '';
      $('#moodImg').src = App.stk(POSE[picked]); $('#moodText').textContent = d.reply; $('#moodReply').hidden = false;
      App.flashPose(POSE[picked], 5000);
      picked = 0; [...faces.children].forEach((x) => { x.classList.remove('on'); x.setAttribute('aria-checked', 'false'); });
      await load();
    } catch (e) { App.toast(e.message); btn.disabled = false; }
  });
  $('#moodList').addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-id]'); if (!b) return;
    try { await App.api('/api/moods/' + b.dataset.id, { method: 'DELETE' }); await load(); } catch (err) { App.toast(err.message); }
  });
  const prev = App.hooks.onView;
  App.hooks.onView = (v) => { if (prev) prev(v); if (v === 'mood') { load(); $('#moodReply').hidden = true; } };
})();
