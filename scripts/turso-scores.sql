-- the high-score table (the api/scores.ts function also creates it on first use)
CREATE TABLE IF NOT EXISTS roll_coal_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  score REAL NOT NULL,
  grade TEXT,
  depth INTEGER,
  hours INTEGER,
  cost INTEGER,
  approval REAL,
  incidents INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
