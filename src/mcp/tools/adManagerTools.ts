import { z } from "zod";
import { CTA_TYPES } from "../../services/adManagerService.js";
import type { AnyToolDef } from "../tooling.js";
import { defineTool } from "../tooling.js";

const CONFIRM_RULE =
  "Changes NOTHING in Meta: it returns a preview and an action_id. Show the preview to the user and call execute_ad_action only after they explicitly confirm.";
const metaId = z.string().regex(/^\d+$/, "numeric Meta id (see get_meta_structure)");

export const getMetaStructure = defineTool({
  name: "get_meta_structure",
  title: "Live campaigns, ad sets and ads",
  description:
    "Lists this project's live Meta campaigns, ad sets (with daily budgets) and optionally ads, with their real Meta ids and statuses. Read-only. Use it to pick the ad set for a new ad or the id of what to pause/scale.",
  inputSchema: { include_ads: z.boolean().optional().describe("Also list ads (default false).") },
  openWorld: true,
  handler: (a, ctx) => ctx.services.adManager.structure(a.include_ads ?? false),
});

export const listCreativeFiles = defineTool({
  name: "list_creative_files",
  title: "Creative files",
  description:
    "Images and videos the user put in this project's creatives/ folder (projects/<client>/creatives/), with size and which ads already use them.",
  inputSchema: {},
  handler: (_a, ctx) => ctx.services.adManager.listCreativeFiles(),
});

export const proposeNewAd = defineTool({
  name: "propose_new_ad",
  title: "Propose a new ad (from a creative file)",
  description: `Prepares a new ad from an image/video in the project's creatives/ folder, inside an existing ad set. ${CONFIRM_RULE} Ask the user whether the ad should start ACTIVE or PAUSED — never assume.`,
  inputSchema: {
    file: z.string().min(1).describe("Path inside creatives/, as returned by list_creative_files."),
    adset_id: metaId,
    ad_name: z.string().min(1).max(200),
    primary_text: z.string().min(1).max(2000),
    headline: z.string().max(255).optional(),
    description: z.string().max(255).optional(),
    cta: z.enum(CTA_TYPES),
    link_url: z.string().url(),
    status: z.enum(["ACTIVE", "PAUSED"]).describe("Initial status, as chosen by the user."),
  },
  readOnly: false,
  openWorld: true,
  handler: (a, ctx) => ctx.services.adManager.proposeNewAd(a),
});

export const proposeStatusChange = defineTool({
  name: "propose_status_change",
  title: "Propose pause / activate",
  description: `Prepares pausing or activating a campaign, ad set or ad. ${CONFIRM_RULE}`,
  inputSchema: {
    level: z.enum(["campaign", "adset", "ad"]),
    object_id: metaId,
    new_status: z.enum(["ACTIVE", "PAUSED"]),
    reason: z
      .string()
      .max(500)
      .optional()
      .describe("Why (e.g. the data behind the recommendation)."),
  },
  readOnly: false,
  openWorld: true,
  handler: (a, ctx) => ctx.services.adManager.proposeStatusChange(a),
});

export const proposeBudgetChange = defineTool({
  name: "propose_budget_change",
  title: "Propose a daily budget change",
  description: `Prepares a new daily budget (account currency, normal units — e.g. 1500 for ৳1,500) for an ad set or a campaign-budget campaign. Respects the project's META_MAX_DAILY_BUDGET cap. ${CONFIRM_RULE}`,
  inputSchema: {
    level: z.enum(["campaign", "adset"]),
    object_id: metaId,
    new_daily_budget: z.number().positive(),
    reason: z.string().max(500).optional(),
  },
  readOnly: false,
  openWorld: true,
  handler: (a, ctx) => ctx.services.adManager.proposeBudgetChange(a),
});

export const proposeDuplicate = defineTool({
  name: "propose_duplicate",
  title: "Propose duplicating an ad or ad set",
  description: `Prepares a copy of an ad or ad set (e.g. to scale a winner or test it in a new ad set). Ask the user for the copy's initial status. ${CONFIRM_RULE}`,
  inputSchema: {
    level: z.enum(["ad", "adset"]),
    object_id: metaId,
    status: z.enum(["ACTIVE", "PAUSED"]),
    new_name: z.string().min(1).max(200).optional(),
    include_ads: z.boolean().optional().describe("Ad sets only: copy the ads too (default true)."),
  },
  readOnly: false,
  openWorld: true,
  handler: (a, ctx) => ctx.services.adManager.proposeDuplicate(a),
});

export const executeAdAction = defineTool({
  name: "execute_ad_action",
  title: "Execute a confirmed Ads Manager change",
  description:
    "Runs a proposed change in Meta Ads Manager. ONLY call this after the user has explicitly said yes to that exact preview in this conversation — never on your own initiative, never for several actions at once without a yes for each. Where the client supports it, the server also asks the user directly to approve. Also resumes a new video ad whose video was still processing.",
  inputSchema: { action_id: z.string().min(4).max(16) },
  readOnly: false,
  destructive: true,
  openWorld: true,
  handler: (a, ctx) => ctx.services.adManager.execute(a.action_id),
});

export const cancelAdAction = defineTool({
  name: "cancel_ad_action",
  title: "Cancel a proposed change",
  description: "Cancels a pending proposal. Nothing is changed in Meta.",
  inputSchema: { action_id: z.string().min(4).max(16) },
  readOnly: false,
  handler: (a, ctx) => ctx.services.adManager.cancel(a.action_id),
});

export const listAdActions = defineTool({
  name: "list_ad_actions",
  title: "Ads Manager change log",
  description:
    "Audit log of proposed and executed Ads Manager changes for this project (who confirmed how, ids created, errors).",
  inputSchema: {
    status: z
      .enum(["pending", "executing", "processing", "executed", "failed", "cancelled", "expired"])
      .optional(),
    limit: z.number().int().min(1).max(200).optional(),
  },
  handler: (a, ctx) => ctx.services.adManager.list(a.status, a.limit ?? 20),
});

export const adManagerTools: AnyToolDef[] = [
  getMetaStructure,
  listCreativeFiles,
  proposeNewAd,
  proposeStatusChange,
  proposeBudgetChange,
  proposeDuplicate,
  executeAdAction,
  cancelAdAction,
  listAdActions,
];
