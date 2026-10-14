# AI Marketing Manager — MCP Server (Architecture & Build Spec)

> **For Claude Code:** This document is the single source of truth for building this project.
> Build it phase by phase (see §14). Do not skip the acceptance criteria. When something here is
> ambiguous, choose the simplest option that satisfies the acceptance criteria and note it in `DECISIONS.md`.
>
> **Status:** all phases (0–7) are implemented, plus §18 (agency workspace: one project per client) and §19
> (confirm-first Ads Manager changes). Where the implementation had to choose or deviate
> (e.g. Node ≥ 22, `exceljs` instead of `xlsx`, the own brand stored as an `is_self` competitor), the reasoning is in
> [`DECISIONS.md`](DECISIONS.md).

---

## 1. What this project is

An **open-source MCP (Model Context Protocol) server, written in TypeScript**, that turns Claude
(Claude Desktop, Claude Code, or any MCP client) into a **personal AI marketing manager** for a
business running Meta (Facebook/Instagram) ads.

Anyone can clone the public repo, add their own data and keys, connect it to Claude, and ask things like:

- "Give me today's marketing briefing."
- "Which of my ads are winning and which should I kill?"
- "How am I doing vs. my competitors?"
- "Plan next week's content and write 3 video script ideas based on my best ads."
- "What should I change in my next campaign to get more sales?"

### Core design principle

> **The server supplies facts. Claude supplies judgment.**

| Layer                       | Responsibility                                                                                                                                       |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **MCP server (this repo)**  | Load data, normalize it, compute metrics deterministically, store history, fetch competitor websites/ads, save reports. Returns **structured JSON**. |
| **Claude (the client)**     | Reasoning: interpreting numbers, strategy, content plans, scripts, recommendations. Also does live web research with its own web search.             |
| **MCP prompts (this repo)** | Pre-written workflows that tell Claude which tools to call, in what order, and how to format the output.                                             |

The server must **never** call an LLM itself. All "intelligence" happens in the client.
This keeps the server cheap, testable, and model-agnostic.

---

## 2. Feature scope

### In scope (v1)

1. **Own ad data ingestion** — from Meta Ads Manager CSV/XLSX exports dropped in a folder, _or_ pulled daily from the Meta Marketing API.
2. **Performance analytics** — KPIs, trends, period comparisons, winners/losers, creative fatigue, budget efficiency.
3. **Business profile** — the user's sector, product, audience, goals, KPI targets, and competitor list (config file).
4. **Competitor tracking** — competitor website snapshots (offers, pricing, CTAs, content), change detection, competitor ads (Ad Library API where available + manual import).
5. **Competitive positioning** — an _estimated_ ranking of the user vs. competitors using observable signals (see §8.4 — real sales data is not public).
6. **Market snapshots** — store the market/trend findings Claude researches each day so history builds up.
7. **Workflows (MCP prompts)** — daily briefing, ad optimization plan, content plan, script ideas, sales growth ideas, competitor report.
8. **Reports** — save each briefing as Markdown in `data/reports/` for history.

### Out of scope (v1) — do NOT build

- ~~Creating, editing, pausing, or changing budgets on ads~~ — added later as **confirm-first** actions (§19): nothing
  runs without the user's explicit confirmation of a preview, and it is off per project by default.
- Any LLM API calls from the server.
- Scraping behind logins, bypassing robots.txt, or scraping Facebook/Instagram pages directly.
- A web UI/dashboard (possible v2).
- Multi-user / multi-tenant hosting. It runs locally per user.
- Google Ads, TikTok Ads (design the ingestion layer so they can be added later as new "sources").

---

## 3. Tech stack

| Concern      | Choice                                                            | Why                                                                                                                                              |
| ------------ | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Language     | TypeScript (strict), Node.js ≥ 22                                 | User choice; MCP SDK is first-class in TS. (Spec said ≥ 20; Node 20 is end-of-life and current better-sqlite3/vitest need 22 — see DECISIONS.md) |
| MCP          | `@modelcontextprotocol/sdk` (`McpServer`, `StdioServerTransport`) | Official SDK                                                                                                                                     |
| Validation   | `zod`                                                             | Tool input schemas + config validation                                                                                                           |
| Storage      | SQLite via `better-sqlite3`                                       | Zero-setup, local, great for daily time series                                                                                                   |
| CSV/XLSX     | `papaparse` + `exceljs`                                           | Meta exports come in both. (Spec said SheetJS `xlsx`; the npm release has unfixed advisories — see DECISIONS.md)                                 |
| HTTP         | native `fetch`                                                    | No extra dependency                                                                                                                              |
| HTML parsing | `cheerio`                                                         | Competitor website extraction                                                                                                                    |
| Config       | `.env` (`dotenv`) + `config/business.yaml` (`yaml`)               | Secrets vs. business settings                                                                                                                    |
| Dates        | `date-fns`                                                        | Period math                                                                                                                                      |
| Tests        | `vitest`                                                          | Fast, TS-native                                                                                                                                  |
| Lint/format  | `eslint` + `prettier`                                             | Contributor friendliness                                                                                                                         |
| Build        | `tsc` → `dist/`, run with `node dist/index.js`                    | Simple                                                                                                                                           |

