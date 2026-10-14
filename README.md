# AI Marketing Manager — MCP server

An open-source **MCP (Model Context Protocol) server** that turns Claude (Claude Desktop, Claude Code, or any MCP
client) into an **AI marketing manager for an agency's clients** running **Meta (Facebook/Instagram) ads**.
Every client is a separate **project** with its own folder, business profile, competitors, Meta ad account, data and
reports.

Ask things like:

- _"Create a project called Acme Foods."_
- _"Give me today's marketing briefing for Acme Foods."_
- _"Which of Glow BD's ads are winning and which should we kill?"_
- _"How is Acme doing vs. its competitors?"_
- _"Plan next week's content for Glow BD and write 3 video script ideas based on its best ads."_
- _"I put the new videos in Glow BD's creatives folder — turn them into ads."_ (runs only after you confirm)
- _"Pause the losers and move ৳500/day to the best ad set."_ (each change previewed, then confirmed by you)

> **The server supplies facts. Claude supplies judgment.**
> The server loads ad data, computes metrics deterministically, tracks competitors and stores history, and returns
> structured JSON. Claude does the reasoning. The server never calls an LLM, **never changes anything in Meta on its own**
> (every Ads Manager change is a preview you confirm first), and keeps all data **on your machine** (no telemetry).

---

## Contents

