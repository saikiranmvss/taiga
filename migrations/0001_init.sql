-- Local/app state only (Taiga remains source of truth)

CREATE TABLE IF NOT EXISTS user_prefs (
  taiga_user_id INTEGER PRIMARY KEY,
  email TEXT,
  username TEXT,
  last_login_at TEXT,
  last_app_seen_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ticket_reads (
  taiga_user_id INTEGER NOT NULL,
  item_type TEXT NOT NULL, -- userstory | task | issue
  item_id INTEGER NOT NULL,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY (taiga_user_id, item_type, item_id)
);

CREATE INDEX IF NOT EXISTS idx_ticket_reads_user
  ON ticket_reads (taiga_user_id, last_seen_at);
