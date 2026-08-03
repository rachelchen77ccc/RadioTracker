CREATE TABLE IF NOT EXISTS dramas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  missevan_id INTEGER,
  title TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT '猫耳',
  source TEXT NOT NULL DEFAULT 'manual',
  kind TEXT,
  categories TEXT NOT NULL DEFAULT '[]',
  organization TEXT,
  abstract TEXT,
  cover_url TEXT,
  cover_local TEXT,
  status TEXT,
  purchased INTEGER NOT NULL DEFAULT 0,
  subscribed INTEGER NOT NULL DEFAULT 0,
  heard_episodes INTEGER,
  total_episodes INTEGER,
  rating REAL,
  finished_date TEXT,
  rewatch_queued INTEGER NOT NULL DEFAULT 0,
  rewatch_status TEXT,
  review TEXT,
  serialize_status TEXT,
  update_info TEXT,
  update_day TEXT,
  price REAL,
  sync_saw_episode TEXT,
  sync_total_episodes INTEGER,
  sync_newest TEXT,
  sync_serialize TEXT,
  sync_purchased INTEGER,
  sync_subscribed INTEGER,
  synced_at TEXT,
  bought_order INTEGER,
  sub_order INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0,
  detail_error TEXT,
  detail_fetched_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS dramas_user_missevan_idx
  ON dramas(user_id, missevan_id) WHERE missevan_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS dramas_user_status_idx ON dramas(user_id, status);
CREATE INDEX IF NOT EXISTS dramas_user_bought_idx ON dramas(user_id, purchased, bought_order);
CREATE INDEX IF NOT EXISTS dramas_user_sub_idx ON dramas(user_id, subscribed, sub_order);

CREATE TABLE IF NOT EXISTS cvs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  missevan_id INTEGER,
  avatar_url TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, name)
);

CREATE UNIQUE INDEX IF NOT EXISTS cvs_user_missevan_idx
  ON cvs(user_id, missevan_id) WHERE missevan_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS drama_cvs (
  drama_id INTEGER NOT NULL REFERENCES dramas(id) ON DELETE CASCADE,
  cv_id INTEGER NOT NULL REFERENCES cvs(id) ON DELETE CASCADE,
  role_type TEXT NOT NULL DEFAULT '主役',
  character TEXT,
  PRIMARY KEY (drama_id, cv_id, role_type)
);

CREATE INDEX IF NOT EXISTS drama_cvs_cv_idx ON drama_cvs(cv_id);

CREATE TABLE IF NOT EXISTS sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  ran_at TEXT NOT NULL DEFAULT (datetime('now')),
  kind TEXT NOT NULL,
  added INTEGER NOT NULL DEFAULT 0,
  updated INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0,
  detail TEXT
);

CREATE INDEX IF NOT EXISTS sync_log_user_idx ON sync_log(user_id, id DESC);

CREATE TABLE IF NOT EXISTS user_missevan_credentials (
  user_id TEXT PRIMARY KEY,
  missevan_user_id TEXT NOT NULL,
  credential_ciphertext TEXT NOT NULL,
  credential_iv TEXT NOT NULL,
  saved_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sync_jobs (
  user_id TEXT PRIMARY KEY,
  running INTEGER NOT NULL DEFAULT 0,
  step TEXT,
  log TEXT NOT NULL DEFAULT '[]',
  error TEXT,
  expired INTEGER NOT NULL DEFAULT 0,
  started_at TEXT,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS migration_state (
  user_id TEXT PRIMARY KEY,
  completed_at TEXT,
  source_checksum TEXT
);