**Logging rule:** the server talks over stdio, so **never write to stdout** except MCP messages.
All logs go to `stderr` via a small logger (`src/utils/logger.ts`).

---

## 4. High-level architecture

```
                ┌──────────────────────────────────────────────┐
                │  Claude (Desktop / Code / any MCP client)    │
                │  - reasoning, strategy, scripts              │
                │  - its own web search for market research    │
                └───────────────┬──────────────────────────────┘
                                │ MCP over stdio
┌───────────────────────────────▼──────────────────────────────────────┐
│                         MCP SERVER (this repo)                       │
│                                                                      │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐                           │
│  │  Tools   │  │ Prompts  │  │ Resources │   ← MCP surface (src/mcp) │
│  └────┬─────┘  └──────────┘  └─────┬─────┘                           │
│       │                            │                                 │
│  ┌────▼────────────────────────────▼───────────────────────────────┐ │
│  │                       Services (src/services)                   │ │
│  │  AdsService · AnalyticsService · CompetitorService ·            │ │
│  │  MarketService · PositioningService · ReportService             │ │
│  └────┬──────────────┬──────────────────┬──────────────────────────┘ │
│       │              │                  │                            │
│  ┌────▼─────┐  ┌─────▼──────┐   ┌───────▼────────┐                   │
│  │ Sources  │  │ Analytics  │   │  Repositories  │                   │
│  │ csv/xlsx │  │ engine     │   │  (SQLite)      │                   │
│  │ meta api │  │ pure funcs │   │                │                   │
│  │ adlibrary│  └────────────┘   └───────┬────────┘                   │
│  │ web fetch│                           │                            │
│  └────┬─────┘                           │                            │
└───────┼─────────────────────────────────┼────────────────────────────┘
        │                                 │
  ┌─────▼─────────────┐          ┌────────▼─────────┐
  │ <project>/inbox/  │          │ <project>/app.db │
  │ Meta Graph API    │          │ <project>/reports│
  │ competitor sites  │          │ <project>/snapsh.│
  └───────────────────┘          └──────────────────┘
```

**Layering rules**

- `mcp/` only parses input, calls a service, and formats output. No business logic.
- `services/` orchestrate sources, analytics, and repositories.
- `analytics/` is **pure functions only** (no I/O) → easy to unit test.
- `sources/` only fetch/parse external data and return normalized types.
- `db/` is the only place that touches SQLite.

---

## 5. Repository structure

