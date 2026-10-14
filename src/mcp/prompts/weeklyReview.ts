import { shiftDate } from "../../utils/dates.js";
import { assemble, type PromptDef } from "./common.js";

export const weeklyReview: PromptDef = {
  name: "weekly_review",
  title: "Weekly review",
  description:
    "Last 7 days vs the previous 7: what worked, what didn't, lessons, and next week's plan — with continuity from last week's reports.",
  argsSchema: {},
  build: (_args, ctx) => {
    const weekAgo = shiftDate(ctx.today(), -7);
    return assemble(
      "Weekly review",
      [
        "Review my last week of marketing and plan the next one.",
        "",
        "## Steps",
        "1. `get_setup_status` (refresh data if needed: `import_ads_from_folder` / `sync_ads_from_meta`).",
        '2. `get_performance_summary` (period "last_7d", compare true) — last 7 days vs the previous 7.',
        '3. `get_winners_and_losers` (period "last_7d"), `detect_creative_fatigue`, `get_funnel_diagnostics` (period "last_7d"), `get_budget_recommendations_data` (period "last_7d").',
        '4. `get_daily_trend` (period "last_14d", metrics ["spend", "conversions", "cpa", "roas"]) to see the shape of the week.',
        `5. Continuity — \`list_reports\` with since "${weekAgo}", then \`get_report\` for the previous weekly_review and the latest ad_optimization_plan / content_plan. Check which recommendations were followed and whether they worked.`,
        `6. \`get_market_history\` (days 7) and \`get_competitor_website_changes\` (since "${weekAgo}").`,
        "",
        "## Output",
        "- **Week in numbers** — table of key KPIs: this week, last week, change, better/worse.",
        "- **What worked** — with evidence (ads, angles, offers, audiences).",
        "- **What didn't** — with evidence, and the likely reason.",
        "- **Last week's plan: scorecard** — each previous recommendation: done / not done / result.",
        "- **Lessons** — 3 short, reusable lessons.",
        "- **Next week's plan** — budget moves, ads to pause/scale, 2–3 creative tests (one variable each, success metric), content themes, and anything to fix on the site/funnel.",
        "",
        'Finally call `save_report` with type "weekly_review".',
      ],
      ctx,
    );
  },
};
