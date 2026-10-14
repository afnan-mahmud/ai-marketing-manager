import { z } from "zod";
import { isoDateSchema } from "../../utils/dates.js";
import type { AnyToolDef } from "../tooling.js";
import { defineTool } from "../tooling.js";

export const importAdsFromFolder = defineTool({
  name: "import_ads_from_folder",
  title: "Import Meta Ads exports",
  description:
    "Imports every Meta Ads Manager export (CSV/XLSX, Ads level, breakdown by Day) in projects/<project>/inbox/ into the database. Re-imports update existing days (no duplicates). Imported files move to projects/<project>/processed/. Use dry_run to preview.",
  inputSchema: {
    dry_run: z.boolean().optional().describe("Parse and report without writing or moving files."),
  },
  readOnly: false,
  handler: (args, ctx) => ctx.services.ads.importFromFolder(args.dry_run ?? false),
});

export const getDataCoverage = defineTool({
  name: "get_data_coverage",
  title: "Data coverage",
  description:
    "Dates available in the ad database, missing days (gaps), sources (export/api), and number of ads, ad sets and campaigns.",
  inputSchema: {},
  handler: (_args, ctx) => ctx.services.ads.coverage(),
});

export const syncAdsFromMeta = defineTool({
  name: "sync_ads_from_meta",
  title: "Sync from Meta Marketing API",
  description:
    "Pulls daily ad-level insights (spend, impressions, clicks, conversions, video views) and ad creatives (headline, text, CTA, format) from the Meta Marketing API into the same tables as exports. Only reads (ads_read). Default: the last 7 days, to capture late attribution.",
  inputSchema: {
    since: isoDateSchema.optional().describe("Start date YYYY-MM-DD (default 7 days ago)."),
    until: isoDateSchema.optional().describe("End date YYYY-MM-DD (default yesterday)."),
  },
  readOnly: false,
  openWorld: true,
  handler: (args, ctx) => ctx.services.ads.syncFromMeta(args.since, args.until),
});

export const dataTools: AnyToolDef[] = [importAdsFromFolder, syncAdsFromMeta, getDataCoverage];
