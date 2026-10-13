// Whole-app language: English, हिंदी, Hinglish. Texts are swapped from a dictionary; she also speaks the same language.
(() => {
  const D = window.I18N_DATA || {}, IDX = { hi: 0, hn: 1 };
  let lang = 'en'; try { lang = localStorage.getItem('tiny.lang') || 'en'; } catch (e) { /* ignore */ }
  const RULES = [
    [/^Next update in (\d+) days?$/, ['अगला अपडेट $1 दिन में', 'Agla update $1 din mein']],
    [/^(\d+) memories$/, ['$1 यादें', '$1 memories']],
    [/^(\d+) glass(?:es)?$/, ['$1 गिलास', '$1 glass']],
    [/^Charging (\d+) min$/, ['चार्ज हो रही है $1 मिनट', 'Charging $1 min']],
    [/^Quick charge ([\d.]+) min$/, ['क्विक चार्ज $1 मिनट', 'Quick charge $1 min']],
    [/^Sleeping in her update, back in (.+)$/, ['अपडेट में सो रही है, $1 में वापस', 'Update mein so rahi hai, $1 mein wapas']],
    [/^Online · (\d+) chats saved$/, ['ऑनलाइन · $1 चैट सेव', 'Online · $1 chats saved']],
    [/^Right now: (.+)$/, ['अभी: $1', 'Abhi: $1']],
  ];
  const key = (s) => s.replace(/\s+/g, ' ').trim();
  const tr = (s) => {
    if (lang === 'en') return s;
    const k = key(s); if (!k) return s;
    const v = D[k]; if (v) return s.replace(s.trim(), v[IDX[lang]]);
    for (const [re, o] of RULES) if (re.test(k)) return s.replace(s.trim(), k.replace(re, o[IDX[lang]]));
    return s;
  };
  const SKIP = 'script,style,textarea,[data-no-i18n],#messages,.md,.note-body,#lItems,input';
  const src = new WeakMap();
  function node(n) {
    const p = n.parentElement; if (!p || p.closest(SKIP)) return;
    const rec = src.get(n), from = rec && n.data === rec.out ? rec.en : n.data, out = tr(from);
    if (n.data !== out) n.data = out;
    src.set(n, { en: from, out });
  }
  const ATTRS = ['placeholder', 'aria-label', 'title', 'alt'];
  function attrs(el) {
    if (el.closest && el.closest('script,style,[data-no-i18n]')) return;
    const m = el.__i18n || (el.__i18n = {});
    for (const a of ATTRS) {
      const v = el.getAttribute && el.getAttribute(a); if (v == null) continue;
      const rec = m[a], from = rec && v === rec.out ? rec.en : v, out = tr(from);
      if (v !== out) el.setAttribute(a, out);
      m[a] = { en: from, out };
    }
  }
  function walk(root) {
    if (root.nodeType === 3) return node(root);
    if (root.nodeType !== 1) return;
    attrs(root); root.querySelectorAll('[placeholder],[aria-label],[title],[alt]').forEach(attrs);
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let n;
    while ((n = w.nextNode())) node(n);
  }
  const mo = new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === 'characterData') node(m.target);
      else if (m.type === 'attributes') attrs(m.target);
      else m.addedNodes.forEach(walk);
    }
  });
  const start = () => { walk(document.body); mo.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS }); };
  const paintSeg = () => document.querySelectorAll('.app-lang button').forEach((b) => b.classList.toggle('on', b.dataset.lang === lang));
  function setLang(l, sync) {
    lang = l; try { localStorage.setItem('tiny.lang', l); } catch (e) { /* ignore */ }
    document.documentElement.lang = l === 'hi' ? 'hi' : 'en'; walk(document.body); paintSeg();
    if (sync && window.App && window.App.saveSettings && window.App.token) window.App.saveSettings({ persona: { language: { en: 'english', hi: 'hindi', hn: 'hinglish' }[l] } }).catch(() => {});
  }
  window.T = (s) => tr(String(s));
  document.querySelectorAll('.app-lang button').forEach((b) => b.addEventListener('click', () => setLang(b.dataset.lang, true)));
  document.documentElement.lang = lang === 'hi' ? 'hi' : 'en';
  start(); paintSeg();
})();
