import { assemble, optionalArg, type PromptDef } from "./common.js";

export const adOptimizationPlan: PromptDef = {
  name: "ad_optimization_plan",
  title: "Ad optimization plan",
  description:
    "Concrete plan of what to pause, scale, fix, duplicate and test, with evidence, expected impact and priority.",
  argsSchema: {
    period: optionalArg('Analysis period, e.g. "last_14d" (default), "last_7d", "last_30d".'),
  },
  build: (args, ctx) => {
    const period = args.period || "last_14d";
    return assemble(
      "Ad optimization plan",
      [
        "You are my performance marketing manager. Build an ad optimization plan from my real data.",
        "",
        "## Steps",
        "0. `get_memory_briefing` (and `get_learnings` with relevant words) — reuse what worked for this client, avoid what failed, and say which lessons (#id) shaped the result.",
        "1. `get_setup_status` — if files are waiting in the inbox run `import_ads_from_folder`; if the Meta API is configured and data is stale run `sync_ads_from_meta`.",
        `2. \`get_performance_summary\` with period "${period}".`,
        `3. \`get_winners_and_losers\` with period "${period}" and \`get_breakdown\` (level "adset", period "${period}").`,
        "4. `detect_creative_fatigue`.",
        `5. \`get_funnel_diagnostics\` with period "${period}".`,
        `6. \`get_budget_recommendations_data\` with period "${period}".`,
        '7. `get_report` with type "ad_optimization_plan" to see the previous plan (if any) and check what changed since.',
        "",
        "## Output",
        "- **Snapshot** — 3–5 bullets of facts (spend, results, CPA/ROAS vs target, trend vs previous period).",
        "- **Action plan** — a table: Priority (P1/P2/P3) · Action (Pause / Scale / Fix / Duplicate & iterate / Test) · Ad or ad set · Evidence (reason codes + numbers) · Expected impact · Effort.",
        "  - Pause: losers with enough spend. Scale: winners and under-funded winners (suggest ~20% budget steps).",
        "  - Fix: funnel flags (hook, landing page, offer, checkout). Refresh: fatigued ads (new hook/angle first).",
        "  - Test: 2–3 specific tests (hook, offer, audience, placement), one variable each, with a success metric.",
        "- **Budget moves** — from where to where, in currency amounts per day, as suggestions.",
        "- **What to watch** — watchlist ads and the metric/threshold that would change the decision.",
        "",
        'Then call `save_report` with type "ad_optimization_plan" and the full Markdown.',
        "",
        "## Applying the plan (only if I want to)",
        "Ask me which actions to apply. For each one I pick: call `get_meta_structure` for the real ids, then the matching `propose_*` tool",
        "(`propose_status_change`, `propose_budget_change`, `propose_duplicate`), show me the preview, and call `execute_ad_action` only after I say yes to that preview.",
      ],
      ctx,
    );
  },
};
