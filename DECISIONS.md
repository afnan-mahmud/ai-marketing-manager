# Design decisions

Non-obvious choices made while building, per ARCHITECTURE.md ("choose the simplest option and note it here").

## Runtime & configuration

- **Paths resolve from the repo root, not the cwd.** MCP clients (Claude Desktop) launch the server with an
  arbitrary working directory, so a relative `PROJECTS_DIR` and the root `.env` are resolved against the repo folder
  (two levels above `dist/config/paths.js`). Absolute paths are used as-is.
- **dotenv runs with `quiet: true`.** dotenv ≥17 prints a banner to stdout, which would corrupt the stdio transport.

- **business.yaml is re-read on every tool call**, so manual edits apply without restarting the server.
- **Analytics works without business.yaml** using default thresholds (primary KPI = purchases, no targets) and a
  warning; tools that genuinely need the profile (competitors, market context, profile) return `ConfigMissingError`.
- **`update_business_profile` edits YAML through `yaml`'s Document API** so existing comments survive. Objects merge
  key by key, arrays (products, competitors) are replaced wholesale, `null` deletes a key. If the file does not exist
  it is created from the patch alone (not from the example) so example competitors never leak into a real profile.

## Agency workspace (multiple client projects)

- **One folder per client project** under `PROJECTS_DIR` (default `./projects`): `projects/<slug>/` holds
  `project.json` (name, created date), `business.yaml`, `project.env`, `app.db` and the `inbox/`, `processed/`,
  `competitors/`, `snapshots/`, `reports/` folders. The folder name is the slugified project name (Unicode letters such
  as Bangla are kept). Separate SQLite files per project give hard isolation: no query can mix clients, and a project
  can be copied, backed up or archived as one folder. This replaced the single `data/` + `config/business.yaml`
  layout (and the `DATA_DIR` / `BUSINESS_CONFIG` env vars).
- **Project selection:** every project tool and prompt takes an optional `project` (name or folder, case-insensitive),
  added automatically to each tool's MCP schema. Without it, the **active project** (`projects/.active`, set by
  `create_project` / `switch_project`) is used; with exactly one project, that one. With several projects and no active
  one, tools refuse with the list of projects instead of guessing. Every project-tool result echoes
  `project: {name, slug}` so Claude can confirm whose data it got.
- **Explicit beats active.** The active project is server-wide state shared by every chat connected to the same server
  process, so prompts instruct Claude to pass `project` on every call for the client being discussed.
