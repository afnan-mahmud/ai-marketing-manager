import { MetaApiError } from "../../utils/errors.js";
import type { MetaApiClient } from "./client.js";

/**
 * Creating campaigns and ad sets. Payload builders are pure (unit-tested); the create* functions change Ads Manager and
 * must only run from a user-confirmed action.
 */

export const CAMPAIGN_OBJECTIVES = [
  "OUTCOME_SALES",
  "OUTCOME_LEADS",
  "OUTCOME_TRAFFIC",
  "OUTCOME_AWARENESS",
] as const;
export type CampaignObjective = (typeof CAMPAIGN_OBJECTIVES)[number];

export const SPECIAL_AD_CATEGORIES = [
  "HOUSING",
  "EMPLOYMENT",
  "CREDIT",
  "FINANCIAL_PRODUCTS_SERVICES",
  "ISSUES_ELECTIONS_POLITICS",
] as const;

export const PLATFORMS = ["facebook", "instagram", "messenger", "audience_network"] as const;

export interface LocationInput {
  type: "country" | "region" | "city";
  /** Country code for countries; the key from search_targeting for regions/cities. */
  key: string;
  name?: string;
  /** Cities only: radius around the city in km (Meta allows 17–80 km; omit for the city itself). */
  radius_km?: number;
}

export interface AdSetSpec {
  name: string;
  locations: LocationInput[];
  age_min?: number;
  age_max?: number;
  genders?: "all" | "male" | "female";
  interests?: { id: string; name: string }[];
  /** Let Meta expand beyond the audience (Advantage+ audience). Default off = target exactly what is given. */
  advantage_audience?: boolean;
  /** Omit for Advantage+ placements (all placements, Meta's recommendation). */
  platforms?: (typeof PLATFORMS)[number][];
  /** Traffic campaigns only. */
  optimization_goal?: "LANDING_PAGE_VIEWS" | "LINK_CLICKS";
  start_time?: string;
  end_time?: string;
}

/** What each supported objective optimises for, and what it needs. */
export const OBJECTIVE_CONFIG: Record<
  CampaignObjective,
  {
    optimization_goal: string;
    destination_type?: string;
    event?: "PURCHASE" | "LEAD";
    label: string;
  }
> = {
  OUTCOME_SALES: {
    optimization_goal: "OFFSITE_CONVERSIONS",
    destination_type: "WEBSITE",
    event: "PURCHASE",
    label: "Sales (website purchases)",
  },
  OUTCOME_LEADS: {
    optimization_goal: "OFFSITE_CONVERSIONS",
    destination_type: "WEBSITE",
    event: "LEAD",
    label: "Leads (website lead event)",
  },
  OUTCOME_TRAFFIC: {
    optimization_goal: "LANDING_PAGE_VIEWS",
    destination_type: "WEBSITE",
    label: "Traffic (website)",
  },
  OUTCOME_AWARENESS: { optimization_goal: "REACH", label: "Awareness (reach)" },
};

export function buildTargeting(spec: AdSetSpec): Record<string, unknown> {
  const countries = spec.locations
    .filter((l) => l.type === "country")
    .map((l) => l.key.toUpperCase());
  const regions = spec.locations.filter((l) => l.type === "region").map((l) => ({ key: l.key }));
  const cities = spec.locations
    .filter((l) => l.type === "city")
    .map((l) =>
      l.radius_km
        ? { key: l.key, radius: l.radius_km, distance_unit: "kilometer" }
        : { key: l.key },
    );
  const geo: Record<string, unknown> = { location_types: ["home", "recent"] };
  if (countries.length) geo.countries = countries;
  if (regions.length) geo.regions = regions;
  if (cities.length) geo.cities = cities;
  const t: Record<string, unknown> = {
    geo_locations: geo,
    age_min: spec.age_min ?? 18,
    age_max: spec.age_max ?? 65,
    targeting_automation: { advantage_audience: spec.advantage_audience ? 1 : 0 },
  };
  if (spec.genders === "male") t.genders = [1];
  if (spec.genders === "female") t.genders = [2];
  if (spec.interests?.length)
    t.flexible_spec = [{ interests: spec.interests.map((i) => ({ id: i.id, name: i.name })) }];
  if (spec.platforms?.length) t.publisher_platforms = spec.platforms;
  return t;
}

