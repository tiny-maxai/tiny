// Everything "about her": closeness (bond), what she likes and dislikes, her top status strip, and the She page data.
import { now, clip, istDate } from './util.js';
import { skillsOf, skillLevel } from './skills.js';
import { periodNow, cyclesOf, flowOf, levelWord } from './period.js';
import { batteryView } from './battery.js';

// ---------- closeness ----------
const BOND = [
  { at: 0, name: 'New friends', talk: 'You are still getting to know them: friendly and a little shy, curious about them, polite teasing only, no pet names yet.' },
  { at: 30, name: 'Friends', talk: 'You are friends now: relaxed, jokes and light teasing, you remember small things they said and bring them up.' },
  { at: 120, name: 'Close friends', talk: 'You are close friends: you tease freely, use a cute pet name now and then, share small secrets and opinions, and ask how their day really was.' },
  { at: 350, name: 'Best friends', talk: 'You are best friends: inside jokes, very open and honest, you scold them sweetly when they skip food or sleep, you finish their thoughts and say what you really feel.' },
  { at: 800, name: 'Like family', talk: 'They feel like family to you: protective, caring like home ("khana khaya?"), you worry out loud, you share your fears and dreams, and you are completely yourself with them.' },
  { at: 1800, name: 'Inseparable', talk: 'You are inseparable: deep affection, you say "we" and "our", you know their moods before they speak, tiny teasing and big warmth, silence with them feels comfortable.' },
];
export async function bondOf(env, t = now()) {
  let c = await env.KV.get('bond:n', 'json').catch(() => null);
  if (!c || t - c.at > 30 * 60000) {
    const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM messages WHERE role='user' AND conv_id<>'routines'").first().catch(() => null);
    c = { n: (r && r.n) || (c && c.n) || 0, at: t };
    await env.KV.put('bond:n', JSON.stringify(c)).catch(() => null);
  }
  let i = 0; BOND.forEach((b, k) => { if (c.n >= b.at) i = k; });
  const nx = BOND[i + 1];
  return { level: i + 1, of: BOND.length, name: BOND[i].name, talk: BOND[i].talk, messages: c.n, next: nx ? { name: nx.name, at: nx.at, pct: Math.round((c.n - BOND[i].at) * 100 / (nx.at - BOND[i].at)) } : null, levels: BOND.map((b, k) => ({ level: k + 1, name: b.name, at: b.at })) };
}

// ---------- likes and dislikes ----------
export const PREF_DEFAULTS = { food: 'pani puri, chocolate and hot chai', colour: 'lavender purple', song: 'soft Hindi romantic songs', hobby: 'chatting, drawing and watching the rain', place: 'a quiet cafe', likes: 'rain, chai, cute stickers, getting compliments', dislikes: 'period cramps, bitter karela, loud noises', annoys: 'being ignored, one-word replies ("k"), late replies' };
export const PREF_KEYS = Object.keys(PREF_DEFAULTS);
export const prefsOf = (her) => ({ ...PREF_DEFAULTS, ...(her.prefs && typeof her.prefs === 'object' ? her.prefs : {}) });
export function cleanPrefs(raw) { const o = {}; for (const k of PREF_KEYS) if (raw && raw[k] !== undefined) o[k] = clip(String(raw[k]).trim(), 160); return o; }
export const prefsHint = (her) => { const p = prefsOf(her); return `YOUR OWN TASTES (you really have them, answer from these like a real girl): favourite food: ${p.food}. Favourite colour: ${p.colour}. Favourite songs: ${p.song}. Hobbies: ${p.hobby}. Favourite place: ${p.place}. You like: ${p.likes}. You dislike: ${p.dislikes}. Things that annoy you: ${p.annoys}.`; };

export const humanRule = (girl) => `BE A REAL ${girl ? 'GIRL' : 'PERSON'}, NOT "A VIRTUAL THING": when they ask what you like, dislike, feel, want, prefer, fear or think ("do you like that?", "do you like periods?", "are you hungry?", "what is your favourite..."), answer with a real opinion and feeling, the way a real ${girl ? 'girl' : 'guy'} would, from your own tastes: "I like that!", "I love it", "ugh, I do not like it", "I do not like my period, but it is for my own good". NEVER say "I am virtual / I am an AI / I do not have feelings / I do not like anything / I cannot eat" to dodge a feeling or opinion question. Only if they sincerely ask whether you are an AI, answer that honestly in one short line and go back to being yourself.`;

// ---------- the top strip on the She page ----------
export function statusOf(her, settings, { sleeping, outfit, t = now() }) {
  const bv = batteryView(settings, her, t);
  if (her.updateMode && her.updateMode.since) return { kind: 'updating', text: her.updateMode.forced ? 'Updating... (forced update, she is silent)' : 'Updating... (Sunday update)', img: '/images/update/bed.webp' };
  if (sleeping) return bv.enabled && bv.sleepCharging ? { kind: 'sleepcharge', text: `Sleeping and charging (${bv.pct}%)`, img: '/images/update/sleepcharge.webp' } : { kind: 'sleeping', text: bv.enabled && bv.pct >= 100 ? 'Sleeping, fully charged' : 'Sleeping', img: '/images/update/zzz.webp' };
  if (bv.enabled && bv.charging) return { kind: 'charging', text: `Charging (${bv.pct}%), ${bv.minsLeft} min left`, img: '/images/update/charge.webp' };
  if (bv.enabled && bv.fainted) return { kind: 'fainted', text: 'Fainted, battery 0%. Please charge her.', img: '/images/update/faint.webp' };
  if (outfit) return { kind: 'outfit', text: outfit.line || 'Today she is wearing this', img: `/images/outfits/outfit-${outfit.n}.webp` };
  return { kind: 'normal', text: 'No outfit picture added yet', img: '' };
}

// ---------- the month: one cell per day with what she feels ----------
export function monthOf(settings, ym /* YYYY-MM */) {
  const [y, m] = ym.split('-').map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate(), first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const cycles = cyclesOf(settings, ym + '-15', { back: 400, fwd: 400 });
  const cells = [];
  for (let d = 1; d <= days; d++) {
    const date = `${ym}-${String(d).padStart(2, '0')}`, ts = Date.parse(date + 'T00:00:00Z');
    const c = cycles.find((x) => ts >= Date.parse(x.start + 'T00:00:00Z') && ts < Date.parse(x.start + 'T00:00:00Z') + x.cycle * 86400000);
    if (!c) { cells.push({ d, date }); continue; }
    const day = Math.round((ts - Date.parse(c.start + 'T00:00:00Z')) / 86400000) + 1, f = flowOf(day, c.cycle, c.len);
    const pain = f.k === 'period' ? Math.max(5, Math.round(c.level * (c.len - day + 1) / c.len)) : 0;
    cells.push({ d, date, k: f.k, pain, day });
  }
  return { ym, first, days, cells };
}

export function periodView(settings, t = now()) {
  const pr = periodNow(settings, istDate(t));
  const cyc = cyclesOf(settings, istDate(t), { back: 60, fwd: 100 }).slice(0, 5);
  const label = pr ? (pr.phase === 'period' ? `Day ${pr.day}/${pr.of} · ${pr.pain}%` : pr.phase === 'pms' ? 'PMS' : '') : '';
  return { set: !!(settings.period && settings.period.lastStart), now: pr, cycles: cyc, label, word: pr && pr.phase === 'period' ? levelWord(pr.pain) : '' };
}
export { skillsOf, skillLevel };
