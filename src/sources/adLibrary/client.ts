import type { CompetitorAd } from "../../types/competitor.js";
import type { MetaApiClient } from "../metaApi/client.js";

/**
 * The Ad Library API returns commercial ads only for ads delivered in the EU (plus political/issue ads globally).
 * For other countries, commercial competitor ads are usually NOT returned — callers must say so.
 */
export const EU_COUNTRIES = new Set([
  "AT",
  "BE",
  "BG",
  "HR",
  "CY",
  "CZ",
  "DK",
  "EE",
  "FI",
  "FR",
  "DE",
  "GR",
  "HU",
  "IE",
  "IT",
  "LV",
  "LT",
  "LU",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SK",
  "SI",
  "ES",
  "SE",
]);

export const AD_LIBRARY_LIMITATION =
  "Meta's Ad Library API only returns commercial ads delivered in the EU (plus political/issue ads worldwide). " +
  "For other countries, browse the public Ad Library website (get_ad_library_link) and save ads you see to " +
  "projects/<project>/competitors/<competitor-name>.csv, then run import_competitor_ads.";

const FIELDS = [
  "id",
  "ad_creation_time",
  "ad_delivery_start_time",
  "ad_delivery_stop_time",
  "ad_creative_bodies",
  "ad_creative_link_titles",
  "ad_creative_link_captions",
  "publisher_platforms",
  "page_id",
  "page_name",
].join(",");

interface ArchivedAd {
  id: string;
  ad_creation_time?: string;
  ad_delivery_start_time?: string;
  ad_delivery_stop_time?: string;
  ad_creative_bodies?: string[];
  ad_creative_link_titles?: string[];
  ad_creative_link_captions?: string[];
  publisher_platforms?: string[];
}

/** Public Ad Library search URL (works without any token). */
export function adLibraryUrl(opts: {
  country: string;
  pageId?: string | null;
  query?: string;
}): string {
  const u = new URL("https://www.facebook.com/ads/library/");
  u.searchParams.set("active_status", "all");
  u.searchParams.set("ad_type", "all");
  u.searchParams.set("country", opts.country.toUpperCase());
  if (opts.pageId) {
    u.searchParams.set("view_all_page_id", opts.pageId);
    u.searchParams.set("search_type", "page");
  } else {
    u.searchParams.set("q", opts.query ?? "");
    u.searchParams.set("search_type", "keyword_unordered");
  }
  u.searchParams.set("media_type", "all");
  return u.toString();
}

export function mapArchivedAd(a: ArchivedAd, competitorId: number, today: string): CompetitorAd {
  const start = a.ad_delivery_start_time?.slice(0, 10) ?? a.ad_creation_time?.slice(0, 10) ?? null;
  const stop = a.ad_delivery_stop_time?.slice(0, 10) ?? null;
  return {
    competitor_id: competitorId,
    external_id: a.id,
    first_seen: today,
    last_seen: today,
    start_date: start,
    is_active: !stop || stop >= today,
    body: a.ad_creative_bodies?.[0] ?? null,
    headline: a.ad_creative_link_titles?.[0] ?? null,
    cta: null,
    format: null,
    landing_url: a.ad_creative_link_captions?.[0] ?? null,
    platforms: a.publisher_platforms?.join(",") ?? null,
    source: "ad_library",
  };
}

export async function searchAdLibrary(
  client: MetaApiClient,
  opts: { pageId?: string | null; searchTerms?: string; country: string },
): Promise<ArchivedAd[]> {
  return client.getAll<ArchivedAd>(
    "ads_archive",
    {
      ad_reached_countries: JSON.stringify([opts.country.toUpperCase()]),
      ad_active_status: "ALL",
      ad_type: "ALL",
      ...(opts.pageId
        ? { search_page_ids: opts.pageId }
        : { search_terms: opts.searchTerms ?? "" }),
      fields: FIELDS,
      limit: 100,
    },
    5,
  );
}