```
ai-marketing-manager/
├── README.md                    # what it is, quick start, examples, tool reference
├── ARCHITECTURE.md              # this file
├── CLAUDE.md                    # short rules for Claude Code contributors (see §16)
├── DECISIONS.md                 # log of design decisions made during build
├── CONTRIBUTING.md
├── LICENSE                      # MIT
├── .env.example
├── .gitignore                   # ignores .env and projects/*
├── .github/                     # CI workflow, issue templates, PR template
├── package.json
├── tsconfig.json / tsconfig.build.json
├── vitest.config.ts / eslint.config.js / .prettierrc.json
│
├── config/
│   └── business.example.yaml    # template; user copies to business.yaml
│
├── projects/                    # agency workspace — gitignored except .gitkeep (see §18)
│   ├── .active                  # active project slug
│   └── <client-slug>/           # one folder per client project
│       ├── project.json  business.yaml  project.env  app.db
│       └── inbox/ processed/ competitors/ snapshots/ reports/
│
├── examples/
│   ├── sample-meta-export.csv   # realistic fake data for testing & demos (scripts/generate-sample-data.mjs)
│   ├── competitor-ads-template.csv
│   └── claude_desktop_config.json
│
├── scripts/
│   ├── copy-assets.mjs          # copies .sql/.md assets into dist/ at build
│   ├── generate-sample-data.mjs # deterministic sample export generator
│   └── smoke-test.mjs           # runs the built server over stdio against the sample
│
├── src/
│   ├── index.ts                 # entry: load config, init db, start stdio server
│   ├── server.ts                # creates McpServer, registers tools/prompts/resources
│   ├── workspace.ts             # agency workspace: create/list/resolve/archive client projects, per-project contexts
│   ├── context.ts               # AppContext for ONE project: env, paths, db, repos, services, clock, fetch
│   │
│   ├── config/
│   │   ├── env.ts               # zod-validated env vars
│   │   ├── paths.ts             # project-root-relative path resolution
│   │   └── business.ts          # load + validate + comment-preserving update of business.yaml
│   │
│   ├── types/                   # ads.ts, metrics.ts, competitor.ts, market.ts
│   │
│   ├── db/
│   │   ├── client.ts            # opens SQLite, runs migrations
│   │   ├── migrations/          # 001_init.sql, 002_..., applied in order
│   │   └── repositories/        # adsRepo, competitorRepo, marketRepo, reportRepo
│   │
│   ├── sources/
│   │   ├── metaExport/          # parser.ts (CSV/XLSX → canonical rows), columnMap.ts (header aliases)
│   │   ├── metaApi/             # client.ts (auth, paging, retries, rate limits), insights.ts, creatives.ts
│   │   ├── adLibrary/client.ts  # Meta Ad Library API (limited — see §8.3) + public URL builder
│   │   └── web/                 # fetcher.ts (polite fetch), robots.ts, extractor.ts (cheerio)
│   │
│   ├── analytics/               # PURE functions, no I/O
│   │   ├── metrics.ts           # derived KPIs + metric definitions (glossary source)
│   │   ├── aggregate.ts         # group by ad/adset/campaign/day, sum then derive
│   │   ├── compare.ts           # period-over-period deltas
│   │   ├── classify.ts          # winner / loser / learning / average verdicts
│   │   ├── fatigue.ts           # creative fatigue detection
│   │   ├── budget.ts            # spend efficiency & reallocation candidates
│   │   ├── diagnostics.ts       # funnel steps + rule-based problem flags
│   │   ├── snapshotDiff.ts      # website snapshot diffs
│   │   ├── trends.ts            # recurring market trend grouping
│   │   └── positioning.ts       # competitor scoring model
│   │
│   ├── services/                # setup, ads, analytics, competitor, positioning, market, report
│   │
│   ├── mcp/
│   │   ├── tooling.ts           # defineTool, input validation, error → isError mapping
│   │   ├── tools/               # one file per tool group (see §9)
│   │   ├── prompts/             # one file per workflow prompt (see §10)
│   │   └── resources/           # see §11 (playbook.md, generated glossary)
│   │
│   └── utils/                   # logger (stderr), dates, money, errors, slug
│
└── tests/
    ├── fixtures/                # export variants, Graph API JSON, competitor HTML pages
    ├── helpers/                 # test context (temp data dir, in-memory db, fake fetch/clock)
    ├── analytics/*.test.ts
    ├── sources/*.test.ts
    └── mcp/*.test.ts            # tool handlers + full MCP client/server round trips
```

---

## 6. Configuration

### 6.1 `.env` (secrets — never committed)

```dotenv
# Agency workspace: one folder per client project (default: ./projects)
PROJECTS_DIR=./projects

# --- Meta Marketing API (optional; folder import works without it) ---
META_ACCESS_TOKEN=            # long-lived token with ads_read permission
META_AD_ACCOUNT_ID=           # per project only: projects/<client>/project.env (never global)
META_API_VERSION=v21.0        # keep configurable; check Meta's current version

# --- Meta Ad Library API (optional) ---
META_AD_LIBRARY_TOKEN=        # can be same token if app has Ad Library access

# --- Web fetching ---
WEB_USER_AGENT=AIMarketingManagerBot/1.0 (+https://github.com/<you>/ai-marketing-manager)
WEB_TIMEOUT_MS=15000
```

