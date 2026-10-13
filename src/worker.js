// Memory AI: one Worker serves the website (public/) and the API (/api/*).
import { docText } from './lib/docs.js';
import { makeFile } from './lib/files.js';
import { sendDocument } from './lib/telegram.js';
import { ensureSchema } from './lib/db.js';
import { bytesToB64, json, now, uid, istDate, plainForSpeech } from './lib/util.js';
import { checkAuth, login } from './lib/auth.js';
import { getSettings, saveSettings } from './lib/settings.js';
import { openStream, readStream, candidates } from './lib/ai.js';
import { prepareChat, finishChat, sleepTurn } from './lib/chat.js';
import { remember, forget, updateMemory, vecDelete, getPending, resolvePending } from './lib/memory.js';
import { listNotes, getNote, createNote, saveNote, deleteNote } from './lib/notes.js';
import { listTasks, createTask, parseTask, runTask, runDueTasks } from './lib/tasks.js';
import { speechToText, textToSpeech } from './lib/voice.js';
import { listLists, getList, createList, saveList, deleteList, tidyPoints } from './lib/lists.js';
import { addSub, removeSub, listSubs, sendPush, pushReady } from './lib/push.js';
import { notifyOwner } from './lib/notify.js';
import { saveMood, listMoods, deleteMood, moodReply } from './lib/moods.js';
import { habitSummary, setWater, addWater } from './lib/habits.js';
import { listDates, createDate, deleteDate } from './lib/dates.js';
import { runCare, careTick, lastActive } from './lib/care.js';
import { grumpyAfterUpdate, getHer, putHer, bump, setHer, beforeReply, SEEN_LINE, applyChosenMood } from './lib/her.js';
import { rollForce, forceGo, argueLine, attachFeedback, wakeDue, wakeUp, mt as maintOf, viewOf, reportOf, startSession, finishSession, pendingSteps, setStep, tickStep, addBug, setBug, addWish, setWish, bumpPart, isSunday, healthOf } from './lib/maint.js';
import { herView, moodKindNow } from './lib/tinymood.js';
import { startCharge, batteryView, usePowerBank, powerLine, nightCharge } from './lib/battery.js';
import { inSleepWindow } from './lib/her.js';
import { getAmbient } from './lib/ambient.js';
import { getLife, lifeDaily } from './lib/life.js';
import { getSortState, startSort, sortStep, sortTick } from './lib/memsort.js';
import { periodNow } from './lib/period.js';
import { getToday } from './lib/today.js';
import { playTurn } from './lib/play.js';
import { handleUpdate, setWebhook, webhookInfo } from './lib/telegram.js';

const MAX_BODY = 25 * 1024 * 1024; // 25 MB, enough for long voice clips. This is a safety size, not a usage limit.

async function herNow(env, st) {
  const [her, last, ambient] = await Promise.all([getHer(env), lastActive(env).catch(() => 0), getAmbient(env, st).catch(() => null)]);
  if (nightCharge(her, inSleepWindow(st, now()), now())) await putHer(env, her);
  return herView(st, her, { period: periodNow(st), lastActive: last, ambient });
}
async function lifeOut(env) {
  const l = await getLife(env), today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
  return { profile: l.profile, today: (l.days.find((d) => d.day === today) || {}).text || '', earlier: l.days.filter((d) => d.day !== today).slice(-3).map((d) => d.text) };
}
// The first time the app is opened (and after every update that did not finish), the memories are sorted into hers and theirs.
async function autoSort(env) { const s = await startSort(env); if (!s.done) await sortStep(env); }
async function settingsOut(env, st) { return { ...st, periodNow: periodNow(st), her_now: await herNow(env, st) }; }