- [Features](#features)
- [Quick start (5 minutes)](#quick-start-5-minutes)
- [Connect it to Claude](#connect-it-to-claude)
- [Client projects](#client-projects)
- [Daily use](#daily-use)
- [Managing ads (with your confirmation)](#managing-ads-with-your-confirmation)
- [Memory: learning like a human manager](#memory-learning-like-a-human-manager)
- [Getting a client's ad data in](#getting-a-clients-ad-data-in)
- [Configuration](#configuration)
- [Example conversation](#example-conversation)
- [Reference: prompts, tools, resources](#reference)
- [How verdicts and scores work](#how-verdicts-and-scores-work)
- [Limitations](#limitations)
- [Privacy & security](#privacy--security)
- [Development](#development)

## Features

- **Multi-client projects** — one workspace, one folder per client (`projects/<client>/`). Business profile,
  competitor list, Meta ad account, database, reports and snapshots never mix between clients.
- **Ad data** from Ads Manager exports (CSV/XLSX dropped in the client's inbox) or a daily pull from the Meta
  Marketing API. Re-imports never duplicate data.
- **Performance analytics** — KPIs, period-over-period comparison, winners / losers / fatigued / learning ads with
  reason codes, creative fatigue detection, funnel diagnostics, budget efficiency, top creatives with their copy.
- **Competitor tracking** — polite website snapshots (offers, prices, CTAs, social proof) with change detection,
  competitor ads (Ad Library API where available + manual import), manual signals (followers, traffic).
- **Competitive positioning** — a transparent, _estimated_ Market Presence Score with data coverage and confidence.
- **Market history** — Claude researches the market with its own web search; the server stores the findings so
  recurring trends become visible ("3rd day in a row").
- **Managing ads, confirm-first** — create new campaigns and ad sets (objective, budget, audience, placements),
  turn images/videos from the client's `creatives/` folder into Meta ads, pause or activate, change budgets,
  duplicate winners. Claude prepares each change as a preview; it runs in Ads Manager only
  after you confirm it. Off by default per client.
- **Memory that learns** — after each analysis Claude saves evidence-based lessons per client (what worked, what to
  avoid, insights); repeated lessons gain confidence, contradicted ones are flagged, old ones fade. Every briefing and
  plan starts from this memory, and the real results of confirmed Ads Manager changes are reviewed and learned from.
- **Workflows** — ready-made prompts: daily briefing, ad optimization plan, content plan, script ideas, sales growth
  ideas, competitor report, weekly review, setup wizard. Reports are saved as Markdown in the client's `reports/`.

## Quick start (5 minutes)

Requirements: **Node.js ≥ 22** and an MCP client (Claude Desktop or Claude Code).

```bash
git clone https://github.com/afnan-mahmud/ai-marketing-manager
cd ai-marketing-manager
npm install
npm run build
cp .env.example .env      # optional: agency-wide Meta token, API version, etc.
```

Optional check that everything works (creates a temporary project and runs the built server on the sample data):

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
      "env": { "PROJECTS_DIR": "/absolute/path/to/ai-marketing-manager/projects" }
    }
  }
}
```

Restart Claude Desktop. Relative paths in `.env` (like `PROJECTS_DIR=./projects`) are resolved from the repo folder,
so the server works regardless of the folder the client starts it in.

**First client:** tell Claude _"Create a project called Acme Foods and run the setup wizard for it."_ Claude calls
`create_project`, then asks for the client's details (sector, country, currency, language, products, targets,
competitors) and saves them in that project's own profile.

**Try it without real data:** create a project, copy `examples/sample-meta-export.csv` into
`projects/<project>/inbox/` and ask _"Import the ads for <project> and tell me which ones are winning."_ (The sample
covers 2026-09-14 → 2026-10-13; relative periods like "last_7d" automatically anchor to the last day of data.)

## Client projects

```
projects/
├── .active                     # which project tools use when no `project` is given
├── acme-foods/
│   ├── project.json            # name, created date
│   ├── business.yaml           # this client's business profile, goals, targets, competitors
│   ├── project.env             # this client's Meta ad account (and optional own token)
│   ├── app.db                  # this client's ad data, competitor snapshots/ads, market history, report index
│   ├── inbox/  processed/      # Ads Manager exports for this client
│   ├── competitors/            # manually saved competitor ads (CSV/JSON)
│   ├── snapshots/              # competitor website text snapshots
│   ├── reports/                # briefings, plans, reviews (Markdown)
│   ├── memory.md               # what the manager has learned about this client (generated)
│   └── creatives/              # images/videos you want to run as ads
├── glow-bd/ …
└── _archived/                  # archived projects (archive_project)
```

- **Create:** `create_project` with the client name → folder `projects/<slugified-name>/` (Bangla names work too).
  Pass `business` to fill the profile at once, or run the `setup_wizard` prompt for the project.
- **Target a client:** every tool and prompt accepts an optional `project` (name or folder). Claude is instructed to
  pass it on every call for the client being discussed. Without it, the **active project** is used
  (`switch_project`); if several projects exist and none is active, tools refuse to guess.
- **Meta API per client:** each project has its own ad account id (`configure_project_meta`, stored in its
  `project.env`). The agency's system-user token can live once in the global `.env`; a client-specific token can go in
  that project's `project.env`. The ad account id is **never** taken from the global `.env`, so one client's ads can't
  be synced into another client's project.
- **Archive:** `archive_project` (with `confirm: true`) moves the folder to `projects/_archived/` — nothing is deleted.
- **Overview:** `list_projects` shows every client with profile status, Meta settings, latest data date and which
  one is active.

## Daily use

1. Drop each client's Ads Manager export into `projects/<client>/inbox/` — or configure its Meta ad account once.
2. Ask: **"Give me today's briefing for Acme Foods."** (or run the `daily_briefing` prompt with `project`).

Claude imports/syncs new data, researches the client's market, snapshots its competitors' websites, analyses its ads,
and writes a briefing — _Market today · Competitors · My ads: good/bad · vs competitors · Top 3 actions today ·
Content idea of the day_ — saved to `projects/<client>/reports/YYYY-MM-DD-daily_briefing.md`.

## Managing ads (with your confirmation)

Claude can also **make changes in Meta Ads Manager** for a client — but never on its own:

1. **Propose** — `propose_new_ad`, `propose_status_change`, `propose_budget_change` or `propose_duplicate` checks
   everything with Meta (the target belongs to this client's ad account, budgets are within the cap, the file exists)
   and returns a **preview** with warnings. Nothing changes in Meta yet.
2. **You confirm** — Claude shows you the preview and asks. Where your MCP client supports it, the server also opens
   its own approval dialog (MCP elicitation) that only you can answer; otherwise your client's tool-permission prompt
   for `execute_ad_action` is the gate (keep that tool on "ask every time").
3. **Execute** — `execute_ad_action` runs exactly that previewed change. Every proposal and result is logged
   (`list_ad_actions`). Unconfirmed proposals expire after 30 minutes.

**Content → live ad:** make the content from the content plan, drop the files into `projects/<client>/creatives/`
(jpg/png up to 30 MB, mp4/mov up to 500 MB), then ask _"Launch ads from the new creatives"_ (the `launch_ads` prompt).
Claude drafts the copy, picks an existing ad set, asks whether each ad should start **ACTIVE** or **PAUSED**, and
creates each ad only after you confirm it. Meta still reviews every ad before it delivers.

**New campaign from scratch:** ask _"Plan a new campaign for the Niacinamide launch, about ৳2,000/day"_ (the
`plan_campaign` prompt). Claude proposes objective, budget, audience (looking up city/interest ids with
`search_targeting`) and creatives from the client's data; once you approve the plan, it previews the campaign + first
ad set (`propose_new_campaign`), then each extra ad set (`propose_new_adset`) and each ad — every one runs only after
your yes. Supported objectives: **Sales** and **Leads** (website, using the project's pixel), **Traffic**,
**Awareness**; budget on the campaign (Advantage campaign budget) or on the ad set; locations (country/region/city

- radius), age, gender, interests, Advantage+ audience on/off, placements, start/end time. Messenger/WhatsApp campaigns
  aren't created from scratch here — duplicate an existing one.

**Turning it on for a client** (off by default):

- Token with `ads_management`; the system user needs access to the ad account and the client's Facebook Page
  (and Instagram account, if used).
- _"Enable ad management for Glow BD, Page id 1234567890, max daily budget ৳5,000"_ → `configure_project_meta`
  (`write_enabled`, `page_id`, `max_daily_budget`; plus `pixel_id` for Sales/Leads campaigns), or edit the project's
  `project.env`.

**Safeguards:** off per client by default · nothing runs without a confirmed preview · one change per confirmation ·
targets must belong to the project's own ad account · daily-budget cap · budget changes refused if the budget changed
in Ads Manager after the preview · ±20% budget-jump warning (learning phase) · audit log · a new campaign's empty ad
set spends nothing until an ad is added and confirmed.

## Memory: learning like a human manager

Each client project has its own **memory** of lessons, stored in its database and mirrored to
`projects/<client>/memory.md` for people to read:

- **do** — what worked and should be repeated (e.g. _"UGC testimonial videos beat discount banners for women 20-35 in
  Dhaka"_), **avoid** — what failed, **insight** — market/audience facts. Each lesson has a category (creative, copy,
  offer, audience, budget, funnel, timing, market, competitor), the evidence behind it, and a confidence.
- **Learning loop:** the `daily_briefing` and `weekly_review` prompts start with `get_memory_briefing` and end with
  `record_learning` for new, evidence-backed lessons. Saying the same thing again **confirms** the lesson (confidence
  rises: 2× → medium, 5× → high) instead of duplicating it; a lesson that **contradicts** an existing one is flagged
  so Claude asks you which holds. Lessons not re-confirmed fade (half weight after 90 days) and can be retired.
- **Recall:** every plan/content/script/launch prompt reads the memory first, builds on "do" lessons, avoids "avoid"
  lessons unless today's data clearly shows a change, and cites the lesson ids it used.
- **Learning from its own actions:** `review_action_outcomes` compares each confirmed Ads Manager change (new ad,
  campaign, pause, budget change, duplicate) with the days before it — target and whole account — so Claude can record
  whether the change actually worked. (Needs data with real Meta ids, i.e. API sync or exports with the "Ad ID" column.)
- You stay in charge: tell Claude _"that lesson is wrong"_ and it retires or edits it (`update_learning`).

The server never invents lessons — Claude writes them from the data; the server de-duplicates, ranks and remembers.

## Getting a client's ad data in

### Option A — Ads Manager export (no API key)

1. Ads Manager (the client's ad account) → **Ads** tab → choose the date range.
2. **Breakdown → By time → Day** (needed for trends and fatigue detection).
3. Columns: at least _Amount spent, Impressions, Reach, Link clicks_; ideally also _Landing page views, Adds to cart,
   Checkouts initiated, Purchases, Purchases conversion value, 3-second video plays, ThruPlays_, and _Ad ID_.
   Adding _Headline, Body, Call to action_ gives Claude the ad copy for content ideas.
4. **Export → Export table data → CSV or XLSX**, save it in `projects/<client>/inbox/`, and ask Claude to import
   (`import_ads_from_folder` with that project). Imported files move to the project's `processed/`.

Header names vary by Ads Manager version, language and settings; the importer knows many variants
(`src/sources/metaExport/columnMap.ts`), strips currency symbols (৳, Tk, $, …), handles Bengali digits and tells you
about anything it ignored. Missing required columns → a clear error listing what it found.

### Option B — Meta Marketing API (automatic)

1. In **Business Settings → Users → System users**, create a system user and give it access to the clients' ad
   accounts.
2. **Generate a token** with the **`ads_read`** permission — add **`ads_management`** only if Claude should create,
   pause or re-budget ads after your confirmation (and give the system user access to the client's Page) — and put it in
   the global `.env` as `META_ACCESS_TOKEN` — or, for a client with its own Business Manager, in that project's
   `projects/<client>/project.env`.
3. Set the client's ad account: _"Set Acme's ad account to 123456789"_ → `configure_project_meta`.
4. `sync_ads_from_meta` (with the project) pulls the last 7 days (re-pulling to capture late attribution) plus ad
   creatives.

Tip: don't mix exports **without** the "Ad ID" column and the API for the same dates in one project — ids won't
match and data would be double-counted (the sync warns you if it detects this).

## Configuration

### Global `.env` (agency-wide — never committed)

| Variable                | Default                                 | Purpose                                                                 |
| ----------------------- | --------------------------------------- | ----------------------------------------------------------------------- |
| `PROJECTS_DIR`          | `./projects`                            | Where client project folders live                                       |
| `META_ACCESS_TOKEN`     | —                                       | Agency system-user token (`ads_read` only). Projects can override       |
| `META_API_VERSION`      | `v21.0`                                 | Graph API version — check Meta's current version. Projects can override |
| `META_AD_LIBRARY_TOKEN` | —                                       | Ad Library API token (falls back to `META_ACCESS_TOKEN`)                |
| `WEB_USER_AGENT`        | `AIMarketingManagerBot/1.0 (+repo URL)` | Identifies the website fetcher                                          |
| `WEB_TIMEOUT_MS`        | `15000`                                 | Website fetch timeout                                                   |
| `LOG_LEVEL`             | `info`                                  | `debug` / `info` / `warn` / `error` (logs go to stderr)                 |

`META_AD_ACCOUNT_ID` is ignored in the global `.env` (a warning is logged): it is always per project.

### `projects/<client>/project.env` (per client)

Created with every project (most keys can also be set with `configure_project_meta`). Edits are picked up on the next
tool call.

| Key                                         | Purpose                                                                            |
| ------------------------------------------- | ---------------------------------------------------------------------------------- |
| `META_AD_ACCOUNT_ID`                        | This client's ad account (required for API sync and managing ads)                  |
| `META_ACCESS_TOKEN`                         | Optional client-specific token (otherwise the global one)                          |
| `META_AD_LIBRARY_TOKEN`, `META_API_VERSION` | Optional overrides                                                                 |
| `META_WRITE_ENABLED`                        | `true` lets Claude _prepare_ Ads Manager changes for this client (default `false`) |
| `META_PAGE_ID`, `META_INSTAGRAM_USER_ID`    | Page / Instagram account new ads are published from                                |
| `META_PIXEL_ID`                             | Pixel used by Sales/Leads campaigns created from here                              |
| `META_MAX_DAILY_BUDGET`                     | Safety cap: highest daily budget a confirmed change may set                        |

`META_AD_ACCOUNT_ID`, `META_WRITE_ENABLED`, `META_PAGE_ID`, `META_INSTAGRAM_USER_ID`, `META_PIXEL_ID` and `META_MAX_DAILY_BUDGET` are only
read from the project's own `project.env`, never from the global `.env`.

### `projects/<client>/business.yaml` (per client)

Template: [`config/business.example.yaml`](config/business.example.yaml). Usually created by `create_project`
(with `business`), the `setup_wizard` prompt or `update_business_profile`. Key parts:

- `business` — name, sector, country (ISO-2), currency, **language** (answers and content are written in it),
  website, products (price, margin %), target audience, brand voice.
- `goals` — `primary_kpi` (`purchases` | `leads` | `messages` | `link_clicks`), `targets` (`max_cpa`, `min_roas`,
  `min_ctr_pct`), `monthly_budget`.
- `classification` — `min_spend_for_verdict`, `min_impressions_for_verdict`, `fatigue_frequency`.
- `competitors` — this client's competitors: name, website, optional `facebook_page_id`, notes, `extra_urls`.
- `positioning.weights` — optional weights for the Market Presence Score.

The file is re-read on every call, so edits apply immediately (comments are preserved when Claude edits it).
Without it, analytics still work with default thresholds; competitor/market tools ask for it.

## Example conversation

> **You:** Create a project called Glow BD — skincare brand in Bangladesh, prices in BDT, target CPA ৳400.
>
> **Claude** _(calls `create_project` with the business details)_: Created **Glow BD** in `projects/glow-bd/`. Drop its
> Ads Manager export into `projects/glow-bd/inbox/`, or tell me its ad account id. Who are its main competitors?
>
> _(…export dropped in the inbox…)_
>
> **You:** Which of Glow BD's ads are winning and which should we kill?
>
> **Claude** _(calls `import_ads_from_folder`, `get_winners_and_losers`, `detect_creative_fatigue`,
> `get_funnel_diagnostics` — all with `project: "glow-bd"`)_:
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
| `plan_campaign`        | `goal?`, `budget?`                                     | Plans a new campaign from the data, then creates campaign, ad sets and ads — each after your confirmation                  |
| `launch_ads`           | `files?`                                               | Turns files in `creatives/` into ads: drafts copy, picks ad sets, creates each ad after your confirmation                  |
| `setup_wizard`         | —                                                      | Guided setup: profile, competitors, data import or API keys                                                                |

All prompts tell Claude to answer in `business.language`, use `business.currency`, separate **facts** from
**recommendations**, and say when data is missing, stale or thin.

### Tools

Common `period` values: `"yesterday"`, `"last_7d"`, `"last_14d"`, `"last_30d"`, `"this_month"` or
`{ "since": "YYYY-MM-DD", "until": "YYYY-MM-DD" }`. Every result starts with a one-line `summary`; errors come back
with `isError: true` and an actionable `hint`.

**Projects (agency workspace)**

| Tool                     | Input                                        | What it does                                                                                  |
| ------------------------ | -------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `create_project`         | `name`, `business?`                          | Creates `projects/<name>/` with its own profile, competitors, Meta settings, data and reports |
| `list_projects`          | —                                            | All client projects, profile/Meta status, latest data date, active project                    |
| `switch_project`         | `project`                                    | Sets the active project (used when a tool gets no `project`)                                  |
| `configure_project_meta` | `project?`, `ad_account_id?`, `api_version?` | Sets the client's Meta ad account in its `project.env` (tokens are not accepted in chat)      |
| `archive_project`        | `project`, `confirm: true`                   | Moves the project folder to `projects/_archived/`                                             |

Every tool below also accepts an optional **`project`** (client name or folder) and echoes which project it used.

**Setup & data**

| Tool                      | Input              | What it does                                                                                            |
| ------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------- |
| `get_setup_status`        | —                  | Checks the project's business.yaml, Meta settings, database, data freshness and inbox; lists next steps |
| `get_business_profile`    | —                  | Returns the validated business profile                                                                  |
| `update_business_profile` | partial profile    | Creates/edits business.yaml (objects merge, arrays replace, `null` deletes; comments kept)              |
| `import_ads_from_folder`  | `dry_run?`         | Imports all CSV/XLSX exports in the project's `inbox/` (UPSERT), moves them to `processed/`             |
| `sync_ads_from_meta`      | `since?`, `until?` | Pulls daily ad insights + creatives from the Marketing API (default last 7 days)                        |
| `get_data_coverage`       | —                  | Dates available, gaps, sources, number of ads/ad sets/campaigns                                         |

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
| `import_competitor_ads`                | —                                                 | Loads the project's `competitors/<name>.csv/.json` saved by hand                     |
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

**Managing ads** (changes run only via `execute_ad_action` after the user confirms; off unless `META_WRITE_ENABLED`)

| Tool                    | Input                                                                                                   | What it does                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `search_targeting`      | `kind` (location/interest), `query`, `country_code?`                                                    | Location keys and interest ids for new ad sets (read-only)                                    |
| `propose_new_campaign`  | `name`, `objective`, `budget_level`, `daily_budget`, `status`, `special_ad_categories?`, `adset`        | Preview of a new campaign with its first ad set                                               |
| `propose_new_adset`     | `campaign_id`, `daily_budget?`, `status`, `adset`                                                       | Preview of a new ad set in an existing campaign                                               |
| `get_meta_structure`    | `include_ads?`                                                                                          | Live campaigns / ad sets / ads with real ids, statuses and budgets (read-only)                |
| `list_creative_files`   | —                                                                                                       | Images/videos in the project's `creatives/` folder and which ads use them                     |
| `propose_new_ad`        | `file`, `adset_id`, `ad_name`, `primary_text`, `headline?`, `description?`, `cta`, `link_url`, `status` | Preview of a new ad from a creative file in an existing ad set                                |
| `propose_status_change` | `level`, `object_id`, `new_status`, `reason?`                                                           | Preview of pausing/activating a campaign, ad set or ad                                        |
| `propose_budget_change` | `level`, `object_id`, `new_daily_budget`, `reason?`                                                     | Preview of a daily budget change (cap enforced)                                               |
| `propose_duplicate`     | `level`, `object_id`, `status`, `new_name?`, `include_ads?`                                             | Preview of copying an ad or ad set                                                            |
| `execute_ad_action`     | `action_id`                                                                                             | Runs a confirmed proposal (asks the user directly where supported); resumes processing videos |
| `cancel_ad_action`      | `action_id`                                                                                             | Drops a pending proposal                                                                      |
| `list_ad_actions`       | `status?`, `limit?`                                                                                     | Audit log of proposals and executed changes                                                   |

**Memory**

| Tool                     | Input                                                                                                    | What it does                                                                               |
| ------------------------ | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `get_memory_briefing`    | —                                                                                                        | Strongest do/avoid lessons, insights, conflicts, stale lessons, changes waiting for review |
| `get_learnings`          | `category?`, `kind?`, `query?`, `include_retired?`, `limit?`                                             | Lessons ranked by confidence × confirmations × recency                                     |
| `record_learning`        | `statement`, `kind`, `category`, `evidence`, `confidence?`, `source?`, `tags?`, `related?`, `action_id?` | Saves a lesson (or confirms the matching one; flags contradictions)                        |
| `update_learning`        | `id`, `action` (confirm/contradict/retire/reactivate/edit), `note?`, `statement?`, `confidence?`         | Maintains a lesson                                                                         |
| `review_action_outcomes` | `min_days?`, `include_reviewed?`                                                                         | Before/after facts for confirmed Ads Manager changes                                       |

**Reports**

| Tool           | Input                                 | Returns                                                        |
| -------------- | ------------------------------------- | -------------------------------------------------------------- |
| `save_report`  | `type`, `title`, `markdown`           | Writes `projects/<client>/reports/YYYY-MM-DD-<type>.md`        |
| `list_reports` | `type?`, `since?`, `until?`, `limit?` | Saved reports, newest first                                    |
| `get_report`   | `id?`, `date?`, `type?`               | A report's Markdown (latest of a type if only `type` is given) |

### Resources

| URI                            | Content                                                                           |
| ------------------------------ | --------------------------------------------------------------------------------- |
| `marketing://projects`         | All client projects and the active one                                            |
| `marketing://business-profile` | The active project's business.yaml as JSON                                        |
| `marketing://reports/latest`   | Most recent daily briefing                                                        |
| `marketing://memory`           | The active project's lessons (Markdown)                                           |
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

- **Ads Manager changes cover the common cases, all confirm-first**: new campaigns (Sales/Leads/Traffic/Awareness) and
  ad sets, new ads, pause/activate, daily budgets, duplicates. Not built: messaging/app/catalog campaigns, lifetime
  budgets, bid caps, custom/lookalike audience creation, deleting, editing live creatives. Not tested against the live
  API in CI (fixture-tested only) — try a PAUSED campaign first.
- **Competitor sales are not public**; positioning is an estimate from observable signals and says so.
- **Ad Library API**: Meta only returns _commercial_ ads delivered in the **EU** (plus political/issue ads
  worldwide). For other countries (e.g. Bangladesh), browse the public Ad Library (`get_ad_library_link`) and save
  ads to `projects/<client>/competitors/<name>.csv` (template: [`examples/competitor-ads-template.csv`](examples/competitor-ads-template.csv)).
- **Websites**: public pages only, robots.txt respected, no JavaScript rendering — content loaded by scripts isn't
  seen. Extraction of prices/offers is heuristic.
- **Frequency** from daily exports is approximate (daily reach can't be de-duplicated across days).
- **Market research** uses Claude's own web search; the server stores results but doesn't search.
- Runs locally (one workspace per `PROJECTS_DIR`); it is not a hosted multi-user service. The active project is
  shared by every chat using the same server, so prompts tell Claude to pass `project` explicitly.
- Only Meta ads in v1; the canonical `ad_daily` model is ready for other sources (Google, TikTok) later.

## Privacy & security

- `.env` and everything in `projects/` (profiles, `project.env`, data, reports) are gitignored. All data stays on
  your machine; no telemetry. Each project is an isolated folder with its own database.
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
