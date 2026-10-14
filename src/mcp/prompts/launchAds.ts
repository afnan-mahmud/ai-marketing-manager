import { assemble, optionalArg, type PromptDef } from "./common.js";

export const launchAds: PromptDef = {
  name: "launch_ads",
  title: "Launch ads from my creatives",
  description:
    "Turns the images/videos in the project's creatives/ folder into Meta ads — copy, ad set and status proposed by Claude, each ad created only after you confirm it.",
  argsSchema: {
    files: optionalArg(
      "Which files (comma-separated, as in creatives/). Default: the ones not used in an ad yet.",
    ),
  },
  build: (args, ctx) =>
    assemble(
      "Launch ads from creatives",
      [
        "I've put new content in this project's `creatives/` folder. Help me turn it into ads.",
        "",
        "## Steps",
        "1. `get_setup_status` and `list_ad_actions` (status pending) — if managing ads is off for this project, stop and explain how to enable it (`configure_project_meta` with write_enabled, page_id; token with ads_management). Don't enable it unless I ask.",
        `2. \`list_creative_files\`${args.files ? ` — use only: ${args.files}` : " — use the files that are not in an ad yet"}.`,
        '3. Context for the copy: `get_report` (type "content_plan") to match each file to its planned angle/hook, `get_top_creatives` (period "last_30d") for wording that works, and `get_business_profile` for brand voice, language, offer and landing page.',
        "4. `get_meta_structure` — pick the best existing ad set for each creative and explain why (performance via `get_breakdown` level adset if useful).",
        "5. For each file, show me a draft: ad set, ad name, primary text, headline, description, CTA, link — and ask whether it should start **ACTIVE** or **PAUSED**. Let me edit.",
        "6. When I approve a draft, call `propose_new_ad` and show me the returned preview (including warnings). Only after I say yes to that preview, call `execute_ad_action` with its action_id. One ad at a time.",
        "7. If a video is still processing, tell me and call `execute_ad_action` again for that action a few minutes later.",
        "8. Finish with a table: file · ad name · ad set · status · ad id (from the results), and remind me Meta reviews ads before they deliver.",
        "",
        "Write ad copy in the business language and brand voice. Keep claims honest and within Meta's ad policies (no exaggerated health/before-after promises).",
      ],
      ctx,
    ),
};