async function readJson(request) {
  try { return await request.json(); } catch { return {}; }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const p = url.pathname;
    if (!p.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      if (p !== '/api/health') await ensureSchema(env);
      return await route(request, env, ctx, url, p);
    } catch (e) {
      console.error('[api]', p, e && e.stack || e);
      return json({ error: e.message || 'Something went wrong.' }, e.status || 500);
    }
  },

  async scheduled(event, env, ctx) {
    await ensureSchema(env);
    if (event.cron === '* * * * *') {
      ctx.waitUntil(runDueTasks(env).catch((e) => console.error('[tasks]', e)));
      ctx.waitUntil(careTick(env, event.scheduledTime).catch((e) => console.error('[care]', e)));
      ctx.waitUntil(sortTick(env).catch((e) => console.error('[sort]', e)));
    }
    else if (event.cron === '0 21 * * 6') ctx.waitUntil(backup(env).catch((e) => console.error('[backup]', e)));
    else ctx.waitUntil(getToday(env, { force: true }).catch((e) => console.error('[today]', e)));
  },
};

async function route(request, env, ctx, url, p) {
  const m = request.method;
  if (p === '/api/health') return json({ ok: true, time: now() });
  if (p === '/api/login' && m === 'POST') return login(request, env);
  if (p === '/api/tg/hook' && m === 'POST') return handleUpdate(request, env, ctx);

  const a = await checkAuth(request, env);
  if (!a.ok) return a.res;
  if ((Number(request.headers.get('content-length')) || 0) > MAX_BODY) return json({ error: 'That upload is too large.' }, 413);

  // ---------- status ----------
  if (p === '/api/status' && m === 'GET') {
    const mem = await env.DB.prepare('SELECT COUNT(*) AS n FROM memories').first().catch(() => ({ n: 0 }));
    const chats = await env.DB.prepare('SELECT COUNT(*) AS n FROM conversations').first().catch(() => ({ n: 0 }));
    return json({
      memories: mem.n, chats: chats.n, pending: (await getPending(env)).length,
      brains: candidates(env, 'smart').map((c) => c.provider).filter((v, i, a2) => a2.indexOf(v) === i),
      telegram: { botSet: !!env.TELEGRAM_BOT_TOKEN, ownerSet: !!env.OWNER_TG_ID, secretSet: !!env.TG_WEBHOOK_SECRET },
      vectors: !!env.VECTORS, voice: true,
      push: { configured: pushReady(env), devices: (await listSubs(env)).length },
      hindiVoice: !!(env.SARVAM_API_KEY || env.GEMINI_API_KEY),
    });
  }

  // ---------- settings ----------
  if (p === '/api/settings') {
    if (m === 'GET') { ctx.waitUntil(autoSort(env).catch((e) => console.error('[sort]', e && e.message))); return json(await settingsOut(env, await getSettings(env))); }
    if (m === 'PUT') {
      const body = await readJson(request);
      let saved = await saveSettings(env, body);
      if (body && body.tinyMood && !['auto', 'lazy', 'in_pain'].includes(body.tinyMood) && await applyChosenMood(env, saved, body.tinyMood).catch(() => false)) saved = await saveSettings(env, { tinyMood: 'auto' });   // her mood now follows the chat from here
      return json(await settingsOut(env, saved));
    }
  }

  // ---------- her feelings (header chip + test buttons) ----------
  if (p === '/api/her') {
    const st = await getSettings(env);
    if (m === 'POST') {
      const b = await readJson(request);
      if (['sleep', 'wake', 'angry', 'sulky', 'happy'].includes(b.what)) await setHer(env, st, b.what);
      if (b.what === 'life') await lifeDaily(env, st, { force: true });
    }
    return json({ her: await herNow(env, st), life: await lifeOut(env) });
  }

  // ---------- her maintenance: health, versions, bugs, wishes, parts, the update checklist ----------
  if (p === '/api/maint') {
    const st = await getSettings(env), her = await getHer(env), t = now();
    if (m === 'POST') {
      const b = await readJson(request), a = String(b.action || '');
      maintOf(her, t);
      if (wakeDue(her, t)) { const e = wakeUp(her, t); await attachFeedback(env, st, e); grumpyAfterUpdate(her, t); await putHer(env, her); }
      if (a === 'argue') return json({ text: await argueLine(env, st, { reason: String(b.reason || ''), round: b.round, win: !!(her.maint.force && her.maint.force.win), said: Array.isArray(b.said) ? b.said.slice(-3).map((x) => String(x).slice(0, 200)) : [] }) });
      if (a === 'forceRoll') {
        if (her.updateMode && her.updateMode.since) return json({ error: 'She is already updating.' }, 400);
        const f = rollForce(her, String(b.reason || ''), t);
        if (!f) return json({ error: 'You already used your forced update this week. Next one after Sunday.' }, 400);
        await putHer(env, her);
        return json({ win: f.win });
      }
      if (a === 'forceStart') {
        if (her.updateMode && her.updateMode.since) return json({ error: 'She is already updating.' }, 400);
        if (!forceGo(her, String(b.reason || ''), t)) return json({ error: 'She won this argument, no update today.' }, 400);
      } else if (a === 'start') {
        if (!isSunday(t) && !b.force) return json({ error: 'She only does updates on Sunday.' }, 400);
        if (!her.maint.session) startSession(her, t);
      } else if (a === 'step') setStep(her, String(b.k || ''), b.done !== false);
      else if (a === 'complete') {
        if (!her.maint.session) return json({ error: 'Start the update first.' }, 400);
        const left = pendingSteps(her);
        if (left.length && !b.force) return json({ error: 'Steps left: ' + left.map((x) => x.label).join(', ') + '.', left: left.map((x) => x.k) }, 409);
        { const e = finishSession(her, t); await attachFeedback(env, st, e); } bump(her, st, 'happy', 75, 'she just got her update', t);
      } else if (a === 'test') {
        const rep = await reportOf(env, her, st, { t, deep: true });
        const ok = rep.checks.every((c) => c.status !== 'needs fixing' || c.k === 'bugs' || c.k === 'wear');
        if (her.maint.session && ok) tickStep(her, 'test');
        await putHer(env, her);
        return json({ ok, report: rep, view: viewOf(her, st, t) });
      }
      else if (a === 'wish') addWish(her, String(b.text || ''), { part: b.part, by: 'you', t });
      else if (a === 'wishStatus') setWish(her, String(b.id || ''), String(b.status || ''), t);
      else if (a === 'bugAdd') addBug(her, String(b.text || ''), { sev: b.sev === 'big' ? 'big' : 'small', by: 'you', t });
      else if (a === 'bugStatus') setBug(her, String(b.id || ''), String(b.status || ''), t);
      else if (a === 'partUp') bumpPart(her, String(b.k || ''), b.d === -1 ? -1 : 1);
      else return json({ error: 'Unknown action.' }, 400);
      await putHer(env, her);
    } else {
      let dirty = false;
      if (!her.maint) { maintOf(her, t); dirty = true; }
      if (wakeDue(her, t)) { const e = wakeUp(her, t); await attachFeedback(env, st, e); grumpyAfterUpdate(her, t); dirty = true; }
      if (dirty) await putHer(env, her);
    }
    return json({ view: viewOf(her, st, t), report: await reportOf(env, her, st, { t }) });
  }

  // ---------- battery ----------
  if (p === '/api/battery') {
    const st = await getSettings(env), her = await getHer(env);
    let note = '', text = '';
    if (nightCharge(her, inSleepWindow(st, now()), now())) await putHer(env, her);
    if (m === 'POST') {
      const b = await readJson(request);
      if (b.action === 'charge') { note = startCharge(her, st); if (note === 'started') await putHer(env, her); }
      else if (b.action === 'powerbank') {
        const was = batteryView(st, her).fainted; note = usePowerBank(her, st);
        if (note === 'ok') { await putHer(env, her); text = await powerLine(env, st, was); }
      }
    }
    return json({ battery: batteryView(st, her), result: note, text });
  }

  // ---------- sorting memories into "mine" and "hers" ----------
  if (p === '/api/memory/sort') {
    if (m === 'POST') { const b = await readJson(request); const s = await startSort(env, { force: !!b.force }); ctx.waitUntil(sortStep(env).catch(() => {})); return json({ sort: s }); }
    return json({ sort: await getSortState(env) });
  }

  // ---------- chat (streams newline-delimited JSON) ----------
  if (p === '/api/chat' && m === 'POST') return chat(request, env, ctx);

  // ---------- conversations ----------
  if (p === '/api/conversations' && m === 'GET') {
    const q = (url.searchParams.get('q') || '').trim();
    const r = q
      ? await env.DB.prepare('SELECT DISTINCT c.id,c.title,c.source,c.updated_at FROM conversations c LEFT JOIN messages m ON m.conv_id=c.id WHERE c.title LIKE ?1 OR m.content LIKE ?1 ORDER BY c.updated_at DESC LIMIT 100').bind(`%${q}%`).all()
      : await env.DB.prepare('SELECT id,title,source,updated_at FROM conversations ORDER BY updated_at DESC LIMIT ?').bind(Math.min(500, Math.max(1, parseInt(url.searchParams.get('limit') || '500', 10) || 500))).all();
    return json({ conversations: r.results || [] });
  }
  let mt = p.match(/^\/api\/conversations\/([\w-]+)$/);
  if (mt) {
    if (m === 'DELETE') { await deleteConversation(env, mt[1]); return json({ ok: true }); }
    if (m === 'PATCH') {
      const b = await readJson(request);
      if (b.title) await env.DB.prepare('UPDATE conversations SET title=? WHERE id=?').bind(String(b.title).slice(0, 80), mt[1]).run();
      return json({ ok: true });
    }
  }
  mt = p.match(/^\/api\/conversations\/([\w-]+)\/messages$/);
  if (mt && m === 'GET') {
    const r = await env.DB.prepare('SELECT id,role,content,via,created_at FROM messages WHERE conv_id=? ORDER BY id').bind(mt[1]).all();
    return json({ messages: r.results || [] });
  }

  // ---------- memories ----------
  if (p === '/api/memories') {
    if (m === 'GET') {
      const since = parseInt(url.searchParams.get('since') || '0', 10) || 0;
      const r = since
        ? await env.DB.prepare('SELECT * FROM memories WHERE updated_at>? ORDER BY updated_at DESC').bind(since).all()
        : await env.DB.prepare('SELECT * FROM memories ORDER BY pinned DESC, updated_at DESC').all();
      return json({ memories: r.results || [] });
    }
    if (m === 'POST') {
      const b = await readJson(request);
      const saved = await remember(env, { text: b.text, category: b.category, importance: b.importance ?? 4, pinned: b.pinned ? 1 : 0, source: 'manual' });
      if (!saved) return json({ error: 'Write a little more.' }, 400);
      return json({ memory: saved });
    }
    if (m === 'DELETE') { // forget everything
      const ids = (await env.DB.prepare('SELECT id FROM memories').all()).results || [];
      await env.DB.prepare('DELETE FROM memories').run();
      for (let i = 0; i < ids.length; i += 100) await vecDelete(env, ids.slice(i, i + 100).map((x) => 'f:' + x.id));
      return json({ ok: true, removed: ids.length });
    }
  }
  mt = p.match(/^\/api\/memories\/([\w-]+)$/);
  if (mt) {
    if (m === 'PATCH') { const r = await updateMemory(env, mt[1], await readJson(request)); return r ? json({ memory: r }) : json({ error: 'Not found.' }, 404); }
    if (m === 'DELETE') { await forget(env, mt[1]); return json({ ok: true }); }
  }

  // ---------- voice ----------
  if (p === '/api/stt' && m === 'POST') {
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.length < 200) return json({ error: 'That recording was empty.' }, 400);
    const lang = url.searchParams.get('lang') || undefined;
    const text = await speechToText(env, bytes, (request.headers.get('Content-Type') || 'audio/webm').split(';')[0], lang);
    return json({ text });
  }
  if (p === '/api/tts' && m === 'POST') {
    const b = await readJson(request);
    const text = plainForSpeech(b.text || '');
    try {
      const st = await getSettings(env);
      const mood = await moodKindNow(env, st).catch(() => null);
      const v = await textToSpeech(env, text, { mood, gender: st.persona.gender, language: st.persona.language, voice: st.persona.gender === 'boy' ? st.voice.boy : st.voice.girl });
      return new Response(v.bytes, { headers: { 'Content-Type': v.mime, 'X-Voice-Engine': v.engine, 'Cache-Control': 'private, max-age=86400' } });
    } catch (e) { return json({ error: e.message, fallback: true }, e.status || 502); }
  }

  // ---------- phone notifications ----------
  if (p === '/api/push/key' && m === 'GET') return json({ key: pushReady(env) ? env.VAPID_PUBLIC : null });
  if (p === '/api/push/subscribe' && m === 'POST') { const b = await readJson(request); return json({ ok: true, devices: await addSub(env, b.subscription, request.headers.get('User-Agent') || '') }); }
  if (p === '/api/push/unsubscribe' && m === 'POST') { await removeSub(env, String((await readJson(request)).endpoint || '')); return json({ ok: true }); }
  if (p === '/api/push/test' && m === 'POST') {
    const st = await getSettings(env);
    const r = await notifyOwner(env, { title: st.persona.name, body: 'Hehe, it works! I can reach you now.', url: '/', tag: 'test' });
    return json({ ok: r.push > 0 || r.telegram, ...r });
  }

  // ---------- mood ----------
  if (p === '/api/moods') {
    if (m === 'GET') return json({ moods: await listMoods(env) });
    if (m === 'POST') { const b = await readJson(request); const mood = await saveMood(env, b); return json({ mood, reply: await moodReply(env, mood) }); }
  }
  mt = p.match(/^\/api\/moods\/([\w-]+)$/);
  if (mt && m === 'DELETE') { await deleteMood(env, mt[1]); return json({ ok: true }); }
  if (p === '/api/care/run' && m === 'POST') { const b = await readJson(request); return json(await runCare(env, { force: ['mood', 'miss', 'period', 'habit', 'dates', 'tease', 'nakhre', 'sunday', 'maint', 'briefing'].includes(b.what) ? b.what : null })); }

  // ---------- make a file from voice chat: build it, send it to Telegram (or hand it back to download) ----------
  if (p === '/api/make' && m === 'POST') {
    const b = await readJson(request);
    const kind = ['pdf', 'html', 'csv', 'md', 'docx', 'xlsx'].includes(b.kind) ? b.kind : 'pdf';
    const text = String(b.text || '').trim().slice(0, 1500);
    let context = '';
    if (b.convId) {
      const r = await env.DB.prepare('SELECT role,content FROM messages WHERE conv_id=? ORDER BY id DESC LIMIT 10').bind(String(b.convId)).all().catch(() => ({ results: [] }));
      context = (r.results || []).reverse().map((x) => (x.role === 'user' ? 'Person: ' : 'Assistant: ') + String(x.content).slice(0, 1200)).join('\n');
    }
    const extra = (context ? '# The conversation so far (the topic may be "this", meaning what they were just talking about)\n' + context + '\n\n' : '') + '# What they just said (it may be spoken, with mistakes)\n' + text;
    const f = await makeFile(env, kind, 'Make this file about the topic the person asked for. If they named a topic use that; if they said "this" or did not name one, use what the conversation was about.', extra, text);
    let sent = false;
    if (env.TELEGRAM_BOT_TOKEN && env.OWNER_TG_ID) { const r = await sendDocument(env, env.OWNER_TG_ID, f.bytes, f.name, 'Here is your ' + kind.toUpperCase() + ' file.', f.mime); sent = !!(r && r.ok); }
    if (sent) return json({ ok: true, sent: true, name: f.name });
    return json({ ok: true, sent: false, name: f.name, mime: f.mime, b64: bytesToB64(f.bytes) });
  }

  // ---------- read a file (PDF, HTML, text) ----------
  if (p === '/api/extract' && m === 'POST') {
    const name = (url.searchParams.get('name') || 'file').slice(0, 120);
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (!bytes.length) return json({ error: 'That file is empty.' }, 400);
    const d = await docText(env, bytes, name, request.headers.get('content-type') || '');
    return json({ name, kind: d.kind, text: d.text });
  }

  // ---------- water habit and dates ----------
  if (p === '/api/habits') {
    if (m === 'GET') return json(await habitSummary(env));
    if (m === 'POST') { const b = await readJson(request); if (b.add !== undefined) await addWater(env, parseInt(b.add, 10) || 0); else await setWater(env, b.water); return json(await habitSummary(env)); }
  }
  if (p === '/api/dates') {
    if (m === 'GET') return json({ dates: await listDates(env) });
    if (m === 'POST') return json({ date: await createDate(env, await readJson(request)) });
  }
  mt = p.match(/^\/api\/dates\/([\w-]+)$/);
  if (mt && m === 'DELETE') { await deleteDate(env, mt[1]); return json({ ok: true }); }

  // ---------- New Today ----------
  if (p === '/api/today' && m === 'GET') return json(await getToday(env));
  if (p === '/api/today/refresh' && m === 'POST') return json(await getToday(env, { force: true }));

  // ---------- Play ----------
  if (p === '/api/play' && m === 'POST') return json(await playTurn(env, await readJson(request)));
  if (p === '/api/scores') {
    if (m === 'POST') {
      const b = await readJson(request);
      if (!/^[\w-]{1,30}$/.test(b.game || '') || !['win', 'loss', 'draw', 'done'].includes(b.outcome)) return json({ error: 'Bad score.' }, 400);
      await env.DB.prepare('INSERT INTO scores (game,outcome,detail,created_at) VALUES (?,?,?,?)').bind(b.game, b.outcome, String(b.detail || '').slice(0, 100), now()).run();
      return json({ ok: true });
    }
    if (m === 'GET') {
      const r = await env.DB.prepare('SELECT game,outcome,COUNT(*) AS n FROM scores GROUP BY game,outcome').all();
      return json({ scores: r.results || [] });
    }
  }

  // ---------- notes ----------
  if (p === '/api/notes') {
    if (m === 'GET') return json({ notes: await listNotes(env, (url.searchParams.get('q') || '').trim()) });
    if (m === 'POST') return json({ note: await createNote(env, await readJson(request)) });
  }
  mt = p.match(/^\/api\/notes\/([\w-]+)$/);
  if (mt) {
    if (m === 'GET') { const n = await getNote(env, mt[1]); return n ? json({ note: n }) : json({ error: 'Not found.' }, 404); }
    if (m === 'PATCH') {
      const r = await saveNote(env, mt[1], await readJson(request));
      if (r.status === 404) return json({ error: 'Not found.' }, 404);
      if (r.status === 409) return json({ error: 'This note changed somewhere else. Reload it to see the newer version.', note: r.note }, 409);
      return json({ note: r.note });
    }
    if (m === 'DELETE') { await deleteNote(env, mt[1]); return json({ ok: true }); }
  }

  // ---------- lists (speak or type, she makes the points) ----------
  if (p === '/api/lists') {
    if (m === 'GET') return json({ lists: await listLists(env) });
    if (m === 'POST') return json({ list: await createList(env, await readJson(request)) });
  }
  if (p === '/api/lists/speech' && m === 'POST') {
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.length < 200) return json({ error: 'That recording was empty.' }, 400);
    const lang = ['en', 'hi', 'hinglish'].includes(url.searchParams.get('lang')) ? url.searchParams.get('lang') : 'en';
    const raw = await speechToText(env, bytes, (request.headers.get('Content-Type') || 'audio/webm').split(';')[0], lang === 'en' ? 'en' : 'hi');
    if (!raw) return json({ error: 'I could not hear anything. Try again, a bit closer to the mic.' }, 422);
    return json({ raw, ...(await tidyPoints(env, raw, 'points', lang)) });
  }
  if (p === '/api/lists/tidy' && m === 'POST') { const b = await readJson(request); return json(await tidyPoints(env, b.text, b.mode === 'fix' ? 'fix' : 'points', ['en', 'hi', 'hinglish'].includes(b.lang) ? b.lang : '')); }
  mt = p.match(/^\/api\/lists\/([\w-]+)$/);
  if (mt) {
    if (m === 'GET') { const l = await getList(env, mt[1]); return l ? json({ list: l }) : json({ error: 'Not found.' }, 404); }
    if (m === 'PATCH') { const l = await saveList(env, mt[1], await readJson(request)); return l ? json({ list: l }) : json({ error: 'Not found.' }, 404); }
    if (m === 'DELETE') { await deleteList(env, mt[1]); return json({ ok: true }); }
  }

  // ---------- reminders and routines ----------
  if (p === '/api/tasks') {
    if (m === 'GET') return json({ tasks: await listTasks(env) });
    if (m === 'POST') return json({ task: await createTask(env, await readJson(request)) });
  }
  if (p === '/api/tasks/parse' && m === 'POST') return json(await parseTask(env, String((await readJson(request)).text || '')));
  mt = p.match(/^\/api\/tasks\/([\w-]+)(\/run)?$/);
  if (mt) {
    if (mt[2] && m === 'POST') {
      const t = await env.DB.prepare('SELECT * FROM tasks WHERE id=?').bind(mt[1]).first();
      if (!t) return json({ error: 'Not found.' }, 404);
      const out = await runTask(env, t);
      await env.DB.prepare('UPDATE tasks SET last_run=?,last_result=? WHERE id=?').bind(now(), out.slice(0, 2000), t.id).run();
      return json({ result: out });
    }
    if (m === 'PATCH') {
      const b = await readJson(request);
      if (b.enabled !== undefined) {
        await env.DB.prepare('UPDATE tasks SET enabled=? WHERE id=?').bind(b.enabled ? 1 : 0, mt[1]).run();
        if (b.enabled) await env.DB.prepare('UPDATE tasks SET run_at=? WHERE id=? AND run_at<?').bind(now() + 60000, mt[1], now()).run();
      }
      return json({ ok: true });
    }
    if (m === 'DELETE') { await env.DB.prepare('DELETE FROM tasks WHERE id=?').bind(mt[1]).run(); return json({ ok: true }); }
  }

  // ---------- review before remembering ----------
  if (p === '/api/pending' && m === 'GET') return json({ pending: await getPending(env) });
  mt = p.match(/^\/api\/pending\/([\w-]+)$/);
  if (mt && m === 'POST') { const b = await readJson(request); return json(await resolvePending(env, mt[1], b.action === 'approve')); }

  // ---------- backup / export ----------
  if (p === '/api/backup' && m === 'POST') return json(await backup(env));
  if (p === '/api/export' && m === 'GET') {
    const data = await dump(env);
    return new Response(JSON.stringify(data, null, 2), { headers: { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="memory-ai-${istDate()}.json"` } });
  }

  // ---------- Telegram setup ----------
  if (p === '/api/tg/setup' && m === 'POST') {
    if (!env.TELEGRAM_BOT_TOKEN || !env.TG_WEBHOOK_SECRET) return json({ error: 'Set TELEGRAM_BOT_TOKEN and TG_WEBHOOK_SECRET secrets first.' }, 400);
    const r = await setWebhook(env, url.origin);
    return json({ ok: !!r.ok, detail: r.description || null, ownerSet: !!env.OWNER_TG_ID });
  }
  if (p === '/api/tg/status' && m === 'GET') {
    if (!env.TELEGRAM_BOT_TOKEN) return json({ connected: false });
    const info = await webhookInfo(env);
    const hook = (info && info.result && info.result.url) || '';
    return json({ connected: hook.endsWith('/api/tg/hook'), url: hook, ownerSet: !!env.OWNER_TG_ID, lastError: info && info.result && info.result.last_error_message || null });
  }

  return json({ error: 'Not found.' }, 404);
}

async function chat(request, env, ctx) {
  const b = await readJson(request);
  const text = String(b.text || '').trim();
  if (!text) return json({ error: 'Say something first.' }, 400);
  const via = b.via === 'voice' ? 'voice' : 'text';
  const spoken = b.spoken === true;
  const settings = await getSettings(env);
  const gate = await beforeReply(env, settings, text);
  if (gate.updating) {                                  // update mode: she is silent (your words are saved as update notes)
    const lines = [{ type: 'meta', convId: b.convId || null, model: 'update-mode', at: now() }, { type: 'delta', text: gate.reply || '🔕' }, { type: 'done' }].map((o) => JSON.stringify(o) + '\n').join('');
    return new Response(new TextEncoder().encode(lines), { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache, no-transform' } });
  }
  if (gate.sleeping) {                                  // she is asleep: no AI. She shows "seen", keeps your message and answers in the morning
    const id = await sleepTurn(env, { convId: b.convId || null, text, source: 'web', via, reply: SEEN_LINE });
    const enc = new TextEncoder();
    const lines = [{ type: 'meta', convId: id, model: 'sleeping', sleeping: true, at: now() }, { type: 'delta', text: SEEN_LINE }, { type: 'done' }].map((o) => JSON.stringify(o) + '\n').join('');
    return new Response(enc.encode(lines), { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache, no-transform' } });
  }
  const prep = await prepareChat(env, { convId: b.convId || null, text, source: 'web', via, spoken, noteId: b.noteId || null, gate });

  let out;
  try { out = await openStream(env, { brain: prep.settings.brain, messages: prep.messages, temperature: 0.8, maxTokens: 1800 }); }
  catch (e) {
    // The user message is already saved; remove it so a retry does not duplicate it.
    if (prep.userMsgId) await env.DB.prepare('DELETE FROM messages WHERE id=?').bind(prep.userMsgId).run().catch(() => {});
    return json({ error: e.message }, e.status || 503);
  }

  // Keep the Worker alive until the reply is saved and memories are learned.
  let release; ctx.waitUntil(new Promise((r) => { release = r; }));
  const enc = new TextEncoder(), ac = new AbortController();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (o) => { try { controller.enqueue(enc.encode(JSON.stringify(o) + '\n')); } catch { /* client left */ } };
      send({ type: 'meta', convId: prep.convId, model: out.provider, fallback: out.fallback, at: now() });
      let full = '';
      try {
        full = await readStream(out.body, (t) => send({ type: 'delta', text: t }), ac.signal);
        if (!full.trim()) send({ type: 'error', error: "I couldn't think of a reply. Try again." });
        else send({ type: 'done' });
      } catch (e) {
        if (!ac.signal.aborted) send({ type: 'error', error: 'The reply was cut off. Please try again.' });
      }
      try { controller.close(); } catch { /* closed */ }
      try {
        if (full.trim()) await finishChat(env, { convId: prep.convId, userMsgId: prep.userMsgId, text, reply: full, model: out.id || out.provider, source: 'web', settings: prep.settings });
      } catch (e) { console.error('[finish]', e && e.message); }
      release();
    },
    cancel() { ac.abort(); },
  });
  return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' } });
}

async function deleteConversation(env, id) {
  const msgs = (await env.DB.prepare('SELECT id FROM messages WHERE conv_id=?').bind(id).all()).results || [];
  await env.DB.prepare('DELETE FROM messages WHERE conv_id=?').bind(id).run();
  await env.DB.prepare('DELETE FROM conversations WHERE id=?').bind(id).run();
  for (let i = 0; i < msgs.length; i += 100) await vecDelete(env, msgs.slice(i, i + 100).map((x) => 'c:' + x.id));
}

async function dump(env) {
  const all = (t) => env.DB.prepare(`SELECT * FROM ${t}`).all().then((r) => r.results || []);
  return {
    exportedAt: new Date().toISOString(),
    settings: await getSettings(env),
    conversations: await all('conversations'),
    messages: await all('messages'),
    memories: await all('memories'),
    scores: await all('scores'),
    notes: await all('notes'),
    tasks: await all('tasks'),
    moods: await all('moods'),
    habits: await all('habits'),
    dates: await all('dates'),
  };
}

// Weekly text backup kept in KV (free, no card). Keeps the newest 4. KV values max out at 25 MB, so a very
// large history drops the message bodies from the automatic copy; "Download all" always gives everything.
async function backup(env) {
  let data = await dump(env), trimmed = false;
  let body = JSON.stringify(data);
  if (body.length > 24 * 1024 * 1024) { data = { ...data, messages: [] }; body = JSON.stringify(data); trimmed = true; }
  const key = `backup:${istDate()}`;
  await env.KV.put(key, body);
  const list = await env.KV.list({ prefix: 'backup:' });
  const old = (list.keys || []).map((k) => k.name).sort().slice(0, -4);
  for (const k of old) await env.KV.delete(k);
  return { ok: true, key, memories: data.memories.length, messages: data.messages.length, trimmed };
}