(Implemented: `PROJECTS_DIR` and `LOG_LEVEL`; `DATA_DIR` was replaced by per-project folders and the ad account id
moved to each project's `project.env` — see §18.)

### 6.2 `projects/<client>/business.yaml` (business profile per project — gitignored, example in `config/`)

```yaml
business:
  name: "My Brand"
  sector: "skincare" # used to frame market research
  country: "BD" # ISO code; used for Ad Library + market context
  currency: "BDT"
  language: "bn" # language for content/script suggestions
  website: "https://mybrand.com"
  products:
    - name: "Vitamin C Serum"
      price: 1200
      margin_pct: 45
  target_audience: "Women 20-35, urban, Dhaka & Chattogram"
  brand_voice: "friendly, honest, science-backed"

goals:
  primary_kpi: "purchases" # purchases | leads | messages | link_clicks
  targets: # used to classify ads; all optional
    max_cpa: 400
    min_roas: 2.5
    min_ctr_pct: 1.2
  monthly_budget: 150000

classification: # thresholds for winner/loser logic
  min_spend_for_verdict: 1000 # below this, ad is "learning"
  min_impressions_for_verdict: 3000
  fatigue_frequency: 3.0

competitors:
  - name: "Competitor A"
    website: "https://competitor-a.com"
    facebook_page_id: "" # optional, for Ad Library
    notes: "market leader, heavy influencer content"
  - name: "Competitor B"
    website: "https://competitor-b.com"
```

Validate with zod at startup. If the file is missing, the server still starts, and tools that need it
return a clear message: _"This project has no business profile yet — run setup_wizard / update_business_profile"_.
Tool `update_business_profile` lets Claude edit this file conversationally (see §9).
(Implemented extras: `extra_urls` for the business and each competitor, and `positioning.weights`.)

---

## 7. Data model (SQLite)

`src/db/migrations/001_init.sql` implements the tables below verbatim; `002_competitor_flags_and_indexes.sql` adds
`competitors.active` (soft delete), `competitors.is_self` (own brand) and indexes.

```sql
-- Canonical daily performance at AD level. Everything else is aggregated from this.
CREATE TABLE ad_daily (
  date TEXT NOT NULL, ad_id TEXT NOT NULL, ad_name TEXT,
  adset_id TEXT, adset_name TEXT, campaign_id TEXT, campaign_name TEXT, objective TEXT,
  spend REAL DEFAULT 0, impressions INTEGER DEFAULT 0, reach INTEGER DEFAULT 0,
  clicks_all INTEGER DEFAULT 0, link_clicks INTEGER DEFAULT 0, landing_page_views INTEGER DEFAULT 0,
  add_to_cart INTEGER DEFAULT 0, initiate_checkout INTEGER DEFAULT 0, purchases INTEGER DEFAULT 0,
  purchase_value REAL DEFAULT 0, leads INTEGER DEFAULT 0, messages INTEGER DEFAULT 0,
  video_3s_views INTEGER DEFAULT 0, video_thruplays INTEGER DEFAULT 0,
  source TEXT NOT NULL,          -- 'export' | 'api'
  imported_at TEXT NOT NULL,
  PRIMARY KEY (date, ad_id)      -- re-imports UPSERT, never duplicate
);
CREATE TABLE ad_creatives (ad_id TEXT PRIMARY KEY, headline TEXT, primary_text TEXT, cta TEXT,
  format TEXT, thumbnail_url TEXT, landing_url TEXT, updated_at TEXT);
CREATE TABLE import_log (id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT, file_name TEXT, rows_read INTEGER,
  rows_upserted INTEGER, date_min TEXT, date_max TEXT, warnings TEXT, created_at TEXT);
CREATE TABLE competitors (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, website TEXT,
  facebook_page_id TEXT, notes TEXT);
CREATE TABLE website_snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT, competitor_id INTEGER REFERENCES competitors(id),
  url TEXT, fetched_at TEXT, content_hash TEXT, title TEXT, meta_description TEXT, headings_json TEXT,
  prices_json TEXT, offers_json TEXT, ctas_json TEXT, social_proof_json TEXT, raw_text_path TEXT);
CREATE TABLE competitor_ads (id INTEGER PRIMARY KEY AUTOINCREMENT, competitor_id INTEGER REFERENCES competitors(id),
  external_id TEXT, first_seen TEXT, last_seen TEXT, start_date TEXT, is_active INTEGER, body TEXT, headline TEXT,
  cta TEXT, format TEXT, landing_url TEXT, platforms TEXT, source TEXT, UNIQUE(competitor_id, external_id));
CREATE TABLE competitor_signals (competitor_id INTEGER REFERENCES competitors(id), date TEXT, signal TEXT,
  value REAL, note TEXT, PRIMARY KEY (competitor_id, date, signal));
CREATE TABLE market_snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT, sector TEXT, summary TEXT,
  trends_json TEXT, sources_json TEXT, created_at TEXT);
CREATE TABLE reports (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT, type TEXT, title TEXT, file_path TEXT,
  created_at TEXT);
```

---

## 8. Modules in detail

### 8.1 Own-ads ingestion

**A) Folder import (always available)**

- User exports from Ads Manager (Ads level, breakdown "Day") as CSV or XLSX into the project's `inbox/` (`projects/<client>/inbox/`).
- `columnMap.ts` maps known header variants to canonical fields. Meta export headers change
  over time and by language/settings, so the map is a list of aliases per field, e.g.
  `link_clicks: ["Link clicks", "Clicks (link)", "Link Clicks"]`,
  `purchases: ["Purchases", "Website purchases", "Results" (only when result type = purchase)]`.
- Unknown columns are ignored and reported as warnings. Missing required columns
  (date, ad name, spend, impressions) → the file is rejected with a clear message listing what was found.
- If the export has no "Day" column (a single total row per ad), import it with `date = reporting end date`
  and add a warning that daily trends won't be available.
