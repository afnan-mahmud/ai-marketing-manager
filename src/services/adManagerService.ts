import { randomBytes } from "node:crypto";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import type { AppContext, ConfirmDecision } from "../context.js";
import type { ActionType, AdAction } from "../db/repositories/actionsRepo.js";
import {
  adSetPayload,
  buildTargeting,
  campaignPayload,
  createAdSet,
  createCampaign,
  OBJECTIVE_CONFIG,
  searchTargeting,
  type AdSetSpec,
  type CampaignObjective,
} from "../sources/metaApi/campaigns.js";
import type { MetaApiClient } from "../sources/metaApi/client.js";
import {
  copyObject,
  createAd,
  createCreative,
  currencyOffset,
  getAdAccount,
  getObject,
  listStructure,
  mediaType,
  updateObject,
  uploadImage,
  uploadVideo,
  videoStatus,
  videoThumbnail,
  type MetaLevel,
  type MetaObject,
} from "../sources/metaApi/manage.js";
import { AppError, MetaApiError, NotFoundError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

/** A proposal must be confirmed within this time, or it expires and has to be proposed again. */
export const ACTION_TTL_MINUTES = 30;
/** Budget changes bigger than this (relative) may restart Meta's learning phase — shown as a warning. */
export const BIG_BUDGET_CHANGE = 0.2;
export const MAX_IMAGE_MB = 30;
export const MAX_VIDEO_MB = 500;
const VIDEO_POLL_MS = 10_000;
const VIDEO_WAIT_MS = 4 * 60_000;

export const CTA_TYPES = [
  "SHOP_NOW",
  "LEARN_MORE",
  "ORDER_NOW",
  "BUY_NOW",
  "SIGN_UP",
  "CONTACT_US",
  "GET_OFFER",
  "SUBSCRIBE",
  "BOOK_NOW",
  "DOWNLOAD",
] as const;

export interface NewAdInput {
  file: string;
  adset_id: string;
  ad_name: string;
  primary_text: string;
  headline?: string;
  description?: string;
  cta: (typeof CTA_TYPES)[number];
  link_url: string;
  status: "ACTIVE" | "PAUSED";
}

export interface NewCampaignInput {
  name: string;
  objective: CampaignObjective;
  /** "campaign" = Advantage campaign budget (CBO); "adset" = budget on the ad set (ABO). */
  budget_level: "campaign" | "adset";
  daily_budget: number;
  status: "ACTIVE" | "PAUSED";
  special_ad_categories?: string[];
  adset: AdSetSpec;
}

export interface NewAdSetInput {
  campaign_id: string;
  /** Required unless the campaign has its own (CBO) budget. */
  daily_budget?: number;
  status: "ACTIVE" | "PAUSED";
  adset: AdSetSpec;
}

/** Human-readable targeting for previews. */
function describeTargeting(spec: AdSetSpec) {
  return {
    locations: spec.locations.map(
      (l) => `${l.name ?? l.key} (${l.type}${l.radius_km ? `, +${l.radius_km} km` : ""})`,
    ),
    age: `${spec.age_min ?? 18}–${spec.age_max ?? 65}${(spec.age_max ?? 65) === 65 ? "+" : ""}`,
    gender: spec.genders ?? "all",
    interests: spec.interests?.map((i) => i.name) ?? [],
    advantage_audience: spec.advantage_audience
      ? "ON — Meta may show ads beyond these settings when it expects better results"
      : "off — only the audience above",
    placements: spec.platforms?.length
      ? spec.platforms.join(", ")
      : "Advantage+ placements (all, Meta's recommendation)",
    schedule:
      spec.start_time || spec.end_time
        ? `${spec.start_time ?? "now"} → ${spec.end_time ?? "ongoing"}`
        : "starts now, ongoing",
  };
}

const newId = () => randomBytes(4).toString("hex").toUpperCase();
const money = (v: number, currency: string) =>
  `${currency} ${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

/**
 * Changes in Meta Ads Manager, always in two steps: propose_* validates and stores a preview (nothing changes in
 * Meta), and execute() runs it only after the human confirms. Disabled unless the project sets META_WRITE_ENABLED.
 */
export class AdManagerService {
  constructor(private readonly ctx: AppContext) {}

  // ---------- guards ----------

  private accountId(): string {
    const id = this.ctx.env.META_AD_ACCOUNT_ID;
    if (!id) {
      throw new AppError(
        `Project "${this.ctx.project.name}" has no Meta ad account.`,
        "Set it with configure_project_meta (ad_account_id).",
      );
    }
    return id;
  }

  private client(): MetaApiClient {
    return this.ctx.services.ads.metaClient();
  }

  private requireWrite(): void {
    if (!this.ctx.env.META_WRITE_ENABLED) {
      throw new AppError(
        `Managing ads is turned off for project "${this.ctx.project.name}".`,
        "If the user wants Claude to prepare Ads Manager changes for this client, they can enable it with configure_project_meta (write_enabled: true) or META_WRITE_ENABLED=true in the project's project.env. The token needs ads_management.",
      );
    }
  }

  /** Every target must belong to THIS project's ad account — never touch another client's objects. */
  private assertOwned(obj: MetaObject, label: string): void {
    const account = this.accountId();
    if (!obj.account_id || obj.account_id.replace(/^act_/, "") !== account) {
      throw new AppError(
        `${label} ${obj.id} does not belong to this project's ad account (act_${account}).`,
        "Use get_meta_structure for this project to pick the right id.",
      );
    }
  }

  private async fetchOwned(level: MetaLevel, id: string): Promise<MetaObject> {
    try {
      const obj = await getObject(this.client(), level, id);
      this.assertOwned(obj, level);
      return obj;
    } catch (err) {
      if (err instanceof MetaApiError && err.code === 100) {
        throw new NotFoundError(
          `No ${level} with id ${id} is visible to this token.`,
          "Use get_meta_structure to list ids.",
        );
      }
      throw err;
    }
  }

  private async currency(): Promise<{ currency: string; offset: number }> {
    const acc = await getAdAccount(this.client(), this.accountId());
    return { currency: acc.currency, offset: currencyOffset(acc.currency) };
  }

  // ---------- read helpers ----------

  /** Live campaigns / ad sets / ads with real Meta ids (needed to target changes). Read-only. */
  async structure(includeAds: boolean) {
    const accountId = this.accountId();
    const client = this.client();
    const [{ currency, offset }, s] = await Promise.all([
      this.currency(),
      listStructure(client, accountId, includeAds),
    ]);
    const budget = (o: MetaObject) => ({
      daily_budget: o.daily_budget ? Number(o.daily_budget) / offset : null,
      lifetime_budget: o.lifetime_budget ? Number(o.lifetime_budget) / offset : null,
    });
    const adsets = s.adsets.map((a) => ({
      id: a.id,
      name: a.name,
      campaign_id: a.campaign_id,
      status: a.status,
      effective_status: a.effective_status,
      optimization_goal: a.optimization_goal,
      ...budget(a),
    }));
    return {
      summary: `act_${accountId}: ${s.campaigns.length} campaign(s), ${s.adsets.length} ad set(s)${includeAds ? `, ${s.ads.length} ad(s)` : ""} (deleted/archived hidden).`,
      ad_account: `act_${accountId}`,
      currency,
      write_enabled: this.ctx.env.META_WRITE_ENABLED,
      campaigns: s.campaigns.map((c) => ({
        id: c.id,
        name: c.name,
        objective: c.objective,
        status: c.status,
        effective_status: c.effective_status,
        ...budget(c),
        adsets: adsets
          .filter((a) => a.campaign_id === c.id)
          .map(({ campaign_id: _c, ...rest }) => rest),
      })),
      ...(includeAds
        ? {
            ads: s.ads.map((a) => ({
              id: a.id,
              name: a.name,
              adset_id: a.adset_id,
              status: a.status,
              effective_status: a.effective_status,
            })),
          }
        : {}),
    };
  }

  private resolveCreative(file: string): string {
    const root = resolve(this.ctx.paths.creatives);
    const full = resolve(root, file);
    if (full !== root && !full.startsWith(root + sep))
      throw new AppError("The file must be inside this project's creatives/ folder.");
    if (!existsSync(full) || !statSync(full).isFile()) {
      throw new NotFoundError(
        `No file "${file}" in projects/${this.ctx.project.slug}/creatives/.`,
        "Use list_creative_files to see what's there.",
      );
    }
    return full;
  }

  /** Images/videos the user dropped in projects/<client>/creatives/ (one level of sub-folders). */
  listCreativeFiles() {
    const root = this.ctx.paths.creatives;
    const files: { file: string; type: "image" | "video"; size_mb: number; modified: string }[] =
      [];
    const walk = (dir: string, depth: number) => {
      if (!existsSync(dir)) return;
      for (const name of readdirSync(dir)) {
        if (name.startsWith(".")) continue;
        const p = join(dir, name);
        const st = statSync(p);
        if (st.isDirectory() && depth < 1) walk(p, depth + 1);
        const type = st.isFile() ? mediaType(name) : null;
        if (type)
          files.push({
            file: relative(root, p).split(sep).join("/"),
            type,
            size_mb: Math.round((st.size / 1048576) * 10) / 10,
            modified: st.mtime.toISOString(),
          });
      }
    };
    walk(root, 0);
    const used = new Map<string, string[]>();
    for (const a of this.ctx.repos.actions.list({ limit: 500 })) {
      const f = a.params.file;
      if (a.type === "new_ad" && typeof f === "string" && a.status === "executed")
        used.set(f, [...(used.get(f) ?? []), String(a.result?.ad_id ?? a.id)]);
    }
    return {
      summary: files.length
        ? `${files.length} creative file(s) in projects/${this.ctx.project.slug}/creatives/.`
        : `No images/videos yet. Put them in projects/${this.ctx.project.slug}/creatives/ (jpg, png, mp4, mov).`,
      folder: root,
      files: files
        .sort((a, b) => b.modified.localeCompare(a.modified))
        .map((f) => ({ ...f, used_in_ads: used.get(f.file) ?? [] })),
    };
  }

  // ---------- proposals (nothing changes in Meta) ----------

  private store(
    type: ActionType,
    summary: string,
    params: Record<string, unknown>,
    preview: Record<string, unknown>,
  ) {
    const now = this.ctx.now();
    const action = this.ctx.repos.actions.insert({
      id: newId(),
      type,
      summary,
      params,
      preview,
      created_at: now.toISOString(),
      expires_at: new Date(now.getTime() + ACTION_TTL_MINUTES * 60_000).toISOString(),
    });
    return {
      summary: `Proposed (not executed): ${summary}`,
      action_id: action.id,
      expires_at: action.expires_at,
      preview,
      next_step:
        `Show this preview to the user and ask for an explicit yes. Only after they confirm, call execute_ad_action with action_id "${action.id}". ` +
        "If they want changes, propose again; if not, call cancel_ad_action.",
    };
  }

  async proposeNewAd(input: NewAdInput) {
    this.requireWrite();
    const path = this.resolveCreative(input.file);
    const type = mediaType(path);
    if (!type) throw new AppError("Only jpg/png images and mp4/mov videos can be used as ads.");
    const sizeMb = statSync(path).size / 1048576;
    const limit = type === "image" ? MAX_IMAGE_MB : MAX_VIDEO_MB;
    if (sizeMb > limit)
      throw new AppError(
        `${input.file} is ${Math.round(sizeMb)} MB; the limit for ${type}s here is ${limit} MB.`,
      );
    const pageId = this.ctx.env.META_PAGE_ID;
    if (!pageId)
      throw new AppError(
        "This project has no Facebook Page set for new ads.",
        "Set it with configure_project_meta (page_id).",
      );
    const adset = await this.fetchOwned("adset", input.adset_id);
    const { currency, offset } = await this.currency();
    const warnings: string[] = [];
    if (input.status === "ACTIVE")
      warnings.push("The ad will start delivering (and spending) as soon as Meta approves it.");
    if (adset.effective_status && adset.effective_status !== "ACTIVE") {
      warnings.push(
        `The ad set is ${adset.effective_status}, so the ad won't deliver until the ad set runs.`,
      );
    }
    if (/CONVERSATION|LEAD_GENERATION/.test(adset.optimization_goal ?? "")) {
      warnings.push(
        `This ad set optimises for ${adset.optimization_goal}; a website link ad may not fit it.`,
      );
    }
    const preview = {
      what: `Upload ${type} "${input.file}" and create a new ad`,
      ad_name: input.ad_name,
      initial_status: input.status,
      ad_set: {
        id: adset.id,
        name: adset.name,
        status: adset.effective_status,
        daily_budget: adset.daily_budget
          ? money(Number(adset.daily_budget) / offset, currency)
          : null,
      },
      campaign: adset.campaign
        ? { id: adset.campaign.id, name: adset.campaign.name, objective: adset.campaign.objective }
        : null,
      creative: {
        file: input.file,
        type,
        size_mb: Math.round(sizeMb * 10) / 10,
        primary_text: input.primary_text,
        headline: input.headline ?? null,
        description: input.description ?? null,
        call_to_action: input.cta,
        link: input.link_url,
        page_id: pageId,
        instagram_user_id: this.ctx.env.META_INSTAGRAM_USER_ID ?? null,
      },
      ad_account: `act_${this.accountId()}`,
      warnings,
    };
    return this.store(
      "new_ad",
      `New ${input.status} ad "${input.ad_name}" from ${input.file} in ad set "${adset.name}"`,
      { ...input },
      preview,
    );
  }

  /** Validates an ad set spec without calling Meta. */
  private validateAdSetSpec(spec: AdSetSpec): void {
    if (!spec.locations.length)
      throw new AppError("Choose at least one location (country, region or city).");
    const min = spec.age_min ?? 18;
    const max = spec.age_max ?? 65;
    if (min < 13 || max > 65 || min > max)
      throw new AppError("Ages must be between 13 and 65, with age_min ≤ age_max.");
    for (const l of spec.locations) {
      if (l.type === "country" && !/^[A-Za-z]{2}$/.test(l.key))
        throw new AppError(`"${l.key}" is not a 2-letter country code.`);
      if (l.type !== "country" && !/^\d+$/.test(l.key)) {
        throw new AppError(
          `Location "${l.name ?? l.key}" needs its numeric key.`,
          "Look it up with search_targeting (kind location).",
        );
      }
      if (
        l.radius_km !== undefined &&
        (l.type !== "city" || l.radius_km < 17 || l.radius_km > 80)
      ) {
        throw new AppError("radius_km is only for cities and must be 17–80 km.");
      }
    }
    for (const t of [spec.start_time, spec.end_time]) {
      if (t && Number.isNaN(Date.parse(t)))
        throw new AppError(
          `"${t}" is not a valid date/time (use ISO 8601, e.g. 2026-11-01T09:00:00+0600).`,
        );
    }
    if (
      spec.start_time &&
      spec.end_time &&
      Date.parse(spec.end_time) <= Date.parse(spec.start_time)
    ) {
      throw new AppError("end_time must be after start_time.");
    }
    if (spec.end_time && Date.parse(spec.end_time) <= this.ctx.now().getTime())
      throw new AppError("end_time is in the past.");
  }

  private checkCap(amount: number, currency: string): void {
    const cap = this.ctx.env.META_MAX_DAILY_BUDGET;
    if (cap !== undefined && amount > cap) {
      throw new AppError(
        `${money(amount, currency)} per day is above this project's safety cap of ${money(cap, currency)}.`,
        "Raise META_MAX_DAILY_BUDGET (configure_project_meta max_daily_budget) if the user really wants this.",
      );
    }
  }

  private pixelFor(objective: CampaignObjective): string | undefined {
    const cfg = OBJECTIVE_CONFIG[objective];
    if (!cfg.event) return undefined;
    const pixel = this.ctx.env.META_PIXEL_ID;
    if (!pixel) {
      throw new AppError(
        `${cfg.label} campaigns need this client's Meta Pixel.`,
        "Set it with configure_project_meta (pixel_id), or choose the Traffic objective.",
      );
    }
    return pixel;
  }

  private commonWarnings(status: string, spec: AdSetSpec): string[] {
    const w = [
      "The new ad set has no ads yet — nothing delivers or spends until an ad is added (propose_new_ad with the new ad set id).",
    ];
    if (status === "ACTIVE")
      w.push("Status ACTIVE: as soon as an ad is added and approved, it starts spending.");
    if (spec.advantage_audience)
      w.push("Advantage+ audience is ON: Meta may reach people outside the age/interest settings.");
    if ((spec.interests?.length ?? 0) > 0 && spec.advantage_audience)
      w.push("With Advantage+ audience, interests act as suggestions only.");
    return w;
  }

  /** Read-only lookup of location keys and interest ids for targeting. */
  async searchTargeting(kind: "location" | "interest", query: string, countryCode?: string) {
    const results = await searchTargeting(this.client(), kind, query, countryCode);
    return {
      summary: `${results.length} ${kind} match(es) for "${query}".`,
      results: results.map((r) =>
        kind === "interest"
          ? {
              id: r.id,
              name: r.name,
              audience_size: r.audience_size_lower_bound
                ? `${r.audience_size_lower_bound}–${r.audience_size_upper_bound}`
                : null,
              path: r.path,
            }
          : {
              type: r.type,
              key: r.key,
              name: r.name,
              region: r.region ?? null,
              country_code: r.country_code ?? null,
            },
      ),
      how_to_use:
        kind === "interest"
          ? "Pass {id, name} in adset.interests."
          : 'Pass {type, key, name} in adset.locations (countries: {type:"country", key:"BD"}).',
    };
  }

  async proposeNewCampaign(input: NewCampaignInput) {
    this.requireWrite();
    this.validateAdSetSpec(input.adset);
    const pixel = this.pixelFor(input.objective);
    const { currency, offset } = await this.currency();
    this.checkCap(input.daily_budget, currency);
    const minor = Math.round(input.daily_budget * offset);
    const cats = input.special_ad_categories ?? [];
    const warnings = this.commonWarnings(input.status, input.adset);
    if (cats.length)
      warnings.push(
        `Special ad category ${cats.join(", ")}: Meta restricts age, gender and detailed targeting.`,
      );
    const cfg = OBJECTIVE_CONFIG[input.objective];
    const preview = {
      what: `Create campaign "${input.name}" with ad set "${input.adset.name}"`,
      ad_account: `act_${this.accountId()}`,
      initial_status: input.status,
      campaign: {
        name: input.name,
        objective: cfg.label,
        budget: `${money(input.daily_budget, currency)} per day on the ${input.budget_level === "campaign" ? "campaign (Advantage campaign budget)" : "ad set"}`,
        monthly_estimate: `up to ${money(input.daily_budget * 30, currency)} per 30 days`,
        special_ad_categories: cats.length ? cats : "none",
      },
      ad_set: {
        name: input.adset.name,
        optimization:
          input.objective === "OUTCOME_TRAFFIC" && input.adset.optimization_goal
            ? input.adset.optimization_goal
            : cfg.optimization_goal,
        ...(pixel ? { pixel_id: pixel, conversion_event: cfg.event } : {}),
        targeting: describeTargeting(input.adset),
      },
      warnings,
    };
    return this.store(
      "new_campaign",
      `New ${input.status} campaign "${input.name}" (${cfg.label}, ${money(input.daily_budget, currency)}/day) with ad set "${input.adset.name}"`,
      { ...input, special_ad_categories: cats, daily_budget_minor: minor, pixel_id: pixel ?? null },
      preview,
    );
  }

  async proposeNewAdSet(input: NewAdSetInput) {
    this.requireWrite();
    this.validateAdSetSpec(input.adset);
    const campaign = await this.fetchOwned("campaign", input.campaign_id);
    const objective = campaign.objective as CampaignObjective | undefined;
    if (!objective || !(objective in OBJECTIVE_CONFIG)) {
      throw new AppError(
        `New ad sets can't be created here for campaign objective ${campaign.objective ?? "unknown"}.`,
        "Supported: Sales, Leads, Traffic, Awareness. For other objectives (e.g. messages), duplicate an existing ad set with propose_duplicate.",
      );
    }
    if (campaign.lifetime_budget)
      throw new AppError("This campaign uses a lifetime budget; add ad sets to it in Ads Manager.");
    const cbo = Boolean(campaign.daily_budget);
    if (cbo && input.daily_budget !== undefined) {
      throw new AppError(
        "This campaign uses a campaign budget (Advantage campaign budget), so the ad set can't have its own budget. Leave daily_budget out.",
      );
    }
    if (!cbo && input.daily_budget === undefined)
      throw new AppError(
        "This campaign has no campaign budget, so the ad set needs a daily_budget.",
      );
    const pixel = this.pixelFor(objective);
    const { currency, offset } = await this.currency();
    if (input.daily_budget !== undefined) this.checkCap(input.daily_budget, currency);
    const cfg = OBJECTIVE_CONFIG[objective];
    const preview = {
      what: `Create ad set "${input.adset.name}" in campaign "${campaign.name}"`,
      ad_account: `act_${this.accountId()}`,
      initial_status: input.status,
      campaign: {
        id: campaign.id,
        name: campaign.name,
        objective: cfg.label,
        status: campaign.effective_status,
      },
      ad_set: {
        name: input.adset.name,
        budget:
          input.daily_budget !== undefined
            ? `${money(input.daily_budget, currency)} per day (up to ${money(input.daily_budget * 30, currency)} per 30 days)`
            : `shares the campaign budget (${money(Number(campaign.daily_budget) / offset, currency)} per day)`,
        optimization:
          objective === "OUTCOME_TRAFFIC" && input.adset.optimization_goal
            ? input.adset.optimization_goal
            : cfg.optimization_goal,
        ...(pixel ? { pixel_id: pixel, conversion_event: cfg.event } : {}),
        targeting: describeTargeting(input.adset),
      },
      warnings: this.commonWarnings(input.status, input.adset),
    };
    return this.store(
      "new_adset",
      `New ${input.status} ad set "${input.adset.name}" in campaign "${campaign.name}"`,
      {
        ...input,
        objective,
        daily_budget_minor:
          input.daily_budget !== undefined ? Math.round(input.daily_budget * offset) : null,
        pixel_id: pixel ?? null,
      },
      preview,
    );
  }

  async proposeStatusChange(input: {
    level: MetaLevel;
    object_id: string;
    new_status: "ACTIVE" | "PAUSED";
    reason?: string;
  }) {
    this.requireWrite();
    const obj = await this.fetchOwned(input.level, input.object_id);
    if (obj.status === input.new_status)
      throw new AppError(`${input.level} "${obj.name}" is already ${input.new_status}.`);
    const verb = input.new_status === "PAUSED" ? "Pause" : "Activate";
    const preview = {
      what: `${verb} ${input.level} "${obj.name}"`,
      object: { level: input.level, id: obj.id, name: obj.name },
      status: { from: obj.status, to: input.new_status },
      effective_status_now: obj.effective_status,
      reason: input.reason ?? null,
      warnings:
        input.new_status === "ACTIVE"
          ? ["Activating starts delivery and spending (if its parent campaign/ad set is active)."]
          : input.level !== "ad"
            ? [`Pausing a ${input.level} stops every ad inside it.`]
            : [],
    };
    return this.store(
      "status_change",
      `${verb} ${input.level} "${obj.name}"`,
      { ...input, previous_status: obj.status },
      preview,
    );
  }

  async proposeBudgetChange(input: {
    level: "campaign" | "adset";
    object_id: string;
    new_daily_budget: number;
    reason?: string;
  }) {
    this.requireWrite();
    const obj = await this.fetchOwned(input.level, input.object_id);
    if (!obj.daily_budget) {
      throw new AppError(
        `${input.level} "${obj.name}" has no daily budget${obj.lifetime_budget ? " (it uses a lifetime budget)" : input.level === "adset" ? " (its campaign probably uses campaign budget — change the campaign instead)" : " (budgets are set on its ad sets)"}.`,
      );
    }
    const { currency, offset } = await this.currency();
    const current = Number(obj.daily_budget) / offset;
    const cap = this.ctx.env.META_MAX_DAILY_BUDGET;
    if (cap !== undefined && input.new_daily_budget > cap) {
      throw new AppError(
        `${money(input.new_daily_budget, currency)} is above this project's safety cap of ${money(cap, currency)} per day.`,
        "Raise META_MAX_DAILY_BUDGET in the project's project.env (or via configure_project_meta) if the user really wants this.",
      );
    }
    const minor = Math.round(input.new_daily_budget * offset);
    const change = (input.new_daily_budget - current) / current;
    const warnings: string[] = [];
    if (Math.abs(change) > BIG_BUDGET_CHANGE) {
      warnings.push(
        `This is a ${Math.round(change * 100)}% change; changes over ±20% can restart Meta's learning phase. Consider smaller steps.`,
      );
    }
    const preview = {
      what: `Change daily budget of ${input.level} "${obj.name}"`,
      object: { level: input.level, id: obj.id, name: obj.name, status: obj.effective_status },
      daily_budget: {
        from: money(current, currency),
        to: money(input.new_daily_budget, currency),
        change_pct: Math.round(change * 1000) / 10,
      },
      monthly_effect: `${money((input.new_daily_budget - current) * 30, currency)} per 30 days`,
      reason: input.reason ?? null,
      warnings,
    };
    return this.store(
      "budget_change",
      `Daily budget of ${input.level} "${obj.name}": ${money(current, currency)} → ${money(input.new_daily_budget, currency)}`,
      { ...input, previous_minor: obj.daily_budget, new_minor: minor },
      preview,
    );
  }

  async proposeDuplicate(input: {
    level: "ad" | "adset";
    object_id: string;
    status: "ACTIVE" | "PAUSED";
    new_name?: string;
    include_ads?: boolean;
  }) {
    this.requireWrite();
    const obj = await this.fetchOwned(input.level, input.object_id);
    const preview = {
      what: `Duplicate ${input.level} "${obj.name}"`,
      source: { level: input.level, id: obj.id, name: obj.name },
      copy: {
        name: input.new_name ?? `${obj.name} - Copy`,
        initial_status: input.status,
        ...(input.level === "adset" ? { includes_ads: input.include_ads ?? true } : {}),
      },
      warnings:
        input.status === "ACTIVE"
          ? ["The copy starts delivering and spending right away (once approved)."]
          : [],
    };
    return this.store(
      "duplicate",
      `Duplicate ${input.level} "${obj.name}" as ${input.status}`,
      { ...input },
      preview,
    );
  }

  // ---------- execution (after the user confirms) ----------

  async execute(actionId: string) {
    const repo = this.ctx.repos.actions;
    repo.expire(this.ctx.now().toISOString());
    const action = repo.get(actionId);
    if (!action)
      throw new NotFoundError(
        `No action ${actionId} in project "${this.ctx.project.name}".`,
        "Use list_ad_actions.",
      );
    if (action.status === "processing") {
      this.requireWrite(); // confirmed earlier, but honour a later switch-off
      return this.run(action, action.confirmed_via ?? "resumed");
    }
    if (action.status === "expired")
      throw new AppError(
        `Action ${action.id} expired (not confirmed within ${ACTION_TTL_MINUTES} minutes).`,
        "Propose it again.",
      );
    if (action.status !== "pending")
      throw new AppError(`Action ${action.id} is already ${action.status}.`);
    this.requireWrite();

    const decision: ConfirmDecision = await this.ctx.confirm({
      title: `Confirm Meta Ads change — ${this.ctx.project.name}`,
      message: confirmationText(this.ctx.project.name, action),
    });
    if (decision === "declined") {
      repo.update(action.id, {
        status: "cancelled",
        decided_at: this.ctx.now().toISOString(),
        confirmed_via: "elicitation",
      });
      return {
        summary: `Not executed: the user declined "${action.summary}".`,
        action_id: action.id,
        status: "cancelled",
      };
    }
    const via = decision === "accepted" ? "elicitation" : "tool_permission";
    repo.update(action.id, {
      status: "executing",
      decided_at: this.ctx.now().toISOString(),
      confirmed_via: via,
    });
    return this.run(repo.get(action.id)!, via);
  }

  private async run(action: AdAction, via: string) {
    const repo = this.ctx.repos.actions;
    const result: Record<string, unknown> = { ...(action.result ?? {}) };
    const save = () => repo.update(action.id, { result });
    try {
      const client = this.client();
      const accountId = this.accountId();
      const p = action.params;
      switch (action.type) {
        case "new_ad": {
          const input = p as unknown as NewAdInput;
          const path = this.resolveCreative(input.file);
          const type = mediaType(path)!;
          if (type === "image" && !result.image_hash) {
            result.image_hash = (await uploadImage(client, accountId, path)).hash;
            save();
          }
          if (type === "video") {
            if (!result.video_id) {
              result.video_id = await uploadVideo(client, accountId, path, input.ad_name);
              save();
            }
            const ready = await this.waitForVideo(client, String(result.video_id));
            if (!ready) {
              repo.update(action.id, { status: "processing", result });
              return {
                summary: `Video uploaded (id ${result.video_id}) and still processing at Meta. Call execute_ad_action again for ${action.id} in a few minutes to finish creating the ad (no new confirmation needed).`,
                action_id: action.id,
                status: "processing",
                result,
              };
            }
            result.thumbnail_url ??= await videoThumbnail(client, String(result.video_id));
          }
          if (!result.creative_id) {
            result.creative_id = await createCreative(client, accountId, {
              name: `${input.ad_name} — creative`,
              page_id: this.ctx.env.META_PAGE_ID!,
              instagram_user_id: this.ctx.env.META_INSTAGRAM_USER_ID,
              link_url: input.link_url,
              primary_text: input.primary_text,
              headline: input.headline,
              description: input.description,
              cta: input.cta,
              image_hash: result.image_hash as string | undefined,
              video_id: result.video_id as string | undefined,
              thumbnail_url: (result.thumbnail_url as string | null) ?? undefined,
            });
            save();
          }
          result.ad_id = await createAd(client, accountId, {
            name: input.ad_name,
            adset_id: input.adset_id,
            creative_id: String(result.creative_id),
            status: input.status,
          });
          break;
        }
        case "new_campaign": {
          const input = p as unknown as NewCampaignInput & {
            daily_budget_minor: number;
            pixel_id: string | null;
          };
          const cbo = input.budget_level === "campaign";
          if (!result.campaign_id) {
            result.campaign_id = await createCampaign(
              client,
              accountId,
              campaignPayload({
                name: input.name,
                objective: input.objective,
                status: input.status,
                special_ad_categories: input.special_ad_categories ?? [],
                daily_budget_minor: cbo ? input.daily_budget_minor : undefined,
              }),
            );
            save();
          }
          result.adset_id = await createAdSet(
            client,
            accountId,
            adSetPayload({
              spec: input.adset,
              campaign_id: String(result.campaign_id),
              objective: input.objective,
              status: input.status,
              daily_budget_minor: cbo ? undefined : input.daily_budget_minor,
              pixel_id: input.pixel_id ?? undefined,
            }),
          );
          result.targeting = buildTargeting(input.adset);
          break;
        }
        case "new_adset": {
          const input = p as unknown as NewAdSetInput & {
            objective: CampaignObjective;
            daily_budget_minor: number | null;
            pixel_id: string | null;
          };
          await this.fetchOwned("campaign", input.campaign_id);
          result.adset_id = await createAdSet(
            client,
            accountId,
            adSetPayload({
              spec: input.adset,
              campaign_id: input.campaign_id,
              objective: input.objective,
              status: input.status,
              daily_budget_minor: input.daily_budget_minor ?? undefined,
              pixel_id: input.pixel_id ?? undefined,
            }),
          );
          result.campaign_id = input.campaign_id;
          break;
        }
        case "status_change": {
          const level = p.level as MetaLevel;
          await this.fetchOwned(level, String(p.object_id));
          await updateObject(client, String(p.object_id), { status: String(p.new_status) });
          result.object_id = p.object_id;
          result.status = p.new_status;
          break;
        }
        case "budget_change": {
          const obj = await this.fetchOwned(p.level as MetaLevel, String(p.object_id));
          if (obj.daily_budget !== p.previous_minor) {
            throw new AppError(
              "The budget changed in Ads Manager since this was proposed. Propose the change again with the current budget.",
            );
          }
          await updateObject(client, String(p.object_id), { daily_budget: Number(p.new_minor) });
          result.object_id = p.object_id;
          result.daily_budget_minor_units = p.new_minor;
          break;
        }
        case "duplicate": {
          const level = p.level as "ad" | "adset";
          await this.fetchOwned(level, String(p.object_id));
          if (!result.new_id) {
            result.new_id = await copyObject(client, level, String(p.object_id), {
              status: p.status as "ACTIVE" | "PAUSED",
              deepCopy: (p.include_ads as boolean | undefined) ?? true,
            });
            save();
          }
          if (p.new_name)
            await updateObject(client, String(result.new_id), { name: String(p.new_name) });
          break;
        }
      }
      repo.update(action.id, { status: "executed", result });
      logger.info(`[${this.ctx.project.slug}] executed ${action.type} ${action.id} (${via})`);
      return {
        summary: `Done in Ads Manager: ${action.summary}.`,
        action_id: action.id,
        status: "executed",
        confirmed_via: via,
        result,
        note: "Meta still reviews new or edited ads before they deliver.",
        ...(result.adset_id && (action.type === "new_campaign" || action.type === "new_adset")
          ? {
              next_step: `Add ads to the new ad set with propose_new_ad (adset_id "${result.adset_id}").`,
            }
          : {}),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      repo.update(action.id, { status: "failed", result, error: message });
      const partial = Object.keys(result).length > 0;
      if (action.type === "new_campaign" && result.campaign_id && !result.adset_id) {
        throw new AppError(
          `Action ${action.id}: the campaign was created (id ${result.campaign_id}) but its ad set failed: ${message}`,
          `Fix the cause, then add the ad set with propose_new_adset (campaign_id "${result.campaign_id}") — or pause/delete the empty campaign in Ads Manager.`,
        );
      }
      throw new AppError(
        `Action ${action.id} failed: ${message}`,
        partial
          ? `Some steps were already done in Meta (${JSON.stringify(result)}). Check Ads Manager before trying again.`
          : "Nothing was changed in Meta. Fix the cause and propose again.",
      );
    }
  }

  /** Polls Meta's video processing for up to VIDEO_WAIT_MS; false = still processing (resume later). */
  private async waitForVideo(client: MetaApiClient, videoId: string): Promise<boolean> {
    const polls = Math.floor(VIDEO_WAIT_MS / VIDEO_POLL_MS);
    for (let i = 0; ; i++) {
      const s = await videoStatus(client, videoId);
      if (s === "ready") return true;
      if (s === "error") throw new MetaApiError(`Meta could not process video ${videoId}.`);
      if (i >= polls) return false;
      await this.ctx.sleep(VIDEO_POLL_MS);
    }
  }

  cancel(actionId: string) {
    const a = this.ctx.repos.actions.get(actionId);
    if (!a) throw new NotFoundError(`No action ${actionId}.`);
    if (a.status !== "pending")
      throw new AppError(`Action ${a.id} is ${a.status}; only pending actions can be cancelled.`);
    this.ctx.repos.actions.update(a.id, {
      status: "cancelled",
      decided_at: this.ctx.now().toISOString(),
    });
    return { summary: `Cancelled: ${a.summary}. Nothing was changed in Meta.`, action_id: a.id };
  }

  list(status?: AdAction["status"], limit = 20) {
    this.ctx.repos.actions.expire(this.ctx.now().toISOString());
    const actions = this.ctx.repos.actions.list({ status, limit });
    return {
      summary: `${actions.length} action(s)${status ? ` with status ${status}` : ""} for ${this.ctx.project.name}.`,
      write_enabled: this.ctx.env.META_WRITE_ENABLED,
      actions: actions.map((a) => ({
        id: a.id,
        type: a.type,
        status: a.status,
        summary: a.summary,
        created_at: a.created_at,
        decided_at: a.decided_at,
        confirmed_via: a.confirmed_via,
        result: a.result,
        error: a.error,
      })),
    };
  }
}

/** Plain-text summary shown in the client's confirmation dialog. */
function confirmationText(project: string, a: AdAction): string {
  const lines = [`Client project: ${project}`, `Change: ${a.summary}`];
  const warnings = (a.preview.warnings as string[] | undefined) ?? [];
  for (const [k, v] of Object.entries(a.preview)) {
    if (k === "what" || k === "warnings") continue;
    lines.push(`${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`);
  }
  if (warnings.length) lines.push("", ...warnings.map((w) => `⚠ ${w}`));
  lines.push("", "This changes your live Meta Ads Manager. Approve?");
  return lines.join("\n");
}
