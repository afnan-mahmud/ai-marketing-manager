import { assemble, optionalArg, type PromptDef } from "./common.js";

export const dailyBriefing: PromptDef = {
  name: "daily_briefing",
  title: "Daily marketing briefing",
  description:
    "Today's briefing: market news, competitor moves, how my ads did, how I compare, top 3 actions and a content idea. Saved as a report.",
  argsSchema: {
    period: optionalArg(
      'Main ad period. Default: "yesterday" for the headline, with "last_7d" for context.',
    ),
  },
  build: (args, ctx) => {
    const main = args.period || "yesterday";
    const context = args.period ? args.period : "last_7d";
    return assemble(
      "Daily marketing briefing",
      [
        "You are my AI marketing manager. Prepare today's briefing. Work through the steps, then write the briefing.",
        "",
        "## Steps",
        "1. **Data freshness** — `get_setup_status`. If files are waiting run `import_ads_from_folder`; if the Meta API is configured and data is older than yesterday run `sync_ads_from_meta`. If data is still stale, say so at the top of the briefing.",
        "2. **Market** — `get_market_context`. Then use your own web search (3–6 searches; start from `suggested_searches`) for sector news, trends, seasonal moments and platform changes relevant to my country and audience. Save the findings with `save_market_snapshot` (summary, trends with evidence + source URLs, sources). Reuse the exact wording of trends that recur.",
        "3. **Competitors** — `snapshot_competitor_websites`, then `get_competitor_website_changes` (since yesterday) and `get_competitive_positioning`. Skip gracefully if no competitors are configured.",
        `4. **My ads** — \`get_performance_summary\` (period "${main}") and (period "${context}"), \`get_winners_and_losers\` (period "${context}"), \`detect_creative_fatigue\`, \`get_funnel_diagnostics\` (period "${context}").`,
        '5. **Continuity** — `get_report` with type "daily_briefing" for the previous briefing: did yesterday\'s actions happen / work? Mention briefly.',
        "",
        "## Briefing format (Markdown, in this order)",
        '1. **Market today** — 3–5 bullets with sources; mark trends that have recurred (e.g. "3rd day in a row").',
        "2. **Competitors** — notable changes (new offers, price changes, new products/headlines), with the brand and what changed.",
        `3. **My ads** — headline numbers for ${main} and ${context} vs previous period (spend, results, CPA, ROAS); ✅ what's working (winners, with numbers) and ⚠️ what's not (losers, fatigue, funnel flags).`,
        "4. **Me vs competitors** — where I'm ahead/behind on the presence estimate and on offers/prices (state it's an estimate and the coverage).",
        "5. **Top 3 actions today** — specific, ordered by impact, each with the evidence and the expected effect. Things I can do in Ads Manager or on my site today.",
        "6. **Content idea of the day** — one post/reel idea: hook, angle, format, CTA, and why (linked to a winning ad, competitor move or trend).",
        "",
        'Finally call `save_report` with type "daily_briefing", a title like "Daily briefing — <date>", and the full Markdown. Then show me the briefing.',
      ],
      ctx,
    );
  },
};