- Rows are UPSERTed on `(date, ad_id)`. After success, move file to `data/processed/YYYYMMDD-HHmm_<name>`.
- Numbers: strip currency symbols, thousands separators, handle "—"/empty as 0.

**B) Meta Marketing API (optional)**

- `GET /{version}/act_{AD_ACCOUNT_ID}/insights` with
  `level=ad`, `time_increment=1`, `time_range={since,until}`,
  `fields=ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,objective,spend,impressions,reach,clicks,inline_link_clicks,actions,action_values,video_thruplay_watched_actions`.
- Map `actions[]` by `action_type` (e.g. `purchase` / `offsite_conversion.fb_pixel_purchase`,
  `landing_page_view`, `add_to_cart`, `initiate_checkout`, `lead`,
  `onsite_conversion.messaging_conversation_started_7d`, `video_view` for 3-sec views).
  Kept in one config object (`ACTION_TYPE_MAP`) so it's easy to fix; overlapping types are picked by priority, never summed.
- Handle paging (`paging.next`), retries with exponential backoff on 429/5xx, and Meta rate-limit
  headers. Default sync window: last 7 days (re-pull to capture late attribution).
- Creatives: `GET /{ad_id}?fields=creative{title,body,call_to_action_type,thumbnail_url,object_type}`
  → `ad_creatives` (implemented as batched `?ids=` requests of 50).
- Token needs only `ads_read`. Never request write permissions.

### 8.2 Analytics engine (pure functions)

**Derived metrics** (always computed from summed raw counts, never by averaging ratios):

| Metric            | Formula                                                     |
| ----------------- | ----------------------------------------------------------- |
| CTR (link)        | link_clicks / impressions                                   |
| CPC (link)        | spend / link_clicks                                         |
| CPM               | spend / impressions × 1000                                  |
| Frequency         | impressions / reach                                         |
| CPA               | spend / primary conversions (per `goals.primary_kpi`)       |
| ROAS              | purchase_value / spend                                      |
| Conversion rate   | conversions / link_clicks                                   |
| LPV rate          | landing_page_views / link_clicks (landing page/load issues) |
| Hook rate (video) | video_3s_views / impressions                                |
| Hold rate (video) | video_thruplays / video_3s_views                            |
| Funnel drop-offs  | LPV → ATC → IC → Purchase step rates                        |

Divide-by-zero → `null`, never `Infinity`/`NaN`.

**Classification** (`classify.ts`) — each ad gets one verdict + reasons:

- `learning` — below `min_spend_for_verdict` or `min_impressions_for_verdict`.
- `winner` — meets CPA/ROAS target (or top quartile of account on primary KPI cost if no targets).
- `loser` — CPA > 1.5× target (or bottom quartile) with enough data.
- `fatigued` — was a winner, but last 3-7 days: frequency ≥ threshold **and** CTR down ≥ 20% vs. its own earlier period **and/or** CPA up ≥ 25%.
- `average` — everything else.
  Reasons are machine-readable codes + numbers (e.g. `{code:"CPA_ABOVE_TARGET", value:520, target:400}`)
  so Claude can explain them.

**Comparisons** (`compare.ts`) — current vs. previous equal-length period, % delta per metric,
direction flag (`better|worse|flat`) that knows which metrics are "lower is better" (CPA, CPC, CPM).

**Budget** (`budget.ts`) — share of spend vs. share of conversions per campaign/adset;
list "over-funded losers" and "under-funded winners" as reallocation candidates (suggestions only).

**Diagnostics hints** (`diagnostics.ts`) — rule-based flags Claude can expand on:
low hook rate → creative opening problem; good CTR + low LPV rate → landing page speed;
good LPV + low ATC → offer/price/page problem; high ATC + low purchase → checkout/trust/delivery problem;
rising CPM + stable CTR → audience saturation/competition.

### 8.3 Competitor module

**Website tracking** (`sources/web`)

- Fetch homepage + optional extra URLs per competitor (product/pricing pages configured in yaml).
- Respect `robots.txt`, 1 request/sec per domain, timeout, 3 MB cap, no login, no JS rendering in v1.
- Extract: title, meta description, H1-H3, detected prices (regex for ৳/Tk/BDT/$ etc. with surrounding text),
  offer phrases (discount %, free delivery, COD, bundles, limited time), CTA texts, social proof
  (ratings, review counts, "x customers").
- Store snapshot; compute `content_hash`; `diff` against previous snapshot → added/removed
  headings, offers, prices. This is how "what changed at Competitor A this week" works.

**Competitor ads**

- **Meta Ad Library API** (`ads_archive`): important limitation — full data for _commercial_ ads is
  only returned for ads delivered in the EU (plus political/issue ads globally). For many countries
  (e.g. Bangladesh) commercial competitor ads will **not** be returned by the API. The code handles
  empty results gracefully and says so.
