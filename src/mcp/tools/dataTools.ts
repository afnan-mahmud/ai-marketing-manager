import { z } from "zod";
import type { AnyToolDef } from "../tooling.js";
import { defineTool } from "../tooling.js";

export const importAdsFromFolder = defineTool({
  name: "import_ads_from_folder",
  title: "Import Meta Ads exports",
  description:
    "Imports every Meta Ads Manager export (CSV/XLSX, Ads level, breakdown by Day) in data/inbox/ into the database. Re-imports update existing days (no duplicates). Imported files move to data/processed/. Use dry_run to preview.",
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

export const dataTools: AnyToolDef[] = [importAdsFromFolder, getDataCoverage];
