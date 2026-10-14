-- Canonical daily performance at AD level. Everything else is aggregated from this.
CREATE TABLE ad_daily (
  date            TEXT NOT NULL,          -- YYYY-MM-DD
  ad_id           TEXT NOT NULL,          -- from Meta, or hash(campaign|adset|ad name) for exports without ids
  ad_name         TEXT,
  adset_id        TEXT, adset_name TEXT,
  campaign_id     TEXT, campaign_name TEXT,
  objective       TEXT,
  spend           REAL DEFAULT 0,
  impressions     INTEGER DEFAULT 0,
  reach           INTEGER DEFAULT 0,
  clicks_all      INTEGER DEFAULT 0,
  link_clicks     INTEGER DEFAULT 0,
  landing_page_views INTEGER DEFAULT 0,
  add_to_cart     INTEGER DEFAULT 0,
  initiate_checkout INTEGER DEFAULT 0,
  purchases       INTEGER DEFAULT 0,
  purchase_value  REAL DEFAULT 0,
  leads           INTEGER DEFAULT 0,
  messages        INTEGER DEFAULT 0,      -- messaging conversations started
  video_3s_views  INTEGER DEFAULT 0,
  video_thruplays INTEGER DEFAULT 0,
  source          TEXT NOT NULL,          -- 'export' | 'api'
  imported_at     TEXT NOT NULL,
  PRIMARY KEY (date, ad_id)               -- re-imports UPSERT, never duplicate
);

CREATE TABLE ad_creatives (
  ad_id        TEXT PRIMARY KEY,
  headline     TEXT,
  primary_text TEXT,
  cta          TEXT,
  format       TEXT,                      -- image | video | carousel | unknown
  thumbnail_url TEXT,
  landing_url  TEXT,
  updated_at   TEXT
);

CREATE TABLE import_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT, file_name TEXT, rows_read INTEGER, rows_upserted INTEGER,
  date_min TEXT, date_max TEXT, warnings TEXT, created_at TEXT
);

CREATE TABLE competitors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL, website TEXT, facebook_page_id TEXT, notes TEXT
);

CREATE TABLE website_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  competitor_id INTEGER REFERENCES competitors(id),
  url TEXT, fetched_at TEXT, content_hash TEXT,
  title TEXT, meta_description TEXT,
  headings_json TEXT,        -- h1/h2/h3
  prices_json TEXT,          -- detected prices with context
  offers_json TEXT,          -- "% off", "free delivery", "buy 1 get 1", etc.
  ctas_json TEXT,            -- button/link texts
  social_proof_json TEXT,    -- review counts, ratings, testimonials detected
  raw_text_path TEXT         -- file in data/snapshots/
);

CREATE TABLE competitor_ads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  competitor_id INTEGER REFERENCES competitors(id),
  external_id TEXT,          -- Ad Library id if available
  first_seen TEXT, last_seen TEXT, start_date TEXT,
  is_active INTEGER,
  body TEXT, headline TEXT, cta TEXT, format TEXT, landing_url TEXT,
  platforms TEXT, source TEXT,   -- 'ad_library' | 'manual'
  UNIQUE(competitor_id, external_id)
);

CREATE TABLE competitor_signals (     -- manual or derived numbers used for positioning
  competitor_id INTEGER REFERENCES competitors(id),
  date TEXT, signal TEXT, value REAL, note TEXT,
  PRIMARY KEY (competitor_id, date, signal)
);

CREATE TABLE market_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT, sector TEXT,
  summary TEXT,              -- written by Claude
  trends_json TEXT,          -- [{trend, evidence, source_url}]
  sources_json TEXT,
  created_at TEXT
);

CREATE TABLE reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT, type TEXT,      -- daily_briefing | content_plan | competitor_report | ...
  title TEXT, file_path TEXT, created_at TEXT
);
