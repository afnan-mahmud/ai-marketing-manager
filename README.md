# AI Marketing Manager — MCP server

An open-source **MCP (Model Context Protocol) server** that turns Claude (Claude Desktop, Claude Code, or any MCP
client) into a **personal AI marketing manager** for a business running **Meta (Facebook/Instagram) ads**.

Ask things like:

- _"Give me today's marketing briefing."_
- _"Which of my ads are winning and which should I kill?"_
- _"How am I doing vs. my competitors?"_
- _"Plan next week's content and write 3 video script ideas based on my best ads."_
- _"What should I change in my next campaign to get more sales?"_

> **The server supplies facts. Claude supplies judgment.**
> The server loads your ad data, computes metrics deterministically, tracks competitors and stores history, and
> returns structured JSON. Claude does the reasoning. The server never calls an LLM, is **read-only toward Meta**,
> and keeps all data **on your machine** (no telemetry).

---

## Contents

- [Features](#features)
- [Quick start (5 minutes)](#quick-start-5-minutes)
- [Connect it to Claude](#connect-it-to-claude)
- [Daily use](#daily-use)
- [Getting your ad data in](#getting-your-ad-data-in)
- [Configuration](#configuration)
- [Example conversation](#example-conversation)
- [Reference: prompts, tools, resources](#reference)
- [How verdicts and scores work](#how-verdicts-and-scores-work)
- [Limitations](#limitations)
- [Privacy & security](#privacy--security)
- [Development](#development)

## Features

- **Your ad data** from Ads Manager exports (CSV/XLSX dropped in a folder) or a daily pull from the Meta
  Marketing API. Re-imports never duplicate data.
- **Performance analytics** — KPIs, period-over-period comparison, winners / losers / fatigued / learning ads with
  reason codes, creative fatigue detection, funnel diagnostics, budget efficiency, top creatives with their copy.
- **Competitor tracking** — polite website snapshots (offers, prices, CTAs, social proof) with change detection,
  competitor ads (Ad Library API where available + manual import), manual signals (followers, traffic).
- **Competitive positioning** — a transparent, _estimated_ Market Presence Score with data coverage and confidence.
- **Market history** — Claude researches the market with its own web search; the server stores the findings so
  recurring trends become visible ("3rd day in a row").
- **Workflows** — ready-made prompts: daily briefing, ad optimization plan, content plan, script ideas, sales growth
  ideas, competitor report, weekly review, setup wizard. Reports are saved as Markdown in `data/reports/`.

## Quick start (5 minutes)

Requirements: **Node.js ≥ 22** and an MCP client (Claude Desktop or Claude Code).

```bash
git clone https://github.com/afnan-mahmud/ai-marketing-manager
cd ai-marketing-manager
npm install
npm run build
cp .env.example .env
cp config/business.example.yaml config/business.yaml   # then edit it (or let the setup_wizard prompt do it)
```

Optional check that everything works (runs the built server on the bundled sample data):

```bash
npm run smoke
```

## Connect it to Claude

**Claude Code**

```bash
claude mcp add marketing-manager -- node /absolute/path/to/ai-marketing-manager/dist/index.js
```

**Claude Desktop** — add this to `claude_desktop_config.json`
(Settings → Developer → Edit Config; see also [`examples/claude_desktop_config.json`](examples/claude_desktop_config.json)):

```json
{
  "mcpServers": {
    "marketing-manager": {
      "command": "node",
      "args": ["/absolute/path/to/ai-marketing-manager/dist/index.js"],
      "env": { "DATA_DIR": "/absolute/path/to/ai-marketing-manager/data" }
    }
  }
}
```

Restart Claude Desktop. Relative paths in `.env` (like `DATA_DIR=./data`) are resolved from the project folder,
so the server works regardless of the folder the client starts it in.

**First run:** ask Claude _"Run the setup wizard"_ (or pick the `setup_wizard` prompt). It checks what's missing,
creates your business profile, adds competitors and explains how to get your ad data in.

**Try it without your own data:** copy `examples/sample-meta-export.csv` into `data/inbox/` and ask
_"Import my ads and tell me which ones are winning."_ (The sample covers 2026-09-14 → 2026-10-13; relative periods
like "last_7d" automatically anchor to the last day of data and say so.)

## Daily use

1. Drop yesterday's Ads Manager export into `data/inbox/` — or configure the Meta API once and skip this.
2. Ask: **"Give me today's briefing."**

Claude imports/syncs new data, researches the market, snapshots competitor websites, analyses your ads, and writes
a briefing — _Market today · Competitors · My ads: good/bad · vs competitors · Top 3 actions today · Content idea of
the day_ — saved to `data/reports/YYYY-MM-DD-daily_briefing.md`.

## Getting your ad data in

### Option A — Ads Manager export (no API key)

1. Ads Manager → **Ads** tab → choose the date range.
2. **Breakdown → By time → Day** (needed for trends and fatigue detection).
3. Columns: at least _Amount spent, Impressions, Reach, Link clicks_; ideally also _Landing page views, Adds to cart,
   Checkouts initiated, Purchases, Purchases conversion value, 3-second video plays, ThruPlays_, and _Ad ID_.
   Adding _Headline, Body, Call to action_ gives Claude your ad copy for content ideas.
4. **Export → Export table data → CSV or XLSX**, save it in `data/inbox/`, and ask Claude to import
   (`import_ads_from_folder`). Imported files move to `data/processed/`.

Header names vary by Ads Manager version, language and settings; the importer knows many variants
(`src/sources/metaExport/columnMap.ts`), strips currency symbols (৳, Tk, $, …), handles Bengali digits and tells you
about anything it ignored. Missing required columns → a clear error listing what it found.

### Option B — Meta Marketing API (automatic)

1. In **Business Settings → Users → System users**, create a system user and give it access to your ad account.
2. **Generate a token** with **only the `ads_read` permission** (this server never needs write access).
3. In `.env` set `META_ACCESS_TOKEN` and `META_AD_ACCOUNT_ID` (numbers only, without `act_`), then restart.
4. `sync_ads_from_meta` pulls the last 7 days (re-pulling to capture late attribution) plus ad creatives.

Tip: don't mix exports **without** the "Ad ID" column and the API for the same dates — ids won't match and data
would be double-counted (the sync warns you if it detects this).

## Configuration

### `.env` (secrets — never committed)

| Variable                | Default                                 | Purpose                                                  |
| ----------------------- | --------------------------------------- | -------------------------------------------------------- |
| `DATA_DIR`              | `./data`                                | Where the database, inbox, snapshots and reports live    |
| `BUSINESS_CONFIG`       | `./config/business.yaml`                | Business profile location                                |
| `META_ACCESS_TOKEN`     | —                                       | Marketing API token (`ads_read` only). Optional          |
| `META_AD_ACCOUNT_ID`    | —                                       | Numeric ad account id. Optional                          |
| `META_API_VERSION`      | `v21.0`                                 | Graph API version — check Meta's current version         |
| `META_AD_LIBRARY_TOKEN` | —                                       | Ad Library API token (falls back to `META_ACCESS_TOKEN`) |
| `WEB_USER_AGENT`        | `AIMarketingManagerBot/1.0 (+repo URL)` | Identifies the website fetcher                           |
| `WEB_TIMEOUT_MS`        | `15000`                                 | Website fetch timeout                                    |
| `LOG_LEVEL`             | `info`                                  | `debug` / `info` / `warn` / `error` (logs go to stderr)  |

### `config/business.yaml` (your business — gitignored)

Copy [`config/business.example.yaml`](config/business.example.yaml). Key parts:

- `business` — name, sector, country (ISO-2), currency, **language** (answers and content are written in it),
  website, products (price, margin %), target audience, brand voice.
- `goals` — `primary_kpi` (`purchases` | `leads` | `messages` | `link_clicks`), `targets` (`max_cpa`, `min_roas`,
  `min_ctr_pct`), `monthly_budget`.
- `classification` — `min_spend_for_verdict`, `min_impressions_for_verdict`, `fatigue_frequency`.
- `competitors` — name, website, optional `facebook_page_id`, notes, `extra_urls` (pricing/product pages to snapshot).
- `positioning.weights` — optional weights for the Market Presence Score.

The file is re-read on every call, so edits apply immediately. Claude can edit it for you with
`update_business_profile` (comments in the file are preserved). Without the file, analytics still work with default
thresholds; competitor/market tools ask you to create it.

## Example conversation

> **You:** Which of my ads are winning and which should I kill?
>
> **Claude** _(calls `get_winners_and_losers`, `detect_creative_fatigue`, `get_funnel_diagnostics`)_:
> **Facts (last 30 days, target CPA ৳400):**
>
> - ✅ Winners: _Free Delivery Offer_ (CPA ৳201, ROAS 6.3), _UGC Review – Nadia_ (CPA ৳301), _Founder Story Video_ (CPA ৳343).
> - ⚠️ Fatigued: _Before-After Reel_ — frequency 3.6 in the last 7 days, CTR −51%, CPA +171% vs its previous two weeks.
> - ❌ Losers: _Static Discount Banner_ (CPA ৳1,136 — and only 45% of clicks reach the landing page),
>   _Limited Stock Countdown_ (CPA ৳927, hook rate 16%), _Ingredient Spotlight_ (৳12,146 spent, 0 purchases).
>
> **Recommendations:** pause _Ingredient Spotlight_ and _Limited Stock Countdown_; check the landing page speed for
> the discount banner before judging the offer; give _Before-After Reel_ a new opening hook; move ~20% of the freed
> budget to _Free Delivery Offer_ and _UGC Review_…

## Reference

### Prompts (workflows)

| Prompt                 | Arguments                                              | What you get                                                                                                               |
| ---------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `daily_briefing`       | `period?`                                              | Market today · Competitors · My ads good/bad · vs competitors · Top 3 actions · Content idea — saved as a report           |
| `ad_optimization_plan` | `period?` (default last_14d)                           | What to pause, scale, fix, duplicate and test, with evidence, expected impact and priority                                 |
| `content_plan`         | `days?` (7), `platform?`                               | Dated content calendar linked to winning ads, proven competitor ads and trends                                             |
| `script_ideas`         | `count?` (3), `format?` reel/static/carousel, `angle?` | Scripts with hook (first 3s), beats, CTA, on-screen text, shot list                                                        |
| `sales_growth_ideas`   | —                                                      | Ideas across offer, pricing/bundles, landing page, retargeting, creatives, trust/COD/delivery — ranked by impact vs effort |
| `competitor_report`    | `name?`                                                | Deep dive: offers, pricing, messaging, ad patterns, changes, where you're ahead/behind                                     |
| `weekly_review`        | —                                                      | Last 7 vs previous 7 days, what worked, scorecard of last week's plan, lessons, next week's plan                           |
| `setup_wizard`         | —                                                      | Guided setup: profile, competitors, data import or API keys                                                                |

All prompts tell Claude to answer in `business.language`, use `business.currency`, separate **facts** from
**recommendations**, and say when data is missing, stale or thin.

### Tools

Common `period` values: `"yesterday"`, `"last_7d"`, `"last_14d"`, `"last_30d"`, `"this_month"` or
`{ "since": "YYYY-MM-DD", "until": "YYYY-MM-DD" }`. Every result starts with a one-line `summary`; errors come back
with `isError: true` and an actionable `hint`.

**Setup & data**

| Tool                      | Input              | What it does                                                                                |
| ------------------------- | ------------------ | ------------------------------------------------------------------------------------------- |
| `get_setup_status`        | —                  | Checks business.yaml, .env keys, database, data freshness and inbox files; lists next steps |
| `get_business_profile`    | —                  | Returns the validated business profile                                                      |
| `update_business_profile` | partial profile    | Creates/edits business.yaml (objects merge, arrays replace, `null` deletes; comments kept)  |
| `import_ads_from_folder`  | `dry_run?`         | Imports all CSV/XLSX exports in `data/inbox/` (UPSERT), moves them to `data/processed/`     |
| `sync_ads_from_meta`      | `since?`, `until?` | Pulls daily ad insights + creatives from the Marketing API (default last 7 days)            |
| `get_data_coverage`       | —                  | Dates available, gaps, sources, number of ads/ad sets/campaigns                             |

**Performance analysis**

| Tool                              | Input                                                       | Returns                                                         |
| --------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------- |
| `get_performance_summary`         | `period`, `compare?`                                        | Account totals, derived KPIs, vs previous period and vs targets |
| `get_breakdown`                   | `period`, `level` (campaign/adset/ad), `sort_by?`, `limit?` | KPIs + verdict + reasons per entity                             |
| `get_daily_trend`                 | `period`, `metrics[]`, `level?`, `entity_id?`               | Daily time series for the account or one entity                 |
| `get_winners_and_losers`          | `period`, `limit?`                                          | Ads grouped by verdict with reason codes and numbers            |
| `detect_creative_fatigue`         | `lookback_days?` (7)                                        | Fatigued ads with evidence + a watchlist                        |
| `get_funnel_diagnostics`          | `period`, `level?`, `entity_id?`                            | Funnel step rates + rule-based problem flags, per entity        |
| `get_budget_recommendations_data` | `period`                                                    | Spend share vs result share, pacing, reallocation candidates    |
| `get_top_creatives`               | `period`, `limit?`, `by?` (cpa/roas/ctr/hook_rate)          | Best ads with headline, text, CTA and format                    |

**Competitors**

| Tool                                   | Input                                             | Returns                                                                              |
| -------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `list_competitors`                     | —                                                 | Tracked competitors, last snapshot, stored ads                                       |
| `add_competitor` / `remove_competitor` | name, website, page id, notes, extra_urls         | Manage the list (kept in business.yaml)                                              |
| `snapshot_competitor_websites`         | `names?`                                          | Fetch + extract + store + diff (your own site too)                                   |
| `get_competitor_website_changes`       | `name?`, `since?`                                 | Added/removed offers, prices, headings, CTAs, social proof                           |
| `get_competitor_profile`               | `name` (or `"self"`)                              | Latest snapshot, changes, ads, signals, presence score                               |
| `fetch_competitor_ads`                 | `name?`, `country?`                               | Ad Library API (EU only for commercial ads — says so otherwise)                      |
| `import_competitor_ads`                | —                                                 | Loads `data/competitors/<name>.csv/.json` you saved by hand                          |
| `get_competitor_ads`                   | `name?`, `active_only?`, `proven_only?`, `limit?` | Stored ads with days running; proven = 30+ days                                      |
| `record_competitor_signal`             | `name`, `signal`, `value`, `note?`, `date?`       | Manual numbers: `social_followers`, `web_traffic`, `review_count`…                   |
| `get_ad_library_link`                  | `name`                                            | Public Ad Library URL                                                                |
| `get_competitive_positioning`          | —                                                 | Ranked **estimated** Market Presence Score with breakdown, coverage % and confidence |

**Market**

| Tool                   | Input                              | Returns                                                                                     |
| ---------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------- |
| `get_market_context`   | —                                  | Sector, country, audience, products, recent snapshots, recurring trends, suggested searches |
| `save_market_snapshot` | `summary`, `trends[]`, `sources[]` | Stores today's research; returns how often each trend recurred                              |
| `get_market_history`   | `days?` (30)                       | Past snapshots and recurring trends with streaks                                            |

**Reports**

| Tool           | Input                                 | Returns                                                        |
| -------------- | ------------------------------------- | -------------------------------------------------------------- |
| `save_report`  | `type`, `title`, `markdown`           | Writes `data/reports/YYYY-MM-DD-<type>.md` and indexes it      |
| `list_reports` | `type?`, `since?`, `until?`, `limit?` | Saved reports, newest first                                    |
| `get_report`   | `id?`, `date?`, `type?`               | A report's Markdown (latest of a type if only `type` is given) |

### Resources

| URI                            | Content                                                                           |
| ------------------------------ | --------------------------------------------------------------------------------- |
| `marketing://business-profile` | business.yaml as JSON                                                             |
| `marketing://reports/latest`   | Most recent daily briefing                                                        |
| `marketing://glossary`         | Metric definitions, formulas, verdict rules, benchmarks (generated from the code) |
| `marketing://playbook`         | Meta ads best practices — community-editable in `src/mcp/resources/playbook.md`   |

## How verdicts and scores work

- Ratios (CTR, CPC, CPM, CPA, ROAS, funnel rates) are computed from **summed counts**, never averaged; division by
  zero gives `null`.
- **learning**: below `min_spend_for_verdict` or `min_impressions_for_verdict`.
  **winner**: meets your CPA (and ROAS) targets. **loser**: CPA above 1.5× target, or no conversions after spending
  1.5× target. **fatigued**: was a winner in its previous 14 days, and now frequency ≥ `fatigue_frequency` with CTR
  down ≥ 20% or CPA up ≥ 25%. Without targets, quartiles of account CPA are used.
- **Market Presence Score**: each observable signal scored 0–100 relative to the best brand, weighted, with
  coverage %. It is an estimate of visible marketing activity — **not** sales.

Details and every other rule: [DECISIONS.md](DECISIONS.md) and the `marketing://glossary` resource.

## Limitations

- **Read-only**: the server never creates, edits, pauses or re-budgets ads — Claude recommends, you act in Ads Manager.
- **Competitor sales are not public**; positioning is an estimate from observable signals and says so.
- **Ad Library API**: Meta only returns _commercial_ ads delivered in the **EU** (plus political/issue ads
  worldwide). For other countries (e.g. Bangladesh), browse the public Ad Library (`get_ad_library_link`) and save
  ads to `data/competitors/<name>.csv` (template: [`examples/competitor-ads-template.csv`](examples/competitor-ads-template.csv)).
- **Websites**: public pages only, robots.txt respected, no JavaScript rendering — content loaded by scripts isn't
  seen. Extraction of prices/offers is heuristic.
- **Frequency** from daily exports is approximate (daily reach can't be de-duplicated across days).
- **Market research** uses Claude's own web search; the server stores results but doesn't search.
- Runs locally for one business per data folder (point `DATA_DIR`/`BUSINESS_CONFIG` elsewhere for another).
- Only Meta ads in v1; the canonical `ad_daily` model is ready for other sources (Google, TikTok) later.

## Privacy & security

- `.env`, `config/business.yaml` and everything in `data/` are gitignored. All data stays on your machine; no telemetry.
- The Meta token needs only `ads_read`; tokens are redacted from all logs and error messages.
- The website fetcher identifies itself, respects robots.txt, waits ≥ 1 s between requests to a site, caps pages at
  3 MB, and never logs in.

## Development

```bash
npm run check   # lint + typecheck + prettier check + tests (vitest)
npm run build   # compile to dist/
npm run smoke   # run the built server over stdio against the sample data
npm run sample  # regenerate examples/sample-meta-export.csv
```

Architecture: [ARCHITECTURE.md](ARCHITECTURE.md) · Contributor rules: [CLAUDE.md](CLAUDE.md),
[CONTRIBUTING.md](CONTRIBUTING.md) · Design decisions: [DECISIONS.md](DECISIONS.md).

## License

[MIT](LICENSE)
