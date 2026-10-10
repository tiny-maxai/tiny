-- Run once: npm run db:init
CREATE TABLE IF NOT EXISTS conversations (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL DEFAULT 'New chat',
  source     TEXT NOT NULL DEFAULT 'web',      -- web | telegram
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conv_updated ON conversations(updated_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  conv_id    TEXT NOT NULL,
  role       TEXT NOT NULL,                    -- user | assistant
  content    TEXT NOT NULL,
  model      TEXT,
  via        TEXT,                             -- text | voice
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conv_id, id);

CREATE TABLE IF NOT EXISTS memories (
  id         TEXT PRIMARY KEY,
  text       TEXT NOT NULL,
  category   TEXT NOT NULL DEFAULT 'other',    -- profile | preference | project | people | plan | other
  importance INTEGER NOT NULL DEFAULT 3,       -- 1 to 5
  pinned     INTEGER NOT NULL DEFAULT 0,
  source     TEXT,                             -- auto | manual | telegram
  conv_id    TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mem_updated ON memories(updated_at DESC);

CREATE TABLE IF NOT EXISTS scores (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  game       TEXT NOT NULL,
  outcome    TEXT NOT NULL,                    -- win | loss | draw | done
  detail     TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scores_game ON scores(game);

-- Added in v2 ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS notes (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL DEFAULT 'Untitled',
  content    TEXT NOT NULL DEFAULT '',
  pinned     INTEGER NOT NULL DEFAULT 0,
  rev        INTEGER NOT NULL DEFAULT 1,       -- bumps on every save, stops stale edits overwriting newer ones
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes(updated_at DESC);

CREATE TABLE IF NOT EXISTS tasks (
  id               TEXT PRIMARY KEY,
  prompt           TEXT NOT NULL,
  run_at           INTEGER NOT NULL,           -- next time to run (ms)
  interval_minutes INTEGER,                    -- null = run once
  enabled          INTEGER NOT NULL DEFAULT 1,
  last_run         INTEGER,
  last_result      TEXT,
  created_at       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(enabled, run_at);

-- Added in v3 ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS moods (
  id         TEXT PRIMARY KEY,
  day        TEXT NOT NULL,                    -- India date, YYYY-MM-DD
  score      INTEGER NOT NULL,                 -- 1 (rough) to 5 (great)
  note       TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_moods_day ON moods(day);
