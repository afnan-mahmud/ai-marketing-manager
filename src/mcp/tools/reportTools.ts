import { z } from "zod";
import { REPORT_TYPE_PATTERN } from "../../services/reportService.js";
import { isoDateSchema } from "../../utils/dates.js";
import type { AnyToolDef } from "../tooling.js";
import { defineTool } from "../tooling.js";

const reportType = z
  .string()
  .regex(REPORT_TYPE_PATTERN, "lowercase letters, digits and _ only")
  .describe(
    "e.g. daily_briefing, weekly_review, content_plan, ad_optimization_plan, competitor_report, script_ideas, sales_growth_ideas",
  );

export const saveReport = defineTool({
  name: "save_report",
  title: "Save report",
  description:
    "Saves a Markdown report to data/reports/YYYY-MM-DD-<type>.md and indexes it, so later conversations can refer back. Saving the same type twice on one day replaces it.",
  inputSchema: {
    type: reportType,
    title: z.string().min(1).max(200),
    markdown: z.string().min(1).max(200_000),
  },
  readOnly: false,
  handler: (args, ctx) => ctx.services.reports.save(args.type, args.title, args.markdown),
});

export const listReports = defineTool({
  name: "list_reports",
  title: "List reports",
  description: "Lists saved reports (newest first), optionally filtered by type and date range.",
  inputSchema: {
    type: reportType.optional(),
    since: isoDateSchema.optional(),
    until: isoDateSchema.optional(),
    limit: z.number().int().min(1).max(100).optional().describe("Default 20."),
  },
  handler: (args, ctx) => ctx.services.reports.list(args),
});

export const getReport = defineTool({
  name: "get_report",
  title: "Get report",
  description:
    'Returns a saved report\'s Markdown, by id, by date + type, or the latest of a type (pass only type). Use it to keep continuity ("last week you recommended…").',
  inputSchema: {
    id: z.number().int().positive().optional(),
    date: isoDateSchema.optional(),
    type: reportType.optional(),
  },
  handler: (args, ctx) => ctx.services.reports.get(args),
});

export const reportTools: AnyToolDef[] = [saveReport, listReports, getReport];