- **Manual import fallback** (always works): user saves competitor ads they see in the public
  Ad Library website into `data/competitors/<name>.csv` (columns: date_seen, headline, body, cta,
  format, landing_url, start_date, is_active). Tool `import_competitor_ads` loads them.
- Tool `get_ad_library_link` returns the public Ad Library search URL for a competitor so the user can browse it.
- Longevity matters: an ad running 30+ days is likely profitable → flagged as "proven competitor ad".

### 8.4 Competitive positioning (honest by design)

Competitor **sales and revenue are not public**. The tool never invents them.
Instead it computes a transparent **Market Presence Score** from observable signals, each 0-100,
weighted (weights configurable in yaml):

| Signal                                          | Source                                              |
| ----------------------------------------------- | --------------------------------------------------- |
| Active ad count                                 | Ad Library / manual import                          |
| Ad longevity (avg days running of active ads)   | Ad Library / manual                                 |
| Creative velocity (new ads per week)            | Ad Library / manual                                 |
| Offer aggressiveness (discounts, bundles found) | website snapshots                                   |
| Social proof (review counts, ratings)           | website snapshots                                   |
| Social following / engagement                   | manual `competitor_signals` entry                   |
| Web traffic estimate                            | manual entry (e.g. user copies from a traffic tool) |
| Price position (vs. user's price)               | website snapshots                                   |

For the user's own brand, the same signals are used (own ads from DB, own website snapshot, manual numbers).
Output: ranked list with score, per-signal breakdown, **data coverage %**, and a confidence label.
Claude must present this as an estimate, not a sales ranking.

### 8.5 Market module

The server does **not** do web search itself (keeps it key-free). Market research flow:

1. Prompt `daily_briefing` tells Claude to use **its own web search** for sector news/trends
   in `business.country`, using `get_market_context` for the sector, audience, and the last snapshots
   (to avoid repeating and to spot changes).
2. Claude saves findings with `save_market_snapshot` (summary + trends + source URLs).
3. Over time `get_market_history` lets Claude say "this trend has appeared 5 days in a row".

Optional v2: pluggable search provider (Brave/Tavily/SerpAPI) behind an interface, enabled by env key.

---

## 9. MCP tools

All tools: zod input schema, return `{ content: [{ type: "text", text: JSON.stringify(result, null, 2) }] }`
with a short human `summary` line at the top of the result object. Errors return `isError: true` with
an actionable message. Money is returned as numbers + `currency`.
Common `period` param: `"yesterday" | "last_7d" | "last_14d" | "last_30d" | "this_month" | {since, until}`.

The full, current tool reference (32 tools) is in the [README](README.md#tools). Groups:

- **Setup & data:** `get_setup_status`, `get_business_profile`, `update_business_profile`, `import_ads_from_folder`,
  `sync_ads_from_meta`, `get_data_coverage`.
- **Performance analysis:** `get_performance_summary`, `get_breakdown`, `get_daily_trend`, `get_winners_and_losers`,
  `detect_creative_fatigue`, `get_funnel_diagnostics`, `get_budget_recommendations_data`, `get_top_creatives`.
- **Competitors:** `list_competitors`, `add_competitor`, `remove_competitor`, `snapshot_competitor_websites`,
  `get_competitor_website_changes`, `get_competitor_profile`, `fetch_competitor_ads`, `import_competitor_ads`,
  `get_competitor_ads`, `record_competitor_signal`, `get_ad_library_link`, `get_competitive_positioning`.
- **Market:** `get_market_context`, `save_market_snapshot`, `get_market_history`.
- **Reports:** `save_report`, `list_reports`, `get_report`.

---

## 10. MCP prompts (the "marketing manager" workflows)

Prompts are registered with `server.registerPrompt`. Each prompt returns a user message that instructs Claude step
by step. All prompts tell Claude to: answer in `business.language`, use `business.currency`, separate
**facts (from tools)** from **recommendations (its judgment)**, and say when data is missing or thin.

| Prompt                 | Args                                                        | Workflow                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `daily_briefing`       | `period?` (default yesterday + last_7d)                     | 1) `get_setup_status` (import inbox / sync API if new data) → 2) web search sector news & trends, then `save_market_snapshot` → 3) `snapshot_competitor_websites` + `get_competitor_website_changes` + `get_competitive_positioning` → 4) `get_performance_summary`, `get_winners_and_losers`, `detect_creative_fatigue`, `get_funnel_diagnostics` → 5) write briefing: **Market today · Competitors · My ads: good/bad · vs competitors · Top 3 actions today · Content idea of the day** → 6) `save_report`. |
| `ad_optimization_plan` | `period?`                                                   | Breakdown + fatigue + funnel + budget data → concrete plan: what to pause, scale, duplicate, test (hook, offer, audience, placement), with expected impact and priority.                                                                                                                                                                                                                                                                                                                                       |
| `content_plan`         | `days?` (default 7), `platform?`                            | `get_top_creatives` + competitor proven ads + market trends → calendar: date, format, angle/hook, message, CTA, why (linked to data).                                                                                                                                                                                                                                                                                                                                                                          |
| `script_ideas`         | `count?`, `format?: "reel"\|"static"\|"carousel"`, `angle?` | Based on winning ads' patterns → scripts with hook (first 3 sec), body beats, CTA, on-screen text, shot list.                                                                                                                                                                                                                                                                                                                                                                                                  |
| `sales_growth_ideas`   | —                                                           | Funnel diagnostics + competitor offers + market → ideas across offer, pricing/bundles, landing page, retargeting, creatives, trust/COD/delivery; ranked by effort vs. impact.                                                                                                                                                                                                                                                                                                                                  |
| `competitor_report`    | `name?`                                                     | Deep dive on one or all competitors: offers, messaging, ad patterns, changes, where the user is ahead/behind.                                                                                                                                                                                                                                                                                                                                                                                                  |
| `weekly_review`        | —                                                           | Last 7d vs previous 7d, what worked, what didn't, lessons, next week's plan; reads last week's reports for continuity.                                                                                                                                                                                                                                                                                                                                                                                         |
| `setup_wizard`         | —                                                           | Guides a new user: create business.yaml via `update_business_profile`, add competitors, explain how to export from Ads Manager or add API keys.                                                                                                                                                                                                                                                                                                                                                                |

