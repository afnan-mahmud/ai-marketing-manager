import { z } from "zod";
import type { AnyToolDef } from "../tooling.js";
import { defineTool } from "../tooling.js";

export const getMarketContext = defineTool({
  name: "get_market_context",
  title: "Market context",
  description:
    "Sector, country, audience and products from the profile, the last 7 market snapshots, recurring trends and suggested search queries. Use before doing your own web research on the market.",
  inputSchema: {},
  handler: (_a, ctx) => ctx.services.market.context(),
});

export const saveMarketSnapshot = defineTool({
  name: "save_market_snapshot",
  title: "Save market snapshot",
  description:
    "Stores today's market research (your summary, trends with evidence and source URLs) so history builds up. Returns how many days each trend has appeared recently. Reuse the exact wording of a recurring trend.",
  inputSchema: {
    summary: z.string().min(1).max(5000),
    trends: z
      .array(
        z.object({
          trend: z.string().min(1).max(300),
          evidence: z.string().max(2000).optional(),
          source_url: z.string().url().optional(),
        }),
      )
      .max(30),
    sources: z.array(z.string()).max(50).default([]),
  },
  readOnly: false,
  handler: (a, ctx) =>
    ctx.services.market.save({ summary: a.summary, trends: a.trends, sources: a.sources ?? [] }),
});

export const getMarketHistory = defineTool({
  name: "get_market_history",
  title: "Market history",
  description:
    'Past market snapshots and recurring trends (days seen, current streak) — e.g. "this trend has appeared 5 days in a row".',
  inputSchema: {
    days: z.number().int().min(1).max(365).optional().describe("Look-back window (default 30)."),
  },
  handler: (a, ctx) => ctx.services.market.history(a.days ?? 30),
});

export const marketTools: AnyToolDef[] = [getMarketContext, saveMarketSnapshot, getMarketHistory];
