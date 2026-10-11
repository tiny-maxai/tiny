// Generated from schema.sql by scripts/gen-schema.mjs. Every statement is safe to run again.
export const STATEMENTS = [
  "CREATE TABLE IF NOT EXISTS conversations ( id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT 'New chat', source TEXT NOT NULL DEFAULT 'web', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL )",
  "CREATE INDEX IF NOT EXISTS idx_conv_updated ON conversations(updated_at DESC)",
  "CREATE TABLE IF NOT EXISTS messages ( id INTEGER PRIMARY KEY AUTOINCREMENT, conv_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, model TEXT, via TEXT, created_at INTEGER NOT NULL )",
  "CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conv_id, id)",
  "CREATE TABLE IF NOT EXISTS memories ( id TEXT PRIMARY KEY, text TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'other', importance INTEGER NOT NULL DEFAULT 3, pinned INTEGER NOT NULL DEFAULT 0, source TEXT, conv_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL )",
  "CREATE INDEX IF NOT EXISTS idx_mem_updated ON memories(updated_at DESC)",
  "CREATE TABLE IF NOT EXISTS scores ( id INTEGER PRIMARY KEY AUTOINCREMENT, game TEXT NOT NULL, outcome TEXT NOT NULL, detail TEXT, created_at INTEGER NOT NULL )",
  "CREATE INDEX IF NOT EXISTS idx_scores_game ON scores(game)",
  "CREATE TABLE IF NOT EXISTS notes ( id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT 'Untitled', content TEXT NOT NULL DEFAULT '', pinned INTEGER NOT NULL DEFAULT 0, rev INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL )",
  "CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes(updated_at DESC)",
  "CREATE TABLE IF NOT EXISTS tasks ( id TEXT PRIMARY KEY, prompt TEXT NOT NULL, run_at INTEGER NOT NULL, interval_minutes INTEGER, enabled INTEGER NOT NULL DEFAULT 1, last_run INTEGER, last_result TEXT, created_at INTEGER NOT NULL )",
  "CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(enabled, run_at)",
  "CREATE TABLE IF NOT EXISTS moods ( id TEXT PRIMARY KEY, day TEXT NOT NULL, score INTEGER NOT NULL, note TEXT, created_at INTEGER NOT NULL )",
  "CREATE INDEX IF NOT EXISTS idx_moods_day ON moods(day)",
  "CREATE INDEX IF NOT EXISTS idx_msg_created ON messages(created_at)",
  "CREATE TABLE IF NOT EXISTS habits ( day TEXT PRIMARY KEY, water INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL )",
  "CREATE TABLE IF NOT EXISTS dates ( id TEXT PRIMARY KEY, title TEXT NOT NULL, month INTEGER NOT NULL, day INTEGER NOT NULL, year INTEGER, kind TEXT NOT NULL DEFAULT 'birthday', created_at INTEGER NOT NULL )"
];
