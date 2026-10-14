import { z } from "zod";
import { CTA_TYPES } from "../../services/adManagerService.js";
import {
  CAMPAIGN_OBJECTIVES,
  PLATFORMS,
  SPECIAL_AD_CATEGORIES,
} from "../../sources/metaApi/campaigns.js";
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

const adSetSpec = z
  .object({
    name: z.string().min(1).max(200),
    locations: z
      .array(
        z.object({
          type: z.enum(["country", "region", "city"]),
          key: z
            .string()
            .min(1)
            .describe('Country code (e.g. "BD") or the key from search_targeting.'),
          name: z.string().optional(),
          radius_km: z.number().min(17).max(80).optional().describe("Cities only."),
        }),
      )
      .min(1)
      .max(50),
    age_min: z.number().int().min(13).max(65).optional().describe("Default 18."),
    age_max: z.number().int().min(13).max(65).optional().describe("Default 65 (= 65+)."),
    genders: z.enum(["all", "male", "female"]).optional(),
    interests: z
      .array(z.object({ id: z.string().regex(/^\d+$/), name: z.string() }))
      .max(50)
      .optional()
      .describe("From search_targeting (kind interest)."),
    advantage_audience: z
      .boolean()
      .optional()
      .describe("Let Meta go beyond this audience (default false)."),
    platforms: z
      .array(z.enum(PLATFORMS))
      .optional()
      .describe("Omit for Advantage+ placements (recommended)."),
    optimization_goal: z
      .enum(["LANDING_PAGE_VIEWS", "LINK_CLICKS"])
      .optional()
      .describe("Traffic campaigns only."),
    start_time: z
      .string()
      .optional()
      .describe("ISO 8601, e.g. 2026-11-01T09:00:00+0600. Default: now."),
    end_time: z.string().optional(),
  })
  .describe("Ad set: audience, placements and schedule.");

export const searchTargetingTool = defineTool({
  name: "search_targeting",
  title: "Search targeting options",
  description:
    'Finds location keys (countries, regions, cities) or interest ids to use in new ad sets, e.g. Dhaka, Chattogram, "skincare". Read-only.',
  inputSchema: {
    kind: z.enum(["location", "interest"]),
    query: z.string().min(2).max(100),
    country_code: z.string().length(2).optional().describe("Locations only: limit to a country."),
  },
  openWorld: true,
  handler: (a, ctx) => ctx.services.adManager.searchTargeting(a.kind, a.query, a.country_code),
});

export const proposeNewCampaign = defineTool({
  name: "propose_new_campaign",
  title: "Propose a new campaign + ad set",
  description: `Prepares a new campaign with its first ad set: objective (Sales and Leads need the project's pixel; Traffic; Awareness), daily budget on the campaign or the ad set, audience, placements and schedule. Ads are added afterwards with propose_new_ad. Ask the user for the budget, audience and ACTIVE/PAUSED — never assume. Message/WhatsApp campaigns are not supported here (duplicate an existing one instead). ${CONFIRM_RULE}`,
  inputSchema: {
    name: z.string().min(1).max(200),
    objective: z.enum(CAMPAIGN_OBJECTIVES),
    budget_level: z
      .enum(["campaign", "adset"])
      .describe("campaign = Advantage campaign budget; adset = budget on the ad set."),
    daily_budget: z
      .number()
      .positive()
      .describe("Account currency, normal units (e.g. 1500 for ৳1,500)."),
    status: z.enum(["ACTIVE", "PAUSED"]),
    special_ad_categories: z
      .array(z.enum(SPECIAL_AD_CATEGORIES))
      .optional()
      .describe("Only for housing, jobs, credit/finance or political ads."),
    adset: adSetSpec,
  },
  readOnly: false,
  openWorld: true,
  handler: (a, ctx) => ctx.services.adManager.proposeNewCampaign(a),
});

export const proposeNewAdSet = defineTool({
  name: "propose_new_adset",
  title: "Propose a new ad set",
  description: `Prepares a new ad set in an existing campaign of this project (Sales, Leads, Traffic or Awareness objective). Give daily_budget only if the campaign has no campaign budget. ${CONFIRM_RULE}`,
  inputSchema: {
    campaign_id: metaId,
    daily_budget: z.number().positive().optional(),
    status: z.enum(["ACTIVE", "PAUSED"]),
    adset: adSetSpec,
  },
  readOnly: false,
  openWorld: true,
  handler: (a, ctx) => ctx.services.adManager.proposeNewAdSet(a),
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
  searchTargetingTool,
  proposeNewCampaign,
  proposeNewAdSet,
  proposeNewAd,
  proposeStatusChange,
  proposeBudgetChange,
  proposeDuplicate,
  executeAdAction,
  cancelAdAction,
  listAdActions,
];
