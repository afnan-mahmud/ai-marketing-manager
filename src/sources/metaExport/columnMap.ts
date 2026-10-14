/**
 * Maps the many header variants Meta Ads Manager exports use (they change over time and with settings)
 * to canonical field names. Add new variants here — matching is case/space-insensitive and ignores a
 * trailing currency code like "(BDT)".
 */
export const FIELD_ALIASES = {
  date: ["Day", "Date", "Reporting date"],
  reporting_start: ["Reporting starts", "Reporting start", "Date start"],
  reporting_end: ["Reporting ends", "Reporting end", "Date stop"],
  ad_id: ["Ad ID", "Ad Id", "AdID"],
  ad_name: ["Ad name", "Ad Name", "Ad"],
  adset_id: ["Ad set ID", "Adset ID", "Ad Set ID"],
  adset_name: ["Ad set name", "Adset name", "Ad Set Name", "Ad set"],
  campaign_id: ["Campaign ID"],
  campaign_name: ["Campaign name", "Campaign Name", "Campaign"],
  objective: ["Objective", "Campaign objective"],
  spend: ["Amount spent", "Spend", "Amount Spent", "Cost"],
  impressions: ["Impressions"],
  reach: ["Reach"],
  clicks_all: ["Clicks (all)", "Clicks (All)", "All clicks", "Clicks"],
  link_clicks: ["Link clicks", "Clicks (link)", "Link Clicks", "Inline link clicks"],
  landing_page_views: ["Landing page views", "Website landing page views", "Landing Page Views"],
  add_to_cart: ["Adds to cart", "Add to cart", "Website adds to cart", "Adds to Cart"],
  initiate_checkout: [
    "Checkouts initiated",
    "Initiate checkout",
    "Website checkouts initiated",
    "Checkouts Initiated",
    "Initiated checkouts",
  ],
  purchases: ["Purchases", "Website purchases", "Purchase", "Meta purchases"],
  purchase_value: [
    "Purchases conversion value",
    "Purchase conversion value",
    "Website purchases conversion value",
    "Purchases Conversion Value",
    "Purchase value",
    "Conversion value",
  ],
  leads: ["Leads", "Website leads", "On-Facebook leads", "Leads (form)", "Meta leads"],
  messages: [
    "Messaging conversations started",
    "Messaging Conversations Started",
    "Messaging conversations",
    "Conversations started",
  ],
  video_3s_views: [
    "3-second video plays",
    "3-Second Video Plays",
    "3-second video views",
    "Video plays (3s)",
    "3 second video plays",
  ],
  video_thruplays: ["ThruPlays", "Thruplays", "ThruPlay", "Video thruplays"],
  // "Results" depends on the campaign's optimisation goal; mapped per row using result_indicator.
  result_count: ["Results"],
  result_indicator: ["Result indicator", "Result type", "Results type"],
  // Creative fields (present in some exports / custom column sets).
  headline: ["Headline", "Title", "Ad headline", "Link title"],
  primary_text: ["Body", "Primary text", "Ad body", "Text"],
  cta: ["Call to action", "Call to Action", "Call to action type", "CTA"],
  format: ["Format", "Ad format", "Creative type", "Media type"],
  landing_url: ["Website URL", "Link", "Landing page URL", "Destination URL"],
  thumbnail_url: ["Thumbnail URL", "Image URL"],
} as const;

export type CanonicalField = keyof typeof FIELD_ALIASES;

export const REQUIRED_FIELDS: {
  field: CanonicalField;
  alternatives?: CanonicalField[];
  label: string;
}[] = [
  { field: "date", alternatives: ["reporting_end"], label: "Day (or Reporting ends)" },
  { field: "ad_name", alternatives: ["ad_id"], label: "Ad name (or Ad ID)" },
  { field: "spend", label: "Amount spent" },
  { field: "impressions", label: "Impressions" },
];

/** Columns Meta computes from counts; we recompute them ourselves, so they are ignored silently. */
const DERIVED_COLUMN = [
  /^ctr\b/,
  /^cpc\b/,
  /^cpm\b/,
  /^cost per/,
  /^frequency$/,
  /roas/,
  /rate\b/,
  /^result rate/,
  /^attribution setting$/,
  /^delivery( status| level)?$/,
  /budget/,
  /^bid/,
  /^currency$/,
  /^(starts|ends)$/, // ad set schedule, not the reporting window
  /^account (name|id)$/,
];

export function isDerivedColumn(normalizedHeader: string): boolean {
  return DERIVED_COLUMN.some((re) => re.test(normalizedHeader));
}

export interface NormalizedHeader {
  normalized: string;
  currency: string | null;
}

/** "Amount spent (BDT)" → { normalized: "amount spent", currency: "BDT" } */
export function normalizeHeader(header: string): NormalizedHeader {
  let h = header.replace(/^\uFEFF/, "").trim();
  let currency: string | null = null;
  const m = h.match(/\s*\(([A-Z]{3})\)\s*$/);
  if (m && m[1]) {
    currency = m[1];
    h = h.slice(0, m.index);
  }
  return {
    normalized: h.toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim(),
    currency,
  };
}

const ALIAS_INDEX: Map<string, CanonicalField> = (() => {
  const m = new Map<string, CanonicalField>();
  for (const [field, aliases] of Object.entries(FIELD_ALIASES) as [
    CanonicalField,
    readonly string[],
  ][]) {
    for (const a of aliases) {
      const key = normalizeHeader(a).normalized;
      if (!m.has(key)) m.set(key, field);
    }
  }
  return m;
})();

export interface ColumnMapping {
  /** canonical field → original header */
  fields: Partial<Record<CanonicalField, string>>;
  ignored: string[];
  derivedIgnored: string[];
  currency: string | null;
}

export function mapColumns(headers: string[]): ColumnMapping {
  const fields: Partial<Record<CanonicalField, string>> = {};
  const ignored: string[] = [];
  const derivedIgnored: string[] = [];
  let currency: string | null = null;
  for (const header of headers) {
    if (!header || !header.trim()) continue;
    const { normalized, currency: cur } = normalizeHeader(header);
    const field = ALIAS_INDEX.get(normalized);
    if (field && !fields[field]) {
      fields[field] = header;
      if (cur && field === "spend") currency = cur;
    } else if (field) {
      ignored.push(header); // duplicate mapping, first wins
    } else if (isDerivedColumn(normalized)) {
      derivedIgnored.push(header);
    } else {
      ignored.push(header);
    }
  }
  return { fields, ignored, derivedIgnored, currency };
}
