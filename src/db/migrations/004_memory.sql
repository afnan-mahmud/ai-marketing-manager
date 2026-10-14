-- The marketing manager's memory for one client: lessons learned (what to do, what to avoid, insights), with evidence
-- and how often they were confirmed or contradicted. Written by Claude via record_learning; ranked by the server.
CREATE TABLE learnings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,                     -- do | avoid | insight
  category TEXT NOT NULL,                 -- creative | copy | offer | audience | budget | funnel | timing | market | competitor | general
  statement TEXT NOT NULL,
  evidence TEXT,
  source TEXT NOT NULL,                   -- daily_briefing | weekly_review | action_outcome | user | other
  confidence TEXT NOT NULL,               -- low | medium | high
  confirmations INTEGER NOT NULL DEFAULT 1,
  contradictions INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',  -- active | retired
  tags_json TEXT NOT NULL DEFAULT '[]',
  related_json TEXT NOT NULL DEFAULT '[]', -- ad/ad set/campaign names or ids the lesson is based on
  history_json TEXT NOT NULL DEFAULT '[]', -- [{at, event, note}]
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_confirmed_at TEXT NOT NULL
);
CREATE INDEX idx_learnings_status ON learnings(status, category);

-- Results of confirmed Ads Manager changes, so each change can be judged later and turned into a lesson.
ALTER TABLE ad_actions ADD COLUMN outcome_json TEXT;
ALTER TABLE ad_actions ADD COLUMN outcome_reviewed_at TEXT;
ALTER TABLE ad_actions ADD COLUMN learning_id INTEGER;
