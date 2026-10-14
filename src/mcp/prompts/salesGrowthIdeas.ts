import { assemble, type PromptDef } from "./common.js";

export const salesGrowthIdeas: PromptDef = {
  name: "sales_growth_ideas",
  title: "Sales growth ideas",
  description:
    "Ranked ideas to grow sales across offer, pricing/bundles, landing page, retargeting, creatives and trust/delivery.",
  argsSchema: {},
  build: (_args, ctx) =>
    assemble(
      "Sales growth ideas",
      [
        "Find the highest-leverage ways to get more sales, based on where my funnel leaks and what the market offers.",
        "",
        "## Steps",
        "0. `get_memory_briefing` (and `get_learnings` with relevant words) — reuse what worked for this client, avoid what failed, and say which lessons (#id) shaped the result.",
        '1. `get_performance_summary` (period "last_30d") and `get_funnel_diagnostics` (period "last_30d") — where is the biggest drop-off?',
        '2. `get_budget_recommendations_data` (period "last_30d") — is budget in the right places?',
        "3. `get_business_profile` — products, prices, margins (ideas must protect margin).",
        "4. `get_competitive_positioning` and `get_competitor_website_changes` — competitor offers, prices, delivery/COD promises, social proof.",
        "5. `get_market_context` — trends and seasonal moments.",
        "",
        "## Output",
        "- **Where sales leak** — the funnel step with the biggest loss, with numbers.",
        "- **Ideas table** — Rank · Area (Offer / Pricing & bundles / Landing page / Retargeting / Creative / Trust, COD & delivery) · Idea · Evidence (data or competitor fact) · Expected impact (H/M/L) · Effort (H/M/L) · How to test & measure.",
        "- Rank by impact ÷ effort; put **3 quick wins** for this week first.",
        "- For pricing/discount ideas, show the margin impact using margin_pct from the profile.",
        "",
        'Finally call `save_report` with type "sales_growth_ideas" and the full Markdown.',
      ],
      ctx,
    ),
};