- **Per-project Meta settings:** `project.env` (dotenv format) overrides the global `.env` for
  `META_ACCESS_TOKEN`, `META_AD_ACCOUNT_ID`, `META_AD_LIBRARY_TOKEN`, `META_API_VERSION`, `WEB_*`.
  `META_AD_ACCOUNT_ID` is **never inherited** from the global `.env` (it's ignored there, with a warning), so a sync can
  never pull one client's ads into another client's project. The token _is_ inherited, because agencies typically use
  one system-user token with access to all client ad accounts.
- **Tokens are not accepted through tools.** `configure_project_meta` sets only the ad account id and API version;
  tokens go in `.env` / `project.env` by hand so they never end up in chat transcripts.
- Project contexts (DB connection + services) are opened lazily and cached; a project is reloaded when its
  `project.env` modification time changes, so edits apply without restarting the server.
- **Archive, never delete:** `archive_project` requires `confirm: true` and moves the folder to
  `projects/_archived/<slug>-<timestamp>`.
- `create_project` accepts an optional `business` patch (same shape as `update_business_profile`) so a project can be
  created with its profile in one step; otherwise the `setup_wizard` prompt fills it in.

## Database

- Migrations are plain `.sql` files applied in filename order and tracked in `schema_migrations`. The build copies
  them to `dist/` (scripts/copy-assets.mjs).
- Migration 002 adds `competitors.active` (soft delete — removing a competitor keeps its history) and
  `competitors.is_self` (the user's own brand is stored as a competitor row so the same signals/snapshots apply).

## Folder import

- **Ad id fallback:** exports without an "Ad ID" column get `ad_id = "h_" + sha1(campaign|adset|ad name)[:16]`
  (case/space-insensitive). Renaming an ad in Ads Manager therefore creates a new id for export-only users.
- **"Results" column** is used only when its "Result indicator" names purchases/leads/messages and the
  dedicated column for that conversion is absent or zero on that row (avoids double counting).
- **Duplicate (day, ad) rows** in one file (exports with age/placement breakdowns) are summed, with a warning that
  reach/frequency will be overstated.
- **Ambiguous slash dates** (03/04/2026) are read as month/day/year (Ads Manager's US default) with a warning;
  unambiguous D/M/Y and ISO dates are detected automatically. Bengali digits and South Asian digit grouping
  (1,23,456) are supported.
- **Derived columns** (CTR, CPC, CPM, Frequency, Cost per…, ROAS, rates) are ignored silently because we recompute
  them from counts; any other unknown column is listed in a warning.
- Files that fail to import stay in the project's `inbox/` (only successful files move to `processed/`).
- **Sample data** is generated by `scripts/generate-sample-data.mjs` (seeded PRNG, deterministic) so scenarios
  can be tuned and regenerated. Conversions use fractional accumulation rather than random draws so each seeded
  ad's CPA lands reliably on its intended side of the targets in `business.example.yaml`.

## Analytics

- **Relative periods anchor to the last data day when data is stale.** If the newest stored day is older than
  yesterday, "yesterday"/"last_7d"/… are computed as if today were the day after the last data day, and the result
  carries a warning (plus a "data is stale" warning after 2 days). Explicit `{since, until}` ranges are never moved.
  This keeps the tools useful with exported data (and the bundled sample) instead of returning empty periods.
- **Frequency from daily rows is approximate.** Summing daily reach over-counts unique people, so multi-day
  frequency = impressions / Σ daily reach is roughly the _average daily_ frequency (a lower bound). The fatigue
  threshold (`fatigue_frequency`) is compared against this number. Documented in the glossary.
- **Verdict rules (classify.ts):**
  - `learning` if spend < `min_spend_for_verdict` **or** impressions < `min_impressions_for_verdict`.
  - With targets: `winner` = meets _every_ configured target (CPA ≤ max_cpa and, when purchase value is tracked,
    ROAS ≥ min_roas). `loser` = CPA > 1.5 × max_cpa, or zero conversions after spending ≥ 1.5 × max_cpa
    (only min_roas set: ROAS < min_roas / 1.5). ROAS targets are ignored when no purchase value is tracked at all.
  - Without targets: quartiles of CPA among non-learning ads (zero-conversion ads rank most expensive); needs ≥ 4
    such ads, otherwise everything is `average` with `NO_TARGETS_TOO_FEW_ADS`.
  - `fatigued` overrides the above: the ad's previous 14 days (baseline) classify as `winner` on their own **and**
    in the recent window (last ≤ 7 days of the period, or `lookback_days`) frequency ≥ threshold **and**
    (CTR down ≥ 20% **or** CPA up ≥ 25%). "and/or" in the spec was read as "frequency AND (CTR OR CPA)".
- **Breakdown verdicts at campaign/ad set level** use the same target/quartile rules (no fatigue layer).
- **Budget candidates:** efficiency index = conversion share / spend share. Under-funded = index ≥ 1.3, or a
  `winner` with index ≥ 1. Over-funded = loser, index < 0.7, or no conversions — only with ≥ 5% of spend.
- **Funnel benchmarks** (hook 25%, hold 15%, LPV 60%, ATC 5%, cart→purchase 20%, CPM +15% with CTR ±10% =
  saturation) are rule-of-thumb constants in `analytics/diagnostics.ts`, returned with every diagnostics result so
  Claude can explain them. Minimum volumes (50 link clicks, 100 LPVs, 10 carts) avoid flags on noise.
- Responses use a compact KPI set per entity (`COMPACT_METRICS`) to keep tool output small for the client.

## Reports, prompts, resources

- **One report per (date, type).** Saving the same type twice on a day overwrites the file and updates the row —
  re-running a briefing replaces it rather than piling up drafts. File: `data/reports/YYYY-MM-DD-<type>.md`
  (report types are restricted to `[a-z0-9_]` so they are safe in file names).
- If the Markdown doesn't start with a heading, the title is prepended as `# <title>`.
- **Prompts are plain instructions** (a single user message) listing tool calls in order plus shared "house rules"
  (language from `business.language`, currency, facts vs recommendations, honesty about missing/stale data,
  read-only toward Meta, positioning is an estimate). MCP prompt arguments are strings, so numeric args
  (`days`, `count`) are parsed and clamped.
- **The glossary resource is generated from code** (`METRIC_DEFINITIONS`, verdict constants, `BENCHMARKS`) so it
  always matches what the tools compute. The playbook is a static Markdown file for community edits.
- Competitors in business.yaml are mirrored into the DB (`syncFromConfig`) whenever the profile is edited
  through the tool and before competitor tools run, so manual YAML edits are picked up too.

## Meta Marketing API

- **Overlapping action types are never summed.** Meta reports one purchase as `omni_purchase`, `purchase` and
  `offsite_conversion.fb_pixel_purchase` at once; `ACTION_TYPE_MAP` lists types in priority order and the first one
  present wins. Same for add-to-cart, checkout, leads and landing page views.
- Link clicks come from `inline_link_clicks` (fallback: the `link_click` action); 3-second video views from the
  `video_view` action; ThruPlays from `video_thruplay_watched_actions`.
- **Retries:** HTTP 429/5xx, `is_transient`, and Graph rate-limit codes (4, 17, 32, 613, 800xx) back off
  exponentially (1s, 2s, 4s, 8s; capped at 16s; 4 retries) — short enough that an MCP call doesn't hang for minutes.
  Usage headers (`x-business-use-case-usage`, `x-ad-account-usage`, `x-app-usage`) ≥ 80% log a warning.
- Errors are mapped to friendly messages (expired token 190, permissions 10/200-299, bad params 100, rate limits),
  and every message/URL passes through `redact()` so the token never reaches logs or the client.
- `sync_ads_from_meta` is limited to 93 days per call (synchronous insights paging); larger backfills should be
  split. Creatives are fetched in batches of 50 via `?ids=`; a creative failure doesn't fail the sync.
- **Mixing sources:** export rows without Ad IDs get hashed ids, so the same ad imported from an export _and_
  synced from the API would be counted twice. The sync warns when it detects this; the fix is to include the
  "Ad ID" column in exports (then ids match and rows UPSERT onto each other).
- The account id accepts `act_123` or `123` (the `act_` prefix is stripped in env parsing).

## Competitors

- **The user's own brand is tracked like a competitor** (`is_self` row named after `business.name`, website from
  `business.website` + `business.extra_urls`) so website snapshots, signals and positioning apply to it. Tools
  accept `"self"` / `"me"` as its name.
- **Competitor tools require business.yaml** (it is the competitor list's source of truth); add/remove edit the
  YAML (comments preserved) and soft-deactivate in the DB so history is kept.
- **Web fetching:** robots.txt is fetched once per origin per server run; 4xx = no robots.txt (allowed), 5xx or
  network failure = treat as disallowed (conservative). The robots.txt request itself counts toward the
  1 request/second per-host limit. Pages > 3 MB are truncated to 3 MB (not rejected) and flagged. Non-HTML content
  types are rejected. No cookies, no login, no JavaScript rendering.
- **Snapshots:** a DB row is stored on every run (so "last checked" is accurate), but the raw text file in
  `data/snapshots/<brand>/` is only written when the content hash changes. The hash covers title + visible text.
- **Extraction is heuristic** (regex over visible text): prices with ৳/Tk/BDT/$/€/£/₹/Rs/RM/AED before or after
  the amount (Bengali digits normalized), offer phrases (% off, free delivery, COD, BOGO, bundles, limited time,
  codes, guarantees), CTA-like buttons/links, ratings/review/customer counts and testimonial blocks.
- **Manual competitor ads** are read from `data/competitors/<slug-of-name>.csv|json` and left in place (re-import
  is an idempotent UPSERT keyed by a hash of headline|body|start_date|landing_url, or an `ad_id` column).
- **"Proven" = running ≥ 30 days** (start_date or first_seen → today if active, last_seen otherwise), active or not.
- Ad Library results store `ad_creative_link_captions[0]` (the displayed domain) as `landing_url` — the API doesn't
  expose the real destination URL.

## Positioning (Market Presence Score)

- Each signal is scored 0–100 **relative to the best brand on that signal**: log scale for heavy-tailed counts
  (active ads, social proof, followers, traffic), linear for longevity/velocity/offers, and for price the cheapest
  brand scores 100 (`price_position` = median plausible detected price ÷ the user's average product price; prices
  outside 0.2×–5× are ignored as unrelated). Missing data is `null` (unknown), never 0, and is excluded from the
  weighted average; `coverage_pct` reports how much of the total weight had data. Confidence: ≥ 70% high,
  ≥ 40% medium, else low. Brands with no data get no rank.
- Own-brand ad signals come from the user's own ad data (complete) while competitor ad signals come from the
  Ad Library or manual imports (usually incomplete) — Claude is told the score is an estimate.
- `record_competitor_signal` values override derived ones when named after a signal (aliases: `social_followers`,
  `web_traffic`/`monthly_visits`, `review_count`).

## Market

- The server never searches the web; `get_market_context` returns the profile, recent snapshots, recurring trends and
  **suggested search queries** for Claude's own web search, and `save_market_snapshot` stores what Claude found.
- **Recurring trends** are grouped by word-set (Jaccard) similarity ≥ 0.5 after removing stop words, so slightly
  different phrasings of the same trend count together; prompts also ask Claude to reuse the exact wording.
  `current_streak` counts consecutive snapshot days (ending at the latest snapshot) on which a trend appeared.
- Several snapshots per day are allowed (each research run is kept).

## Dependencies & tooling

- **Node.js ≥ 22** (spec said ≥ 20). Node 20 reached end-of-life in April 2026, and current `better-sqlite3` (13)
  and `vitest` (5) require Node 22+. CI tests Node 22 and 24.
- **`exceljs` instead of SheetJS `xlsx`.** The `xlsx` package on npm (0.18.5) has unfixed high-severity advisories
  (prototype pollution, ReDoS); fixed builds are only published on SheetJS's own CDN, which complicates installs
  (and is blocked in some sandboxes/CI). `exceljs` reads `.xlsx` (dates, formulas, rich text). Legacy `.xls` is
  rejected with a clear message to re-export as `.xlsx`/`.csv`. Workbook dates are read as UTC calendar days.
  `uuid` is pinned to ≥ 11.1.1 via `overrides` so `npm audit` is clean.
- `npm run build` cleans `dist/` first, so removed modules can't linger in the build output.
- `scripts/smoke-test.mjs` starts the built server over stdio with a temp data dir and runs a few tools on the
  sample data; CI runs it after the build.

## Ads Manager changes (confirm-first)

- **The original "read-only toward Meta" rule was replaced at the user's request** with: every change is a stored
  proposal that the user must confirm before it runs. Claude can never execute a change it wasn't asked to make,
  and the server re-validates at execution time.
- **Two gates:** Claude is instructed (tool descriptions, prompts) to ask before `execute_ad_action`, and the server
  asks the human directly via MCP elicitation when the client supports it — Claude can't answer that dialog. Without
  elicitation support the client's tool-permission prompt for the destructive `execute_ad_action` is the remaining
  gate; the log records which gate was used. A confirmation dialog that errors counts as "declined".
- **Off per project by default** (`META_WRITE_ENABLED=false`). It, the Page id, Instagram id and budget cap are
  project-only settings (never inherited from the global `.env`). `configure_project_meta` may turn it on, but its
  description says to do so only when the user asks.
- **Ownership check** (`account_id` of the target equals the project's ad account) before proposing and before
  executing, so a wrong id can never touch another client's ads.
- **Initial status is always chosen by the user** (`status` is required on new ads and duplicates; no default).
- **Budgets** are entered in normal currency units and converted to Meta's minor units (×100, ×1 for zero-decimal
  currencies such as JPY/KRW/IDR/VND). A budget change is refused if the live budget changed since the preview.
- **Writes are not retried** on network errors or 5xx (the change may have happened); only rate-limit rejections retry.
  Multi-step new-ad creation stores each created id as it goes so a failure reports exactly what already exists.
- **Videos**: uploaded with the simple (non-resumable) endpoint, so ≤ 500 MB; the server polls processing for up to
  ~4 minutes, then leaves the action in `processing` — calling `execute_ad_action` again resumes without asking again.
  The preferred Meta thumbnail is used for the video creative.
- New ads use `object_story_spec` with `link_data` (image) or `video_data` (video) and `instagram_user_id` when set.
- **Not built:** deleting, editing creatives of live ads, automated rules (campaign creation was added later, below).

## Creating campaigns and ad sets

- **Supported objectives are limited to ones with an unambiguous setup:** Sales (`OFFSITE_CONVERSIONS`, pixel +
  `PURCHASE`), Leads (website, pixel + `LEAD`), Traffic (`LANDING_PAGE_VIEWS` by default, or `LINK_CLICKS`) and
  Awareness (`REACH`), all `billing_event=IMPRESSIONS`, `bid_strategy=LOWEST_COST_WITHOUT_CAP`. Messenger/WhatsApp,
  app, catalog and on-Facebook lead-form campaigns need destination/creative setups that differ a lot; for those the
  tools tell Claude to duplicate an existing ad set instead.
- **Campaign + first ad set are one proposal** (`propose_new_campaign`), because a campaign without an ad set is
  useless and the budget choice (campaign vs ad set) spans both. Extra ad sets use `propose_new_adset`. Ads are always
  separate proposals, so nothing can spend before the user has confirmed an ad too.
- **Pixel is a project-only setting** (`META_PIXEL_ID`) like the ad account, so one client's pixel can't be used for
  another. `PROJECT_ENV_KEYS` is now derived from `PROJECT_ONLY_KEYS` so a new per-project key can't be forgotten.
- **`is_adset_budget_sharing_enabled`:** newer Graph API versions require it on campaigns without a campaign budget;
  older versions reject unknown fields. The campaign is created without it and, only if Meta's error names that field,
  retried once with `false` (the rejected request created nothing, so the retry is safe).
- **Targeting is explicit:** `targeting_automation.advantage_audience` is always sent (default 0 = exactly the given
  audience; the user can turn it on), `location_types` = home + recent, ages default 18–65, placements default to
  Advantage+ (no `publisher_platforms`). Region/city keys and interest ids come from `search_targeting`
  (`/search?type=adgeolocation|adinterest`) — Claude must not invent them; non-numeric keys are rejected.
- **Daily budgets only** (no lifetime budgets: they require end dates and pacing rules); the per-project cap applies to
  new campaigns and ad sets too. Campaign-budget campaigns reject an ad set budget and vice versa, before calling Meta.
- If the ad set fails after the campaign was created, the result names the campaign id and how to continue
  (`propose_new_adset` into it, or pause it).
- Meta enforces minimum daily budgets per currency and objective; we don't duplicate those rules — Meta's error is
  returned to the user.

## Memory (learning per client)

- **Claude writes lessons, the server keeps them honest.** The server never generates lessons (no LLM); it stores what
  Claude records, merges repeats, flags contradictions, ranks, and supplies before/after facts for confirmed changes.
- **Per project** (table `learnings` in the client's own DB) — one client's lessons never influence another's. An
  agency-wide memory was left out on purpose: what works for a skincare brand in Dhaka may be wrong for a restaurant.
- **Same lesson = same category + word overlap ≥ 0.5** (stop-word-free Jaccard, as for market trends). Same kind →
  confirmation (evidence replaced by the newest, history kept); `do` vs `avoid` → new lesson + contradiction on the old
  one, reported as a conflict for the user to resolve. `insight` never conflicts.
- **Confidence** never goes down automatically; it rises to at least medium at 2 confirmations and high at 5, or to
  whatever Claude/the user sets. **Score** = confidence weight (0.5/1/1.5) × (1 + log2 confirmations) × 0.5^(days since
  last confirmation / 90) ÷ (1 + contradictions) — used for ordering only.
- Lessons must be at least a sentence (≥ 10 chars) with evidence; vague notes are rejected.
- **Action outcomes:** for executed actions older than 3 days, the target (by real Meta id) is compared over up to 7
  days after vs the same number of days before; the account totals are compared too, since pausing one ad moves spend
  elsewhere. New ads/ad sets/campaigns/duplicates get a verdict with the normal rules. Recording a lesson with the
  action's id marks it reviewed. Outcomes are facts; deciding causality (other changes in the same window) is left to
  Claude and the prompts say so.
- `memory.md` is regenerated from the database on every change; it is a read-only view, edits go through
  `update_learning`.
