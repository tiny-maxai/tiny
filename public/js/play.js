/* Play: six games for two (you and her). Scores are saved in D1. */
(function () {
  'use strict';
  const { $, $$, esc, icon } = App;
  const GAMES = [
    { id: 'ttt', icon: 'g-ttt', name: 'Tic-Tac-Toe', blurb: 'Classic X and O. Easy mode is gentle, hard mode never loses.' },
    { id: 'rps', icon: 'g-rps', name: 'Rock Paper Scissors', blurb: 'Fast rounds. See if you can read her mind.' },
    { id: 'wordchain', icon: 'g-word', name: 'Word Chain', blurb: 'Each word starts with the last letter of the one before.' },
    { id: 'twenty', icon: 'g-twenty', name: '20 Questions', blurb: 'She thinks of something. You get 20 yes or no questions.' },
    { id: 'truthdare', icon: 'g-truth', name: 'Truth or Dare', blurb: 'Friendly, funny and safe. She plays too.' },
    { id: 'trivia', icon: 'g-trivia', name: 'Trivia Battle', blurb: 'Five quick questions on any topic you pick.' },
    { id: 'scramble', icon: 'g-scramble', name: 'Word Scramble', blurb: 'Unjumble the letters. Five words, three tries each.' },
    { id: 'hangman', icon: 'g-hangman', name: 'Hangman', blurb: 'Guess the hidden word before you run out of lives.' },
  ];
  const home = $('#playHome'), stage = $('#stage'), grid = $('#gameGrid');
  let scores = {}, active = null, streak = 0, best = 0;

  GAMES.forEach((g) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'game-card glass';
    b.innerHTML = `<div class="gi">${icon(g.icon)}</div><b>${g.name}</b><span>${g.blurb}</span>`;
    b.addEventListener('click', () => open(g.id));
    grid.appendChild(b);
  });

  async function loadScores() {
    try { const d = await App.api('/api/scores'); scores = {}; d.scores.forEach((s) => { (scores[s.game] = scores[s.game] || {})[s.outcome] = s.n; }); } catch { /* ignore */ }
  }
  async function record(game, outcome, detail) {
    (scores[game] = scores[game] || {})[outcome] = ((scores[game] || {})[outcome] || 0) + 1;
    paintScore(); paintHome(); react(outcome, detail);
    try { await App.api('/api/scores', { body: { game, outcome, detail } }); } catch { /* ignore */ }
  }
  function paintScore() {
    const el = $('#scoreBar'); if (!el || !active) return;
    const s = scores[active] || {};
    el.innerHTML = `<span class="chip">Wins <b>${s.win || 0}</b></span><span class="chip">Losses <b>${s.loss || 0}</b></span>` + (active === 'ttt' || active === 'rps' ? `<span class="chip">Draws <b>${s.draw || 0}</b></span>` : '') + (s.done ? `<span class="chip">Played <b>${s.done}</b></span>` : '');
  }
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  // Points: win 3, draw 1. Shown on the Play home.
  function paintHome() {
    const el = $('#scoreHome'); if (!el) return;
    let w = 0, l = 0, d = 0; Object.values(scores).forEach((s) => { w += s.win || 0; l += s.loss || 0; d += s.draw || 0; });
    best = Math.max(best, streak);
    el.innerHTML = `<span class="chip">Points <b>${w * 3 + d}</b></span><span class="chip">Wins <b>${w}</b></span><span class="chip">${esc(name())} won <b>${l}</b></span><span class="chip">Draws <b>${d}</b></span><span class="chip">Win streak <b>${streak}</b></span>`;
  }
  // Her reaction after every result: a sticker and a line, like a real friend.
  function react(outcome, detail) {
    const box = $('#gReact'); if (!box || !active) return;
    let pose, title, line;
    const m = /^(\d+)\/(\d+)$/.exec(detail || '');
    if (outcome === 'win') streak++; else if (outcome === 'loss') streak = 0;
    if (outcome === 'win') {
      if (streak >= 3) { pose = 'cheer'; title = streak + ' wins in a row!'; line = pick(['Okay okay, you are on fire today... I need a rematch!', 'Wait, again?! Fine, you are officially scary good.']); }
      else { pose = 'cry'; title = 'You won!'; line = pick(['Noooo, you beat me?! Hmm, okay... well played.', 'Aww man, fine, you win this one. Rematch?', 'Hmm, I let you win. Totally. Maybe.']); }
    } else if (outcome === 'loss') { pose = 'excited'; title = pick(['I won!', 'Mine!']); line = pick(['Yayyy! Hehe, do not be sad, try again?', 'Ohh that was close... one more round?', 'Haha okay okay, I got lucky. Want revenge?']); }
    else if (outcome === 'draw') { pose = 'smile'; title = 'A draw'; line = pick(['Hmm, a draw. We think exactly alike!', 'Okay, nobody wins. Again?']); }
    else return;
    if (m) { const pct = +m[1] / +m[2] * 100; pose = pct >= 80 ? 'cheer' : pct >= 50 ? 'smile' : 'cry'; title = `${m[1]} out of ${m[2]}`; line = pct >= 80 ? 'Whoa, ' + pick(['you are so smart!', 'amazing, I am impressed!']) : pct >= 60 ? 'Nice one! You got me this time.' : 'Aww, I win this round... want a rematch?'; }
    const girl = App.settings.persona.gender !== 'boy';
    let src = App.stk(pose);
    if (m && girl) { const pct = +m[1] / +m[2] * 100; src = '/images/stickers/tiny-score-' + (pct < 30 ? '0-30' : pct < 50 ? '30-50' : pct < 70 ? '50-70' : pct < 90 ? '70-90' : '90-100') + '.webp'; }
    box.innerHTML = `<img src="${src}" alt=""><div><b>${esc(title)}</b><p>${esc(line)}</p></div>`; box.hidden = false;
    box.classList.remove('pop'); void box.offsetWidth; box.classList.add('pop');
    App.flashPose(pose, 4000);
  }
  const name = () => App.settings.persona.name;

  function open(id) {
    active = id; const g = GAMES.find((x) => x.id === id);
    home.hidden = true; stage.hidden = false; stage.style.display = 'flex';
    stage.innerHTML = `<div class="stage-top"><button class="icon-btn" id="gBack" type="button" aria-label="Back to games">${icon('i-back')}</button><h2>${g.name}</h2></div><div class="score" id="scoreBar"></div><div class="react glass" id="gReact" hidden aria-live="polite"></div><div id="gBody" style="display:flex;flex-direction:column;gap:14px;flex:1;min-height:0"></div>`;
    $('#gBack').addEventListener('click', close);
    paintScore();
    ({ ttt, rps, wordchain: aiChat, twenty: aiChat, truthdare: aiChat, trivia, scramble, hangman })[id](id);
    App.flashPose('excited', 2500);
  }
  function close() { active = null; stage.hidden = true; stage.style.display = 'none'; stage.innerHTML = ''; home.hidden = false; App.restPose(); }
  App.hooks.onView0 = null;
  const prevView = App.hooks.onView;
  App.hooks.onView = (v) => { if (prevView) prevView(v); if (v === 'play') { loadScores().then(() => { paintScore(); paintHome(); }); if (!active) { home.hidden = false; stage.hidden = true; stage.style.display = 'none'; } } };
  stage.style.display = 'none';

  // ---------- Tic-Tac-Toe ----------
  function ttt() {
    const body = $('#gBody');
    let level = 'hard', b, turn, over;
    body.innerHTML = `<div class="seg" id="lvl" style="justify-content:center"><button data-v="easy">Easy</button><button data-v="hard" class="on">Hard</button></div><div class="msg-line" id="gMsg"></div><div class="board" id="board"></div><div style="text-align:center"><button class="btn ghost" id="again" type="button">New game</button></div>`;
    const WIN = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
    const winner = (bd) => { for (const l of WIN) if (bd[l[0]] && bd[l[0]] === bd[l[1]] && bd[l[1]] === bd[l[2]]) return { p: bd[l[0]], l }; return null; };
    const full = (bd) => bd.every(Boolean);
    function minimax(bd, me, isMe, depth) {
      const w = winner(bd); if (w) return w.p === me ? 10 - depth : depth - 10; if (full(bd)) return 0;
      let best = isMe ? -99 : 99;
      for (let i = 0; i < 9; i++) if (!bd[i]) { bd[i] = isMe ? me : (me === 'O' ? 'X' : 'O'); const s = minimax(bd, me, !isMe, depth + 1); bd[i] = null; best = isMe ? Math.max(best, s) : Math.min(best, s); }
      return best;
    }
    function aiMove() {
      const empty = b.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0);
      if (level === 'easy' && Math.random() < 0.7) return pick(empty);
      let best = -99, mv = empty[0];
      for (const i of empty) { b[i] = 'O'; const s = minimax(b, 'O', false, 1); b[i] = null; if (s > best || (s === best && Math.random() < 0.3)) { best = s; mv = i; } }
      return mv;
    }
    function draw() {
      const w = winner(b), el = $('#board'); el.innerHTML = '';
      b.forEach((v, i) => { const c = document.createElement('button'); c.type = 'button'; c.className = 'cell' + (v ? ' ' + v.toLowerCase() : '') + (w && w.l.includes(i) ? ' win' : ''); c.textContent = v || ''; c.disabled = !!v || over; c.setAttribute('aria-label', 'Square ' + (i + 1) + (v ? ', ' + v : '')); c.addEventListener('click', () => play(i)); el.appendChild(c); });
    }
    function end(res) {
      over = true; draw();
      if (res === 'X') { $('#gMsg').textContent = pick([`You got me! Nice one.`, `Okay okay, you win this round.`]); App.flashPose('cry', 3500); record('ttt', 'win'); }
      else if (res === 'O') { $('#gMsg').textContent = pick([`Got you! Try again?`, `Three in a row. I am too good.`]); App.flashPose('excited', 4000); record('ttt', 'loss'); }
      else { $('#gMsg').textContent = pick(['A draw. We are evenly matched.', 'Nobody wins this one.']); App.flashPose('smile', 2500); record('ttt', 'draw'); }
    }
    function play(i) {
      if (over || b[i]) return;
      b[i] = 'X'; let w = winner(b); if (w) return end('X'); if (full(b)) return end('D');
      const m = aiMove(); b[m] = 'O'; w = winner(b); draw(); if (w) return end('O'); if (full(b)) return end('D');
      $('#gMsg').textContent = 'Your turn';
    }
    function reset() { b = Array(9).fill(null); over = false; turn = 'X'; $('#gMsg').textContent = 'You are X. Your move.'; draw(); }
    $('#lvl').addEventListener('click', (e) => { const x = e.target.closest('button'); if (!x) return; level = x.dataset.v; $$('#lvl button').forEach((y) => y.classList.toggle('on', y === x)); reset(); });
    $('#again').addEventListener('click', reset);
    reset();
  }

  // ---------- Rock Paper Scissors ----------
  function rps() {
    const body = $('#gBody');
    body.innerHTML = `<div class="msg-line" id="gMsg">Pick one. No peeking!</div><div class="rps" id="rpsRow"></div><div class="msg-line" id="gRes" style="font-weight:500;color:var(--body)"></div>`;
    const OPT = [['rock', 'Rock'], ['paper', 'Paper'], ['scissors', 'Scissors']], BEATS = { rock: 'scissors', paper: 'rock', scissors: 'paper' };
    OPT.forEach(([k, label]) => {
      const b = document.createElement('button'); b.type = 'button'; b.innerHTML = `${icon('r-' + k)}<span>${label}</span>`;
      b.addEventListener('click', () => {
        const mine = pick(OPT)[0];
        $('#gMsg').innerHTML = `You: <b>${k}</b> &nbsp;|&nbsp; ${esc(name())}: <b>${mine}</b>`;
        if (k === mine) { $('#gRes').textContent = pick(['Same! Again!', 'We think alike.']); record('rps', 'draw'); App.flashPose('smile', 2000); }
        else if (BEATS[k] === mine) { $('#gRes').textContent = pick(['You win this one!', 'Ugh, nicely played.']); record('rps', 'win'); App.flashPose('cry', 2500); }
        else { $('#gRes').textContent = pick(['Mine! Too easy.', 'I read you like a book.']); record('rps', 'loss'); App.flashPose('excited', 3000); }
      });
      $('#rpsRow').appendChild(b);
    });
  }

  // ---------- AI chat games ----------
  function aiChat(id) {
    const body = $('#gBody');
    const hint = { wordchain: 'Type a word', twenty: 'Ask a yes or no question, or make a guess', truthdare: 'Say truth, dare, or answer her' }[id];
    const quick = id === 'truthdare' ? ['Truth', 'Dare'] : id === 'wordchain' ? ['I give up'] : id === 'twenty' ? ['Give me a hint'] : [];
    body.innerHTML = `<div class="gchat" id="gchat" aria-live="polite"></div><div class="suggest" id="gq" style="justify-content:flex-start"></div><form class="gbar" id="gform"><input class="in" id="gin" placeholder="${hint}" autocomplete="off" aria-label="${hint}"><button class="btn" type="submit">Send</button><button class="btn ghost" type="button" id="gnew">New round</button></form>`;
    let msgs = [], busy = false, finished = false;
    const box = $('#gchat');
    const add = (role, text) => {
      const r = document.createElement('div'); r.className = 'row ' + (role === 'user' ? 'user' : 'bot');
      if (role !== 'user') r.insertAdjacentHTML('afterbegin', `<div class="av" aria-hidden="true" style="width:34px;height:34px"><img src="${App.stk('smile')}" alt=""></div>`);
      const b = document.createElement('div'); b.className = 'bubble'; b.textContent = text; r.appendChild(b); box.appendChild(r); box.scrollTop = box.scrollHeight; return r;
    };
    async function turn(userText) {
      if (busy) return; busy = true;
      if (userText) { msgs.push({ role: 'user', content: userText }); add('user', userText); }
      const typing = document.createElement('div'); typing.className = 'row bot'; typing.innerHTML = '<div class="bubble typing"><i></i><i></i><i></i></div>'; box.appendChild(typing); box.scrollTop = box.scrollHeight;
      App.restPose();
      try {
        const d = await App.api('/api/play', { body: { game: id, messages: msgs } });
        typing.remove();
        let reply = d.reply.trim(); const m = reply.match(/GAME OVER:\s*(win|loss)/i);
        if (m) { reply = reply.replace(/GAME OVER:\s*(win|loss)/i, '').trim(); finished = true; record(id, m[1].toLowerCase()); App.flashPose(m[1].toLowerCase() === 'win' ? 'cry' : 'excited', 3500); }
        msgs.push({ role: 'assistant', content: reply }); add('bot', reply);
      } catch (e) { typing.remove(); add('bot', e.message); if (msgs.length && msgs[msgs.length - 1].role === 'user') msgs.pop(); }
      busy = false;
    }
    $('#gform').addEventListener('submit', (e) => { e.preventDefault(); const v = $('#gin').value.trim(); if (!v) return; $('#gin').value = ''; if (id === 'wordchain' && /^i give up$/i.test(v)) { record(id, 'done'); } turn(v); });
    quick.forEach((q) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = q; b.addEventListener('click', () => { if (/give up/i.test(q)) record(id, 'done'); turn(q); }); $('#gq').appendChild(b); });
    $('#gnew').addEventListener('click', () => { msgs = []; box.innerHTML = ''; finished = false; turn(''); });
    turn('');
    setTimeout(() => $('#gin') && $('#gin').focus(), 80);
  }

  // ---------- Trivia ----------
  function trivia() {
    const body = $('#gBody');
    body.innerHTML = `<div class="field" style="max-width:520px;margin:0 auto;width:100%"><label for="tTopic">Pick a topic (or leave empty for a surprise)</label><input type="text" id="tTopic" placeholder="Space, cricket, Bollywood, coding…" maxlength="80"><button class="btn" id="tGo" type="button" style="margin-top:12px">Start quiz</button></div><div id="tBox"></div>`;
    $('#tGo').addEventListener('click', async () => {
      const btn = $('#tGo'); btn.disabled = true; btn.textContent = 'Making your quiz…';
      try {
        const d = await App.api('/api/play', { body: { game: 'trivia', topic: $('#tTopic').value } });
        run(d.questions);
      } catch (e) { App.toast(e.message); }
      btn.disabled = false; btn.textContent = 'Start quiz';
    });
    function run(qs) {
      let i = 0, score = 0; const tb = $('#tBox'); $('#tGo').parentElement.hidden = true;
      const show = () => {
        if (i >= qs.length) {
          const win = score >= Math.ceil(qs.length * 0.6);
          tb.innerHTML = `<div class="msg-line" style="font-size:22px">You got ${score} of ${qs.length}</div><div class="msg-line" style="font-weight:500">${win ? 'Nice! You beat me this time.' : 'I win this round. Want a rematch?'}</div><div style="text-align:center;margin-top:12px"><button class="btn" id="tAgain" type="button">Play again</button></div>`;
          record('trivia', win ? 'win' : 'loss', score + '/' + qs.length); App.flashPose(win ? 'cry' : 'excited', 3500);
          $('#tAgain').addEventListener('click', () => { tb.innerHTML = ''; $('#tGo').parentElement.hidden = false; });
          return;
        }
        const q = qs[i];
        tb.innerHTML = `<div class="msg-line" style="text-align:left;color:var(--muted);font-size:13px">Question ${i + 1} of ${qs.length}</div><h3 style="margin:4px 0 14px;font-size:19px">${esc(q.q)}</h3><div id="tOpts"></div><div id="tFact" class="msg-line" style="font-weight:500;color:var(--body);text-align:left"></div><div style="margin-top:8px"><button class="btn" id="tNext" type="button" hidden>${i === qs.length - 1 ? 'See result' : 'Next'}</button></div>`;
        q.options.forEach((o, k) => {
          const b = document.createElement('button'); b.type = 'button'; b.className = 'opt'; b.textContent = o;
          b.addEventListener('click', () => {
            $$('#tOpts .opt').forEach((x, j) => { x.disabled = true; if (j === q.answer) x.classList.add('good'); });
            if (k === q.answer) { score++; App.flashPose('excited', 1800); } else { b.classList.add('bad'); App.flashPose('smile', 1800); }
            $('#tFact').textContent = q.fact || ''; $('#tNext').hidden = false; $('#tNext').focus();
          });
          $('#tOpts').appendChild(b);
        });
        $('#tNext').addEventListener('click', () => { i++; show(); });
      };
      show();
    }
  }
  // ---------- shared: fetch a set of words ----------
  async function wordSet(topic) { const d = await App.api('/api/play', { body: { game: 'words', topic } }); return d.words; }
  const shuffle = (a) => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  // ---------- Word Scramble ----------
  function scramble() {
    const body = $('#gBody');
    body.innerHTML = `<div class="field" style="max-width:520px;margin:0 auto;width:100%"><label for="wTopic">Pick a theme (or leave empty)</label><input type="text" id="wTopic" placeholder="Food, space, movies…" maxlength="60"><button class="btn" id="wGo" type="button" style="margin-top:12px">Start</button></div><div id="wBox"></div>`;
    $('#wGo').addEventListener('click', async () => {
      const b = $('#wGo'); b.disabled = true; b.textContent = 'Mixing letters…';
      try { run(shuffle(await wordSet($('#wTopic').value)).slice(0, 5)); } catch (e) { App.toast(e.message); }
      b.disabled = false; b.textContent = 'Start';
    });
    function run(words) {
      $('#wGo').parentElement.hidden = true; $('#gReact').hidden = true;
      let i = 0, got = 0; const box = $('#wBox');
      const show = () => {
        if (i >= words.length) {
          const win = got >= 3;
          box.innerHTML = `<div class="msg-line" style="font-size:22px">You solved ${got} of ${words.length}</div><div style="text-align:center;margin-top:12px"><button class="btn" id="wAgain" type="button">Play again</button></div>`;
          record('scramble', win ? 'win' : 'loss', got + '/' + words.length);
          $('#wAgain').addEventListener('click', () => { box.innerHTML = ''; $('#wGo').parentElement.hidden = false; });
          return;
        }
        const w = words[i]; let tries = 3, sc = w.word;
        for (let k = 0; k < 8 && sc === w.word; k++) sc = shuffle(w.word.split('')).join('');
        box.innerHTML = `<div class="msg-line" style="color:var(--muted);font-size:13px">Word ${i + 1} of ${words.length}</div><div class="tiles">${sc.split('').map((c) => `<span>${esc(c)}</span>`).join('')}</div><div class="msg-line" id="wHint">Hint: ${esc(w.hint)}</div><form class="gbar" id="wForm"><input class="in" id="wIn" placeholder="Your answer" autocomplete="off" autocapitalize="off" aria-label="Your answer"><button class="btn" type="submit">Check</button><button class="btn ghost" type="button" id="wSkip">Skip</button></form><div class="msg-line" id="wMsg" aria-live="polite"></div>`;
        const next = () => { i++; setTimeout(show, 1100); };
        $('#wForm').addEventListener('submit', (e) => {
          e.preventDefault(); const v = $('#wIn').value.trim().toLowerCase(); if (!v) return;
          if (v === w.word) { got++; $('#wMsg').textContent = pick(['Yes! Hmm, you are quick...', 'Correct! Okay okay, nice one.', 'Ohh nice, that is right!']); App.flashPose('cheer', 1800); $('#wForm').remove(); next(); }
          else if (--tries > 0) { $('#wMsg').textContent = `Hmm, not that one. ${tries} ${tries === 1 ? 'try' : 'tries'} left.`; App.flashPose('smile', 1500); $('#wIn').select(); }
          else { $('#wMsg').textContent = `Aww, it was "${w.word}".`; App.flashPose('cry', 1800); $('#wForm').remove(); next(); }
        });
        $('#wSkip').addEventListener('click', () => { $('#wMsg').textContent = `It was "${w.word}".`; $('#wForm').remove(); next(); });
        setTimeout(() => $('#wIn') && $('#wIn').focus(), 60);
      };
      show();
    }
  }

  // ---------- Hangman ----------
  function hangman() {
    const body = $('#gBody'); let words = [], idx = 0;
    body.innerHTML = `<div class="field" style="max-width:520px;margin:0 auto;width:100%"><label for="hTopic">Pick a theme (or leave empty)</label><input type="text" id="hTopic" placeholder="Animals, school, travel…" maxlength="60"><button class="btn" id="hGo" type="button" style="margin-top:12px">Start</button></div><div id="hBox"></div>`;
    $('#hGo').addEventListener('click', async () => {
      const b = $('#hGo'); b.disabled = true; b.textContent = 'Choosing words…';
      try { words = shuffle(await wordSet($('#hTopic').value)); idx = 0; $('#hGo').parentElement.hidden = true; round(); } catch (e) { App.toast(e.message); }
      b.disabled = false; b.textContent = 'Start';
    });
    function round() {
      if (idx >= words.length) { words = []; $('#hBox').innerHTML = `<div class="msg-line">That was the last word!</div><div style="text-align:center"><button class="btn" id="hNew" type="button">New set</button></div>`; $('#hNew').addEventListener('click', () => { $('#hBox').innerHTML = ''; $('#hGo').parentElement.hidden = false; }); return; }
      const w = words[idx].word, hint = words[idx].hint; let lives = 6, over = false; const used = new Set();
      const box = $('#hBox'); $('#gReact').hidden = true;
      const draw = () => {
        const shown = w.split('').map((c) => (used.has(c) || over ? c : '_')).join(' ');
        box.innerHTML = `<div class="msg-line">Lives <b>${'♥'.repeat(lives)}${'·'.repeat(6 - lives)}</b></div><div class="word-slots" aria-label="Word with ${w.length} letters">${esc(shown)}</div><div class="msg-line">Hint: ${esc(hint)}</div><div class="keys" id="hKeys"></div>${over ? '<div style="text-align:center;margin-top:10px"><button class="btn" id="hNext" type="button">Next word</button></div>' : ''}`;
        'abcdefghijklmnopqrstuvwxyz'.split('').forEach((c) => { const k = document.createElement('button'); k.type = 'button'; k.textContent = c; k.disabled = over || used.has(c); if (used.has(c)) k.className = w.includes(c) ? 'good' : 'bad'; k.setAttribute('aria-label', 'Letter ' + c); k.addEventListener('click', () => guess(c)); $('#hKeys').appendChild(k); });
        const n = $('#hNext'); if (n) n.addEventListener('click', () => { idx++; round(); });
      };
      function guess(c) {
        used.add(c);
        if (!w.includes(c)) { lives--; App.flashPose('smile', 900); }
        if (w.split('').every((x) => used.has(x))) { over = true; draw(); record('hangman', 'win', w); return; }
        if (lives <= 0) { over = true; draw(); record('hangman', 'loss', w); return; }
        draw();
      }
      const onKey = (e) => { if (active !== 'hangman' || over) { if (active !== 'hangman') document.removeEventListener('keydown', onKey); return; } if (/^[a-z]$/i.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey && document.activeElement.tagName !== 'INPUT') { const c = e.key.toLowerCase(); if (!used.has(c)) guess(c); } };
      document.addEventListener('keydown', onKey);
      draw();
    }
  }
})();
