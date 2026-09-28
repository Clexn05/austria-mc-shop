CREATE TABLE IF NOT EXISTS rank_checks (
  id TEXT PRIMARY KEY,
  minecraft_name TEXT NOT NULL,
  target_group TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK(status IN ('PENDING','ALLOWED','BLOCKED','FAILED')),
  current_group TEXT,
  message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_rank_checks_status_created
  ON rank_checks(status, created_at);