export function campaignPayload(c: {
  name: string;
  objective: CampaignObjective;
  status: "ACTIVE" | "PAUSED";
  special_ad_categories: string[];
  /** Minor units; set = campaign budget (CBO). */
  daily_budget_minor?: number;
}): Record<string, string> {
  return {
    name: c.name,
    objective: c.objective,
    status: c.status,
    buying_type: "AUCTION",
    special_ad_categories: JSON.stringify(c.special_ad_categories),
    ...(c.daily_budget_minor !== undefined
      ? { daily_budget: String(c.daily_budget_minor), bid_strategy: "LOWEST_COST_WITHOUT_CAP" }
      : {}),
  };
}

export function adSetPayload(a: {
  spec: AdSetSpec;
  campaign_id: string;
  objective: CampaignObjective;
  status: "ACTIVE" | "PAUSED";
  /** Minor units; omit when the campaign has its own budget (CBO). */
  daily_budget_minor?: number;
  pixel_id?: string;
}): Record<string, string> {
  const cfg = OBJECTIVE_CONFIG[a.objective];
  const optimization =
    a.objective === "OUTCOME_TRAFFIC" && a.spec.optimization_goal
      ? a.spec.optimization_goal
      : cfg.optimization_goal;
  const payload: Record<string, string> = {
    name: a.spec.name,
    campaign_id: a.campaign_id,
    status: a.status,
    billing_event: "IMPRESSIONS",
    optimization_goal: optimization,
    targeting: JSON.stringify(buildTargeting(a.spec)),
  };
  if (cfg.destination_type) payload.destination_type = cfg.destination_type;
  if (cfg.event) {
    if (!a.pixel_id) throw new MetaApiError(`${cfg.label} needs a Meta Pixel (META_PIXEL_ID).`);
    payload.promoted_object = JSON.stringify({
      pixel_id: a.pixel_id,
      custom_event_type: cfg.event,
    });
  }
  if (a.daily_budget_minor !== undefined) {
    payload.daily_budget = String(a.daily_budget_minor);
    payload.bid_strategy = "LOWEST_COST_WITHOUT_CAP";
  }
  if (a.spec.start_time) payload.start_time = a.spec.start_time;
  if (a.spec.end_time) payload.end_time = a.spec.end_time;
  return payload;
}

/**
 * Creates a campaign. Newer API versions require `is_adset_budget_sharing_enabled` for campaigns without a campaign
 * budget; older ones reject the unknown field — so it is added only when Meta asks for it (nothing was created by the
 * rejected request, so retrying once is safe).
 */
export async function createCampaign(
  client: MetaApiClient,
  accountId: string,
  payload: Record<string, string>,
): Promise<string> {
  const post = (p: Record<string, string>) =>
    client.post<{ id?: string }>(`act_${accountId}/campaigns`, p);
  let res: { id?: string };
  try {
    res = await post(payload);
  } catch (err) {
    if (
      err instanceof MetaApiError &&
      /is_adset_budget_sharing_enabled/.test(err.message) &&
      !payload.daily_budget
    ) {
      res = await post({ ...payload, is_adset_budget_sharing_enabled: "false" });
    } else throw err;
  }
  if (!res.id) throw new MetaApiError("Meta did not return a campaign id.");
  return res.id;
}

export async function createAdSet(
  client: MetaApiClient,
  accountId: string,
  payload: Record<string, string>,
): Promise<string> {
  const res = await client.post<{ id?: string }>(`act_${accountId}/adsets`, payload);
  if (!res.id) throw new MetaApiError("Meta did not return an ad set id.");
  return res.id;
}

export interface TargetingResult {
  type: string;
  key?: string;
  id?: string;
  name: string;
  country_code?: string;
  region?: string;
  audience_size_lower_bound?: number;
  audience_size_upper_bound?: number;
  path?: string[];
}

/** Looks up location keys (countries/regions/cities) or interest ids for targeting. Read-only. */
export async function searchTargeting(
  client: MetaApiClient,
  kind: "location" | "interest",
  query: string,
  countryCode?: string,
): Promise<TargetingResult[]> {
  if (kind === "interest") {
    const res = await client.get<{ data?: TargetingResult[] }>("search", {
      type: "adinterest",
      q: query,
      limit: 25,
    });
    return (res.data ?? []).map((r) => ({ ...r, type: "interest" }));
  }
  const res = await client.get<{ data?: (TargetingResult & { type: string })[] }>("search", {
    type: "adgeolocation",
    q: query,
    location_types: JSON.stringify(["country", "region", "city"]),
    ...(countryCode ? { country_code: countryCode.toUpperCase() } : {}),
    limit: 25,
  });
  return res.data ?? [];
}
