import { assemble, type PromptDef } from "./common.js";

export const setupWizard: PromptDef = {
  name: "setup_wizard",
  title: "Setup wizard",
  description:
    "Guides a new user through creating the business profile, adding competitors and getting ad data in.",
  argsSchema: {},
  build: (_args, ctx) =>
    assemble(
      "Setup wizard",
      [
        "Help me set up my AI marketing manager. Be friendly, ask few questions at a time, and do the setup with tools.",
        "",
        "## 1. Check status",
        "Call `get_setup_status` and tell me in 2–3 lines what's done and what's missing. Skip steps that are already done.",
        "",
        "## 2. Business profile (if missing or incomplete)",
        "Ask me, in small batches:",
        "- Brand name, sector, country (2-letter code), currency (3-letter code), language for content, website.",
        "- Main products with price and approximate margin %.",
        "- Target audience and brand voice.",
        "- Primary goal: purchases, leads, messages or link clicks — and targets: max CPA, min ROAS, min CTR %, monthly budget (optional).",
        "Then call `update_business_profile` with the answers and show me a short summary of what was saved.",
        "",
        "## 3. Competitors",
        "Ask for 2–5 competitors (name + website, optional Facebook page id). Add each with `add_competitor`.",
        "Offer to take a first website snapshot with `snapshot_competitor_websites`, and give me each `get_ad_library_link` so I can browse their ads.",
        "",
        "## 4. Ad data — explain both options and help me pick",
        "**A) Export from Ads Manager (no API key needed):** Ads Manager → *Ads* tab → choose the date range → *Breakdown* → *By time* → *Day* →",
        "make sure the columns include Amount spent, Impressions, Reach, Link clicks, Landing page views, Adds to cart, Checkouts initiated,",
        "Purchases, Purchases conversion value (plus 3-second video plays and ThruPlays for video; Headline/Body help content ideas) →",
        "*Export* → *Export table data* → CSV or XLSX. Put the file in the `data/inbox/` folder, then I'll run `import_ads_from_folder`.",
        "**B) Meta Marketing API (automatic daily sync):** in Business Settings create a *System user*, give it access to the ad account,",
        "generate a token with only the `ads_read` permission, then set `META_ACCESS_TOKEN` and `META_AD_ACCOUNT_ID` (numbers only) in `.env`",
        "and restart the MCP server. Then `sync_ads_from_meta` pulls the last 7 days.",
        "",
        "## 5. Finish",
        "Run `get_setup_status` again, confirm everything is ready, and suggest trying the `daily_briefing` prompt.",
      ],
      ctx,
    ),
};
