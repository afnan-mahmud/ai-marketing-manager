-- Soft-delete for competitors removed from business.yaml (keeps their history),
-- and a flag for the user's own brand, which is tracked with the same signals.
ALTER TABLE competitors ADD COLUMN active INTEGER NOT NULL DEFAULT 1;
ALTER TABLE competitors ADD COLUMN is_self INTEGER NOT NULL DEFAULT 0;

CREATE INDEX idx_ad_daily_ad ON ad_daily(ad_id, date);
CREATE INDEX idx_snapshots_competitor ON website_snapshots(competitor_id, url, fetched_at);
CREATE INDEX idx_market_date ON market_snapshots(date);
CREATE INDEX idx_reports_date ON reports(date, type);
