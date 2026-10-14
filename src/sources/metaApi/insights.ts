import type { AdDailyRow, RawCounts } from "../../types/ads.js";
import type { DateRange } from "../../utils/dates.js";
import type { MetaApiClient } from "./client.js";

export const INSIGHT_FIELDS = [
  "ad_id",
  "ad_name",
  "adset_id",
  "adset_name",
  "campaign_id",
  "campaign_name",
  "objective",
  "spend",
  "impressions",
  "reach",
  "clicks",
  "inline_link_clicks",
  "actions",
  "action_values",
  "video_thruplay_watched_actions",
];

/**
 * action_type → canonical field. Meta reports the same conversion under several overlapping action types
 * (omni_*, plain, pixel), so the FIRST type present in each list wins — they are never summed.
 * Edit here if Meta renames action types.
 */
export const ACTION_TYPE_MAP: Partial<Record<keyof RawCounts, string[]>> = {
  purchases: [
    "omni_purchase",
    "purchase",
    "offsite_conversion.fb_pixel_purchase",
    "onsite_web_purchase",
  ],
  landing_page_views: ["landing_page_view", "omni_landing_page_view"],
  add_to_cart: ["omni_add_to_cart", "add_to_cart", "offsite_conversion.fb_pixel_add_to_cart"],
  initiate_checkout: [
    "omni_initiated_checkout",
    "initiate_checkout",
    "offsite_conversion.fb_pixel_initiate_checkout",
  ],
  leads: [
    "lead",
    "onsite_conversion.lead_grouped",
    "offsite_conversion.fb_pixel_lead",
    "leadgen_grouped",
  ],
  messages: ["onsite_conversion.messaging_conversation_started_7d"],
  video_3s_views: ["video_view"],
};

export const ACTION_VALUE_MAP: Partial<Record<keyof RawCounts, string[]>> = {
  purchase_value: ACTION_TYPE_MAP.purchases!,
};

interface ActionStat {
  action_type: string;
  value: string;
}

export interface InsightRow {
  date_start: string;
  date_stop?: string;
  ad_id: string;
  ad_name?: string;
  adset_id?: string;
  adset_name?: string;
  campaign_id?: string;
  campaign_name?: string;
  objective?: string;
  spend?: string;
  impressions?: string;
  reach?: string;
  clicks?: string;
  inline_link_clicks?: string;
  actions?: ActionStat[];
  action_values?: ActionStat[];
  video_thruplay_watched_actions?: ActionStat[];
}

const num = (v: string | undefined): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

export function pickAction(stats: ActionStat[] | undefined, types: string[]): number {
  if (!stats) return 0;
  for (const t of types) {
    const s = stats.find((x) => x.action_type === t);
    if (s) return num(s.value);
  }
  return 0;
}

export function mapInsightRow(r: InsightRow): AdDailyRow {
  const linkClicks =
    r.inline_link_clicks !== undefined
      ? num(r.inline_link_clicks)
      : pickAction(r.actions, ["link_click"]);
  return {
    date: r.date_start,
    ad_id: r.ad_id,
    ad_name: r.ad_name ?? null,
    adset_id: r.adset_id ?? null,
    adset_name: r.adset_name ?? null,
    campaign_id: r.campaign_id ?? null,
    campaign_name: r.campaign_name ?? null,
    objective: r.objective ?? null,
    source: "api",
    spend: num(r.spend),
    impressions: num(r.impressions),
    reach: num(r.reach),
    clicks_all: num(r.clicks),
    link_clicks: linkClicks,
    landing_page_views: pickAction(r.actions, ACTION_TYPE_MAP.landing_page_views!),
    add_to_cart: pickAction(r.actions, ACTION_TYPE_MAP.add_to_cart!),
    initiate_checkout: pickAction(r.actions, ACTION_TYPE_MAP.initiate_checkout!),
    purchases: pickAction(r.actions, ACTION_TYPE_MAP.purchases!),
    purchase_value: pickAction(r.action_values, ACTION_VALUE_MAP.purchase_value!),
    leads: pickAction(r.actions, ACTION_TYPE_MAP.leads!),
    messages: pickAction(r.actions, ACTION_TYPE_MAP.messages!),
    video_3s_views: pickAction(r.actions, ACTION_TYPE_MAP.video_3s_views!),
    video_thruplays: pickAction(r.video_thruplay_watched_actions, ["video_view"]),
  };
}

/** Daily ad-level insights for the range (one row per ad per day). */
export async function fetchDailyInsights(
  client: MetaApiClient,
  accountId: string,
  range: DateRange,
): Promise<AdDailyRow[]> {
  const rows = await client.getAll<InsightRow>(`act_${accountId}/insights`, {
    level: "ad",
    time_increment: 1,
    time_range: JSON.stringify({ since: range.since, until: range.until }),
    fields: INSIGHT_FIELDS.join(","),
    limit: 500,
  });
  return rows.map(mapInsightRow);
}
