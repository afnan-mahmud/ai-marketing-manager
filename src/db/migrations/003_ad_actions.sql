-- Changes to Meta (new ads, status, budgets, duplicates) are proposed first and executed only after the user
-- confirms. Every proposal and its outcome is kept here as an audit log.
CREATE TABLE ad_actions (
  id TEXT PRIMARY KEY,           -- short random id shown to the user
  type TEXT NOT NULL,            -- new_ad | status_change | budget_change | duplicate
  status TEXT NOT NULL,          -- pending | executing | executed | failed | cancelled | expired
  summary TEXT NOT NULL,         -- one-line human description
  params_json TEXT NOT NULL,     -- validated parameters used at execution
  preview_json TEXT NOT NULL,    -- what the user saw before confirming
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  decided_at TEXT,
  confirmed_via TEXT,            -- elicitation | tool_permission
  result_json TEXT,              -- ids created/changed (also partial results on failure)
  error TEXT
);
CREATE INDEX idx_ad_actions_status ON ad_actions(status, created_at);
