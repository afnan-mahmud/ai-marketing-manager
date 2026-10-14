import { assemble, optionalArg, type PromptDef } from "./common.js";

export const planCampaign: PromptDef = {
  name: "plan_campaign",
  title: "Plan & create a new campaign",
  description:
    "Plans a new Meta campaign from the client's data (objective, budget, audience, structure) and, if you approve, creates the campaign and ad set — each step only after your confirmation.",
  argsSchema: {
    goal: optionalArg(
      'What the campaign is for, e.g. "launch Niacinamide serum", "winter sale", "more leads".',
    ),
    budget: optionalArg("Daily budget you have in mind (account currency)."),
  },
  build: (args, ctx) =>
    assemble(
      "Plan a new campaign",
      [
        `Plan a new Meta campaign for this client${args.goal ? ` — goal: ${args.goal}` : ""}${args.budget ? `, around ${args.budget} per day` : ""}.`,
        "",
        "## Steps",
        "0. `get_memory_briefing` (and `get_learnings` with relevant words) — reuse what worked for this client, avoid what failed, and say which lessons (#id) shaped the result.",
        "1. `get_setup_status` and `get_business_profile` (products, audience, goals, monthly budget, targets).",
        '2. What already works: `get_breakdown` (level "adset" and "campaign", period "last_30d"), `get_winners_and_losers`, `get_top_creatives` — audiences, objectives and angles with the best CPA/ROAS. Use `get_budget_recommendations_data` for budget pacing.',
        "3. `get_meta_structure` — existing campaigns, so the new one doesn't overlap or compete with a running audience.",
        "",
        "## The plan (show it to me, don't create anything yet)",
        "- **Objective** (Sales needs the project's pixel; Leads too; Traffic; Awareness) and why.",
        "- **Budget**: daily amount, campaign budget vs ad set budget, and how it fits the monthly budget; start small enough to test.",
        "- **Audience**: locations (use `search_targeting` for city/region keys), age, gender, interests (`search_targeting` kind interest) or broad — with the evidence from past ad sets. Advantage+ audience on/off and why. Placements (default Advantage+).",
        "- **Creatives**: which files from `list_creative_files` (or what to make), with copy angles from the winners.",
        "- **Success metric & review date** (e.g. CPA below target after spending 2–3× target CPA).",
        "",
        "## Creating it (only after I approve the plan)",
        "1. Ask me: start **ACTIVE** or **PAUSED**? Then call `propose_new_campaign` (campaign + first ad set) and show me the preview with its warnings. Call `execute_ad_action` only after I say yes to that preview.",
        "2. For more ad sets in the same campaign: `propose_new_adset`, preview, my yes, `execute_ad_action` — one at a time.",
        "3. Ads: for each creative, `propose_new_ad` with the new ad set id, preview, my yes, `execute_ad_action`.",
        "4. If managing ads is off for this project or the pixel/Page is missing, say exactly what to set (`configure_project_meta`) — don't enable it unless I ask.",
        "",
        'Save the plan with `save_report` (type "campaign_plan") and finish with a table of everything created (ids, status).',
      ],
      ctx,
    ),
};
