import { businessPatchSchema } from "../../config/business.js";
import type { AnyToolDef } from "../tooling.js";
import { defineTool } from "../tooling.js";

export const getBusinessProfile = defineTool({
  name: "get_business_profile",
  title: "Business profile",
  description:
    "Returns the validated business profile from projects/<project>/business.yaml: business (name, sector, country, currency, language, products, audience, brand voice), goals and KPI targets, classification thresholds and competitors.",
  inputSchema: {},
  handler: (_args, ctx) => {
    const config = ctx.business.require();
    return {
      summary: `${config.business.name} — ${config.business.sector} in ${config.business.country}, primary KPI ${config.goals.primary_kpi}.`,
      path: ctx.business.path,
      profile: config,
    };
  },
});

export const updateBusinessProfile = defineTool({
  name: "update_business_profile",
  title: "Update business profile",
  description:
    "Creates or edits projects/<project>/business.yaml. Pass only the fields to change: objects merge, arrays (products, competitors) replace the whole list, null removes a value (e.g. goals.targets.max_cpa: null). Comments in the file are preserved. A new file needs business.name, sector, country (ISO-2) and currency (ISO-3).",
  inputSchema: businessPatchSchema.shape,
  readOnly: false,
  handler: (args, ctx) => {
    const existed = ctx.business.load().status !== "missing";
    ctx.services.competitors.syncFromConfig(); // mirror the pre-edit file so removals are reported accurately
    const config = ctx.business.update(args);
    const sync = ctx.services.competitors.syncFromConfig(config);
    return {
      summary: `${existed ? "Updated" : "Created"} ${ctx.business.path}.`,
      changed_sections: Object.keys(args).filter(
        (k) => (args as Record<string, unknown>)[k] !== undefined,
      ),
      competitors_synced: sync,
      profile: config,
    };
  },
});

export const profileTools: AnyToolDef[] = [getBusinessProfile, updateBusinessProfile];
