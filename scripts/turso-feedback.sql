-- the feedback table (the api/feedback.ts function also creates it on first use)
CREATE TABLE IF NOT EXISTS roll_coal_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT,          -- comma-separated: bug, idea, balance, other
  message TEXT NOT NULL,
  name TEXT,
  version TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
