import { assemble, optionalArg, type PromptDef } from "./common.js";

export const competitorReport: PromptDef = {
  name: "competitor_report",
  title: "Competitor report",
  description:
    "Deep dive on one or all competitors: offers, pricing, messaging, ad patterns, recent changes, and where I'm ahead or behind.",
  argsSchema: { name: optionalArg("Competitor name (default: all competitors).") },
  build: (args, ctx) => {
    const target = args.name ? `"${args.name}"` : "every competitor";
    return assemble(
      `Competitor report — ${args.name ?? "all competitors"}`,
      [
        `Analyse ${target} against my brand.`,
        "",
        "## Steps",
        "1. `list_competitors`.",
        `2. \`snapshot_competitor_websites\`${args.name ? ` with names ["${args.name}"]` : ""} to refresh (skip if a snapshot is from today).`,
        `3. For ${target}: \`get_competitor_profile\`, and \`get_competitor_website_changes\` with since = 30 days ago.`,
        `4. \`get_competitor_ads\`${args.name ? ` (name "${args.name}")` : ""} — focus on proven ads (30+ days). If none are stored, call \`fetch_competitor_ads\`; if that's unsupported for my country, give me the \`get_ad_library_link\` URLs and explain the manual import (data/competitors/<name>.csv).`,
        '5. `get_competitive_positioning` and `get_competitor_profile` with name "self" — my own website and signals for comparison.',
        '6. `get_top_creatives` (period "last_30d") — my winning angles, to compare messaging.',
        "7. Optional: a few web searches on the competitor(s) for news, launches, influencer campaigns.",
        "",
        "## Output",
        "Per competitor: **Positioning & messaging** (headline promises, tone) · **Offers & pricing** (with detected prices vs mine) · **Ad patterns** (formats, hooks, angles, proven ads and how long they've run) · **Social proof** · **Recent changes** (dated).",
        "Then: **Where I'm ahead** · **Where I'm behind** · **Opportunities** (3–5, specific: angles they don't use, offers to answer, gaps in their funnel) · **Threats to watch**.",
        "Include the Market Presence table with the coverage % and confidence, and say clearly it's an estimate, not sales.",
        'If data is missing (no snapshots, no ads), list exactly what to collect and how. Finally call `save_report` with type "competitor_report".',
      ],
      ctx,
    );
  },
};
