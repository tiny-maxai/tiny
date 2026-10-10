// Memory AI: one Worker serves the website (public/) and the API (/api/*).
import { json, now, uid, istDate, plainForSpeech } from './lib/util.js';
import { checkAuth, login } from './lib/auth.js';
import { getSettings, saveSettings } from './lib/settings.js';
import { openStream, readStream, candidates } from './lib/ai.js';
import { prepareChat, finishChat } from './lib/chat.js';
import { remember, forget, updateMemory, vecDelete, getPending, resolvePending } from './lib/memory.js';
import { listNotes, getNote, createNote, saveNote, deleteNote } from './lib/notes.js';
import { listTasks, createTask, parseTask, runTask, runDueTasks } from './lib/tasks.js';
import { speechToText, textToSpeech } from './lib/voice.js';
import { addSub, removeSub, listSubs, sendPush, pushReady } from './lib/push.js';
import { notifyOwner } from './lib/notify.js';
import { saveMood, listMoods, deleteMood, moodReply } from './lib/moods.js';
import { runCare, careTick } from './lib/care.js';
import { getToday } from './lib/today.js';
import { playTurn } from './lib/play.js';
import { handleUpdate, setWebhook, webhookInfo } from './lib/telegram.js';

const MAX_BODY = 25 * 1024 * 1024; // 25 MB, enough for long voice clips. This is a safety size, not a usage limit.

async function readJson(request) {
  try { return await request.json(); } catch { return {}; }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const p = url.pathname;
    if (!p.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      return await route(request, env, ctx, url, p);
    } catch (e) {
      console.error('[api]', p, e && e.stack || e);
      return json({ error: e.message || 'Something went wrong.' }, e.status || 500);
    }
  },

  async scheduled(event, env, ctx) {
    if (event.cron === '* * * * *') {
      ctx.waitUntil(runDueTasks(env).catch((e) => console.error('[tasks]', e)));
      ctx.waitUntil(careTick(env, event.scheduledTime).catch((e) => console.error('[care]', e)));
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
    if (m === 'GET') return json(await getSettings(env));
    if (m === 'PUT') return json(await saveSettings(env, await readJson(request)));
  }

  // ---------- chat (streams newline-delimited JSON) ----------
  if (p === '/api/chat' && m === 'POST') return chat(request, env, ctx);

  // ---------- conversations ----------
  if (p === '/api/conversations' && m === 'GET') {
    const q = (url.searchParams.get('q') || '').trim();
    const r = q
      ? await env.DB.prepare('SELECT DISTINCT c.id,c.title,c.source,c.updated_at FROM conversations c LEFT JOIN messages m ON m.conv_id=c.id WHERE c.title LIKE ?1 OR m.content LIKE ?1 ORDER BY c.updated_at DESC LIMIT 100').bind(`%${q}%`).all()
      : await env.DB.prepare('SELECT id,title,source,updated_at FROM conversations ORDER BY updated_at DESC LIMIT 500').all();
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
      const v = await textToSpeech(env, text, { gender: st.persona.gender, language: st.persona.language, voice: st.persona.gender === 'boy' ? st.voice.boy : st.voice.girl });
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
  if (p === '/api/care/run' && m === 'POST') { const b = await readJson(request); return json(await runCare(env, { force: ['mood', 'miss'].includes(b.what) ? b.what : null })); }

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
  const prep = await prepareChat(env, { convId: b.convId || null, text, source: 'web', via, spoken, noteId: b.noteId || null });

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
