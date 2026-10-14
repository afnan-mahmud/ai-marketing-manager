import { assemble, optionalArg, tomorrow, type PromptDef } from "./common.js";

export const contentPlan: PromptDef = {
  name: "content_plan",
  title: "Content plan",
  description:
    "A dated content calendar built from my best-performing ads, proven competitor ads and market trends.",
  argsSchema: {
    days: optionalArg("Number of days to plan (default 7)."),
    platform: optionalArg(
      'Platform focus, e.g. "Instagram Reels", "Facebook" (default Facebook & Instagram).',
    ),
  },
  build: (args, ctx) => {
    const days = Math.min(Math.max(parseInt(args.days ?? "7", 10) || 7, 1), 31);
    const platform = args.platform || "Facebook & Instagram";
    return assemble(
      `Content plan — ${days} days`,
      [
        `Plan ${days} days of content for ${platform}, starting ${tomorrow(ctx)}. Every idea must be traceable to data.`,
        "",
        "## Steps",
        "0. `get_memory_briefing` (and `get_learnings` with relevant words) — reuse what worked for this client, avoid what failed, and say which lessons (#id) shaped the result.",
        "1. `get_business_profile` — products, audience, brand voice, language.",
        '2. `get_top_creatives` (period "last_30d", by "cpa", limit 5) and again with by "hook_rate" — what angle, hook, format and offer do my winners share?',
        '3. `get_winners_and_losers` (period "last_30d") — note which patterns lose, to avoid them.',
        "4. `get_competitor_ads` with proven_only true — angles and offers competitors keep paying for (ads running 30+ days).",
        "5. `get_market_history` (days 14) — recurring trends, seasonal moments, news worth riding.",
        "6. `list_reports` with type \"content_plan\" and `get_report` for the latest one — don't repeat last plan's ideas.",
        "",
        "## Output",
        "- **What the data says** — 3–5 bullets: the winning patterns (cite ad names and their CPA/ROAS/hook rate).",
        "- **Calendar** — table: Date · Format (Reel/Static/Carousel/Story/Live) · Angle & hook (first line / first 3 seconds) · Key message · Offer · CTA · Why (link to a winning ad, competitor pattern or trend).",
        "- Mix: ~60% proven angles (iterations of winners), ~30% new tests, ~10% brand/community.",
        "- **Tests to learn from** — which posts are experiments and how we'll judge them.",
        "",
        'Finally call `save_report` with type "content_plan" and the full Markdown.',
        "Tell me that when the content is made I can drop the images/videos into this project's `creatives/` folder and use the `launch_ads` prompt to turn them into ads (each one only after my confirmation).",
      ],
      ctx,
    );
  },
};
