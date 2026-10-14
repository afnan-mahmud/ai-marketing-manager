import type { AnyToolDef } from "../tooling.js";
import { defineTool } from "../tooling.js";

export const getSetupStatus = defineTool({
  name: "get_setup_status",
  title: "Setup status",
  description:
    "Checks business.yaml, .env keys, the database, data freshness (last date in ad_daily) and files waiting in projects/<project>/inbox/. Returns what is missing and next steps. Call this first in any workflow.",
  inputSchema: {},
  handler: (_args, ctx) => ctx.services.setup.status(),
});

export const setupTools: AnyToolDef[] = [getSetupStatus];
