/* Skills bar above the message box: tap a skill, then ask. "/skill-cooking ..." works too. Her built-in skills and your own show up here. */
(function () {
  'use strict';
  const App = window.App, $ = (s, r = document) => r.querySelector(s);
  if (!App) return;
  const bar = $('#skillBar'), input = $('#input');
  let list = [], armed = '';
  // small colourful icons (theme purple and blue), one per built-in skill
  const P = '#7C3AED', L = '#A78BFA', B = '#60A5FA', T = '#B9D9DC';
  const G = {
    cooking: `<path d="M5 12h14v3a5 5 0 0 1-5 5h-4a5 5 0 0 1-5-5z" fill="${L}"/><path d="M8 12a3 3 0 0 1 1-5.6A3.2 3.2 0 0 1 15 6.4 3 3 0 0 1 16 12z" fill="${B}"/>`,
    drinks: `<path d="M6 5h12l-1.4 14a2 2 0 0 1-2 1.8H9.4a2 2 0 0 1-2-1.8z" fill="${B}"/><path d="M7 9h10" stroke="#fff" stroke-width="1.6"/><path d="M14 2l-2 6" stroke="${P}" stroke-width="1.8" stroke-linecap="round"/>`,
    dress: `<path d="M9 3l3 2 3-2 3 4-3 2v11H9V9L6 7z" fill="${P}"/><path d="M9 9h6" stroke="${T}" stroke-width="1.6"/>`,
    study: `<path d="M3 7l9-4 9 4-9 4z" fill="${P}"/><path d="M7 10v5c0 1.5 2.2 3 5 3s5-1.5 5-3v-5l-5 2.3z" fill="${L}"/>`,
    fitness: `<rect x="2.5" y="9" width="3" height="6" rx="1" fill="${P}"/><rect x="18.5" y="9" width="3" height="6" rx="1" fill="${P}"/><rect x="5.5" y="7" width="3" height="10" rx="1" fill="${L}"/><rect x="15.5" y="7" width="3" height="10" rx="1" fill="${L}"/><path d="M8.5 12h7" stroke="${B}" stroke-width="2"/>`,
    skincare: `<path d="M12 3c3.5 4 6 6.7 6 10a6 6 0 0 1-12 0c0-3.3 2.5-6 6-10z" fill="${B}"/><path d="M9.5 14a2.8 2.8 0 0 0 2.5 2.5" stroke="#fff" stroke-width="1.6" fill="none" stroke-linecap="round"/>`,
    money: `<circle cx="12" cy="12" r="9" fill="${L}"/><path d="M14.5 8.5c-.6-.8-1.5-1.1-2.5-1.1-1.4 0-2.4.7-2.4 1.8 0 2.7 5 1.4 5 4.1 0 1.2-1.1 1.9-2.6 1.9-1 0-2-.4-2.6-1.2M12 6v1.4M12 16.6V18" stroke="#fff" stroke-width="1.6" fill="none" stroke-linecap="round"/>`,
    travel: `<path d="M21 4L3 11l6.5 2.5L12 20z" fill="${B}"/><path d="M9.5 13.5L21 4" stroke="${P}" stroke-width="1.6"/>`,
    love: `<path d="M12 20s-8-4.6-8-10.2A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 8 2.2C20 15.4 12 20 12 20z" fill="${P}"/><path d="M8 10a2.5 2.5 0 0 1 2-2" stroke="${T}" stroke-width="1.5" fill="none" stroke-linecap="round"/>`,
    coding: `<rect x="3" y="4" width="18" height="16" rx="3.5" fill="${P}"/><path d="M9.5 9.5L7 12l2.5 2.5M14.5 9.5L17 12l-2.5 2.5" stroke="#fff" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
    writing: `<path d="M4 20l1-4 11-11 3 3L8 19z" fill="${B}"/><path d="M14 7l3 3" stroke="${P}" stroke-width="1.8"/><path d="M4 20l4-1-3-3z" fill="${P}"/>`,
    health: `<path d="M12 21s-8-5-8-11a4.6 4.6 0 0 1 8-3 4.6 4.6 0 0 1 8 3c0 6-8 11-8 11z" fill="${L}"/><path d="M12 9v5M9.5 11.5h5" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/>`,
    movies: `<rect x="3" y="5" width="18" height="14" rx="3" fill="${B}"/><path d="M10 9.2v5.6l5-2.8z" fill="#fff"/>`,
  };
  const dflt = `<path d="M12 2l2.4 6.2L21 9l-5 4.4L17.6 20 12 16.6 6.4 20 8 13.4 3 9l6.6-.8z" fill="${P}"/>`;
  const icon = (slug) => `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">${G[slug] || dflt}</svg>`;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function draw() {
    bar.textContent = '';
    list.forEach((s) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'sk-chip' + (armed === s.slug ? ' on' : ''); b.disabled = !!s.waiting;
      b.title = s.waiting ? s.name + ' installs in her next update' : s.name + ' (level ' + s.level + '): tap, then ask. Or type /skill-' + s.slug;
      b.innerHTML = icon(s.slug) + '<span>' + esc(s.name) + '</span>';
      b.addEventListener('click', () => { armed = armed === s.slug ? '' : s.slug; draw(); input.placeholder = armed ? 'Ask her ' + s.name + '…' : 'Message your friend…'; input.focus(); });
      bar.appendChild(b);
    });
    const add = document.createElement('button'); add.type = 'button'; add.className = 'sk-chip sk-add'; add.title = 'Add your own skill';
    add.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="${T}"/><path d="M12 7v10M7 12h10" stroke="${P}" stroke-width="2" stroke-linecap="round"/></svg><span>Add</span>`;
    add.addEventListener('click', () => { App.showView('she'); setTimeout(() => { const n = $('#skName'); if (n) { n.scrollIntoView({ block: 'center' }); n.focus(); } }, 150); });
    bar.appendChild(add);
    bar.hidden = false;
  }
  App.loadSkills = async () => { try { const d = await App.api('/api/skills'); list = d.skills || []; if (armed && !list.some((s) => s.slug === armed)) armed = ''; draw(); } catch { /* not logged in yet */ } };
  // the next message starts with /skill-name (once), unless it is already a command
  App.skillPrefix = (text) => { if (!armed || /^\//.test(text)) return text; const a = armed; armed = ''; draw(); input.placeholder = 'Message your friend…'; return '/skill-' + a + ' ' + text; };
  App.skillCmds = () => list.filter((s) => !s.waiting).map((s) => ['/skill-' + s.slug, s.name + (s.pre ? ' (built-in)' : ' (yours)')]);
  App.hooks = App.hooks || {};
  const prev = App.hooks.onSettings;
  App.hooks.onSettings = (st) => { if (prev) prev(st); App.loadSkills(); };       // settings load right after login
  window.addEventListener('focus', () => App.loadSkills());
})();
