// Creates any missing tables the first time the Worker runs (all statements use IF NOT EXISTS), so there is no separate database step.
import { STATEMENTS } from './schema.js';

let ready = null;
export function ensureSchema(env) {
  if (!ready) ready = env.DB.batch(STATEMENTS.map((s) => env.DB.prepare(s))).then(() => true).catch((e) => { ready = null; console.error('[schema]', e && e.message); return false; });
  return ready;
}
