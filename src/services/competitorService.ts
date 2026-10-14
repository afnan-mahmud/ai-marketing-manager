import type { BusinessConfig } from "../config/business.js";
import type { AppContext } from "../context.js";

export class CompetitorService {
  constructor(private readonly ctx: AppContext) {}

  /**
   * business.yaml is the source of truth for the competitor list. Mirrors it into the DB:
   * upserts listed competitors (and the user's own brand as is_self), soft-deactivates the rest.
   */
  syncFromConfig(config: BusinessConfig | null = this.ctx.business.tryLoad()) {
    if (!config) return { synced: false, active: 0, deactivated: [] as string[] };
    const repo = this.ctx.repos.competitors;
    const before = repo.list().map((c) => c.name);
    const names = config.competitors.map((c) => c.name);
    for (const c of config.competitors) {
      repo.upsert({
        name: c.name,
        website: c.website,
        facebook_page_id: c.facebook_page_id,
        notes: c.notes,
      });
    }
    repo.deactivateExcept(names);
    repo.upsert({
      name: config.business.name,
      website: config.business.website,
      notes: "Your brand",
      is_self: true,
    });
    repo.clearSelfExcept(config.business.name);
    return {
      synced: true,
      active: names.length,
      deactivated: before.filter((n) => !names.includes(n)),
    };
  }
}
