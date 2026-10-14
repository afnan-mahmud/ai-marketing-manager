import { assemble, optionalArg, type PromptDef } from "./common.js";

export const scriptIdeas: PromptDef = {
  name: "script_ideas",
  title: "Ad script ideas",
  description:
    "Ad scripts modelled on the patterns of my winning ads: hook, beats, CTA, on-screen text and shot list.",
  argsSchema: {
    count: optionalArg("How many scripts (default 3)."),
    format: optionalArg('"reel" (default), "static" or "carousel".'),
    angle: optionalArg(
      'Optional angle to focus on, e.g. "testimonial", "before-after", "offer", "founder story".',
    ),
  },
  build: (args, ctx) => {
    const count = Math.min(Math.max(parseInt(args.count ?? "3", 10) || 3, 1), 10);
    const format = ["reel", "static", "carousel"].includes(args.format ?? "")
      ? args.format!
      : "reel";
    const shape =
      format === "reel"
        ? "**Hook (0–3s)**: visual + spoken line + on-screen text · **Body beats** with timestamps (aim 15–30s total) · **CTA** · **On-screen text** list · **Shot list** · **Caption** (first line matters) · **Music/sound** note."
        : format === "carousel"
          ? "**Slide 1 hook** (headline + visual) · **Slides 2–N** (one idea each) · **Last slide CTA** · **Caption** · **Design notes**."
          : "**Visual concept** · **Headline on image** · **Primary text** (first line hook) · **CTA** · **Design notes** · 2 headline variants to A/B test.";
    return assemble(
      `${count} ${format} script ideas`,
      [
        `Write ${count} ${format} ad script(s)${args.angle ? ` with the angle "${args.angle}"` : ""} based on what already works for me.`,
        "",
        "## Steps",
        "1. `get_business_profile` — product details, prices, audience, brand voice.",
        '2. `get_top_creatives` (period "last_30d", by "cpa") and (by "hook_rate") — study the winners\' hooks, angles, offers, CTAs and formats.',
        '3. `get_winners_and_losers` (period "last_30d") — what do losers have in common? Avoid it.',
        "4. Optional: `get_competitor_ads` with proven_only true for angles competitors keep running.",
        "",
        "## Output — for each script",
        `- **Title** and **angle**, and **Based on**: which winning ad(s) and which metric (e.g. "UGC Review — CPA 301, hook rate 38%").`,
        `- ${shape}`,
        "- **Hypothesis**: what this tests and which metric decides (e.g. hook rate > 30%, CPA < target).",
        "",
        "Write the scripts in the business language and brand voice. Keep claims honest (no medical/unsupported promises).",
        'Finally call `save_report` with type "script_ideas" and the full Markdown.',
      ],
      ctx,
    );
  },
};