---

## 11. MCP resources

| URI                            | Content                                                                                             |
| ------------------------------ | --------------------------------------------------------------------------------------------------- |
| `marketing://business-profile` | business.yaml as JSON                                                                               |
| `marketing://reports/latest`   | most recent daily briefing markdown                                                                 |
| `marketing://glossary`         | metric definitions & formulas (generated from `analytics/metrics.ts` so it never drifts)            |
| `marketing://playbook`         | static markdown of ad best practices in `src/mcp/resources/playbook.md` — editable by the community |

---

## 12. Error handling & data quality

- Every tool validates input with zod; validation errors are returned as readable messages.
- Typed errors in `utils/errors.ts`: `ConfigMissingError`, `ConfigInvalidError`, `NoDataError`, `MetaApiError`,
  `ImportFormatError`, `FetchBlockedError`, `NotFoundError` → each mapped to a friendly, actionable message.
- Data freshness: analysis tools include `data_last_date`; if older than 2 days, they include a warning.
- Thin data: if total spend is below `min_spend_for_verdict`, results say verdicts are unreliable.
- Never throw raw stack traces to the client; they are logged to stderr.

---

## 13. Security & privacy

- `.env` and everything in `projects/` (profiles, `project.env`, data, reports) are gitignored.
- Meta token: `ads_read` only. README documents how to create a System User token in Business Manager.
- Tokens are never logged; `access_token` is redacted in any logged URL or error message.
- Web fetcher: respects robots.txt, rate-limits per domain, identifies with a clear User-Agent, public pages only.
- All data stays on the user's machine. No telemetry.

---

## 14. Build phases

| Phase                           | Scope                                                                                                                   | Done when                                                                                                  | Status                                                       |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 0 — Scaffold                    | package/tsconfig/lint/test setup, folders, config loaders, logger, minimal server with `get_setup_status`               | `npm run build` passes; server connects; `get_setup_status` reports what's missing                         | ✅                                                           |
| 1 — Folder import + storage     | SQLite + migrations, `adsRepo`, CSV/XLSX parser + alias map, `import_ads_from_folder`, `get_data_coverage`, sample data | Importing the sample twice gives the same row count; tests cover 3 header variants and a malformed file    | ✅                                                           |
| 2 — Analytics                   | Pure analytics + unit tests; 8 performance tools                                                                        | Seeded winner/loser/fatigued/learning ads get the right verdicts                                           | ✅                                                           |
| 3 — Prompts, resources, reports | Reports tools, resources, 5 prompts, profile tools                                                                      | `content_plan` on sample data references real top ads                                                      | ✅ (verified via tool output; run in Claude to see the plan) |
| 4 — Meta Marketing API          | Client, insights + creatives mapping, paging, retry; `sync_ads_from_meta`; fixture tests                                | With a valid token, last 7 days sync into the same tables and analytics work unchanged                     | ✅ (fixture-tested; no live calls in tests)                  |
| 5 — Competitors                 | CRUD, polite fetcher + extractor + diff, manual import, Ad Library client, signals, positioning                         | Two snapshots of a changed fixture page produce a correct diff; positioning returns scores with coverage % | ✅                                                           |
| 6 — Market + daily briefing     | Market tools; `daily_briefing`, `competitor_report`, `weekly_review`                                                    | "Give me today's briefing" runs end to end and saves a report                                              | ✅ (tool sequence tested end to end over MCP)                |
| 7 — Open-source polish          | README, CONTRIBUTING, LICENSE, CI, issue templates                                                                      | Fresh clone → `npm install && npm run build` → connected and working using only the README                 | ✅                                                           |

