export type Level = "campaign" | "adset" | "ad";
export type AdSource = "export" | "api";
export type CreativeFormat = "image" | "video" | "carousel" | "unknown";

/** Raw additive counts. Every ratio metric is derived from sums of these. */
export interface RawCounts {
  spend: number;
  impressions: number;
  reach: number;
  clicks_all: number;
  link_clicks: number;
  landing_page_views: number;
  add_to_cart: number;
  initiate_checkout: number;
  purchases: number;
  purchase_value: number;
  leads: number;
  messages: number;
  video_3s_views: number;
  video_thruplays: number;
}

export const COUNT_FIELDS: (keyof RawCounts)[] = [
  "spend",
  "impressions",
  "reach",
  "clicks_all",
  "link_clicks",
  "landing_page_views",
  "add_to_cart",
  "initiate_checkout",
  "purchases",
  "purchase_value",
  "leads",
  "messages",
  "video_3s_views",
  "video_thruplays",
];

/** Canonical daily performance row at ad level (table ad_daily). */
export interface AdDailyRow extends RawCounts {
  date: string;
  ad_id: string;
  ad_name: string | null;
  adset_id: string | null;
  adset_name: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  objective: string | null;
  source: AdSource;
}

export interface AdCreative {
  ad_id: string;
  headline: string | null;
  primary_text: string | null;
  cta: string | null;
  format: CreativeFormat;
  thumbnail_url: string | null;
  landing_url: string | null;
}