---

## 15. How users connect it

See the [README](README.md#connect-it-to-claude) for Claude Code (`claude mcp add …`) and Claude Desktop
(`claude_desktop_config.json`) instructions.

---

## 16. `CLAUDE.md`

See [`CLAUDE.md`](CLAUDE.md) in the repo root — the short rules every contributor (human or Claude) follows.

---

## 17. Future (v2+) ideas

- Optional pluggable web-search provider for market research.
- Google Ads / TikTok Ads sources (same `ad_daily` canonical model).
- Headless browser for JS-heavy competitor sites.
- Local HTML dashboard of trends.
- Write actions (pause/scale) behind explicit opt-in and confirmation.
- Creative image/video analysis using thumbnails passed to Claude.

---

## 18. Agency workspace: multiple client projects

The server is used by an agency with many clients. Each client is a **project**:

```
projects/<client-slug>/
├── project.json     # { name, slug, created_at }
├── business.yaml    # this client's profile, goals, targets, competitors (§6.2)
├── project.env      # this client's META_AD_ACCOUNT_ID (+ optional token / API version overrides)
├── app.db           # this client's SQLite database (§7 schema)
└── inbox/ processed/ competitors/ snapshots/ reports/
```

- `src/workspace.ts` (`Workspace`) lists, creates, resolves, activates and archives projects and hands out one
  `AppContext` per project (cached; reloaded when `project.env` changes). Everything below the MCP layer is unchanged:
  services, repositories and analytics still work on a single project's context.
- **Workspace tools:** `create_project`, `list_projects`, `switch_project`, `configure_project_meta`,
  `archive_project`. **Project tools** (all of §9) automatically get an optional `project` argument; without it the
  active project is used, and with several projects but none active they refuse to guess.
- **Prompts** accept `project` and instruct Claude to pass it on every tool call; without a project they tell Claude to
  ask which client (or create one).
- **Resources** read the active project; `marketing://projects` lists all projects.
- **Isolation rules:** one database per project; the ad account id is per project only (never inherited from the global
  `.env`); the agency token may be shared via the global `.env` or overridden per project.

---

## 19. Ads Manager changes — confirm-first

The agency asked for Claude to be able to run ads from a project and apply its own suggestions, **but only when the
user says so**. This replaces the original "read-only toward Meta" rule with a stricter one: _no change to Meta
without an explicit, per-change user confirmation_.

**Flow** (`src/services/adManagerService.ts`, `src/sources/metaApi/manage.ts`, table `ad_actions` in migration 003):

1. `propose_new_ad` / `propose_status_change` / `propose_budget_change` / `propose_duplicate` validate against Meta
   (object exists and belongs to the project's ad account; Page set; file inside `creatives/`; budget ≤ cap) and store
   a pending action with a preview. They make no changes.
2. Claude shows the preview and asks the user. `execute_ad_action` then asks the human again through **MCP
   elicitation** when the client supports it (the server's own approval dialog; decline/unticked = cancelled). If the
   client can't show it, the client's tool-permission prompt is the gate (`destructiveHint: true`), recorded as
   `confirmed_via: tool_permission`.
3. Execution runs exactly the stored parameters; results (ids) and failures, including partial results, are logged.

**Scope:** new campaigns with their first ad set (`propose_new_campaign`: Sales/Leads with the project pixel,
Traffic, Awareness; campaign or ad set daily budget; locations, age, gender, interests, Advantage+ audience,
placements, schedule — payloads built in `src/sources/metaApi/campaigns.ts`); new ad sets in existing campaigns
(`propose_new_adset`); new ads (image/video upload → creative → ad); pause/activate; daily budgets; duplicate ad or ad
set (`/copies`); read-only `search_targeting` for location keys and interest ids. Not in scope: messaging/app/catalog
campaigns, lifetime budgets, bid caps, audience creation, deleting anything, editing live creatives.

**Safeguards:** `META_WRITE_ENABLED` per project (off by default; never inherited from the global `.env`), 30-minute
proposal expiry, ownership check before proposing and again before executing, budget cap
(`META_MAX_DAILY_BUDGET`), stale-budget check, ±20% budget-jump warning, POST requests never retried after network
errors or 5xx (only on rate-limit rejections), audit log (`list_ad_actions`). Video ads resume after Meta's
processing without a second confirmation.
