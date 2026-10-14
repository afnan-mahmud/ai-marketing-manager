import { existsSync, readdirSync } from "node:fs";
import type { AppContext } from "../context.js";
import { daysBetween } from "../utils/dates.js";

export const IMPORTABLE_EXTENSIONS = [".csv", ".xlsx", ".xls"];

export function listInboxFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(
      (f) => !f.startsWith(".") && IMPORTABLE_EXTENSIONS.some((e) => f.toLowerCase().endsWith(e)),
    )
    .sort();
}

export class SetupService {
  constructor(private readonly ctx: AppContext) {}

  status() {
    const { ctx } = this;
    const nextSteps: string[] = [];

    const cfg = ctx.business.load();
    const config =
      cfg.status === "ok"
        ? {
            status: "ok" as const,
            path: ctx.business.path,
            business_name: cfg.config.business.name,
            competitors: cfg.config.competitors.length,
            has_targets: Object.keys(cfg.config.goals.targets).length > 0,
          }
        : cfg.status === "missing"
          ? { status: "missing" as const, path: ctx.business.path }
          : { status: "invalid" as const, path: ctx.business.path, issues: cfg.issues };
    if (cfg.status === "missing") {
      nextSteps.push(
        "Create config/business.yaml (copy config/business.example.yaml) or run the setup_wizard prompt.",
      );
    } else if (cfg.status === "invalid") {
      nextSteps.push(`Fix config/business.yaml: ${cfg.issues.join("; ")}`);
    } else if (Object.keys(cfg.config.goals.targets).length === 0) {
      nextSteps.push(
        "Add goals.targets (max_cpa / min_roas) so ads can be judged against your targets.",
      );
    }

    const metaApiConfigured = Boolean(ctx.env.META_ACCESS_TOKEN && ctx.env.META_AD_ACCOUNT_ID);
    const env = {
      meta_api_configured: metaApiConfigured,
      meta_access_token_set: Boolean(ctx.env.META_ACCESS_TOKEN),
      meta_ad_account_id_set: Boolean(ctx.env.META_AD_ACCOUNT_ID),
      meta_api_version: ctx.env.META_API_VERSION,
      ad_library_token_set: Boolean(ctx.env.META_AD_LIBRARY_TOKEN || ctx.env.META_ACCESS_TOKEN),
    };

    const inboxFiles = listInboxFiles(ctx.paths.inbox);
    const lastDate = ctx.repos.ads.lastDate();
    const today = ctx.today();
    const daysOld = lastDate ? daysBetween(lastDate, today) : null;
    const data = {
      data_dir: ctx.paths.dataDir,
      database: "ok",
      rows: ctx.repos.ads.countRows(),
      data_last_date: lastDate,
      days_since_last_data: daysOld,
      is_stale: daysOld === null ? null : daysOld > 2,
      inbox_files_waiting: inboxFiles,
      recent_imports: ctx.repos.ads.recentImports(3),
    };

    if (inboxFiles.length > 0) {
      nextSteps.push(
        `Run import_ads_from_folder: ${inboxFiles.length} file(s) waiting in data/inbox/.`,
      );
    }
    if (!lastDate && inboxFiles.length === 0) {
      nextSteps.push(
        metaApiConfigured
          ? "No ad data yet: run sync_ads_from_meta."
          : "No ad data yet: export from Ads Manager (Ads level, breakdown by Day) into data/inbox/, or set META_ACCESS_TOKEN + META_AD_ACCOUNT_ID in .env.",
      );
    } else if (daysOld !== null && daysOld > 2 && inboxFiles.length === 0) {
      nextSteps.push(
        metaApiConfigured
          ? `Data is ${daysOld} days old: run sync_ads_from_meta.`
          : `Data is ${daysOld} days old: drop a fresh Ads Manager export into data/inbox/.`,
      );
    }

    if (cfg.status === "ok") ctx.services.competitors.syncFromConfig(cfg.config);
    const competitors = ctx.repos.competitors.list();
    const ready = cfg.status === "ok" && lastDate !== null;
    const summary = ready
      ? `Ready. Data through ${lastDate}${daysOld !== null && daysOld > 2 ? ` (${daysOld} days old)` : ""}; ${nextSteps.length} suggestion(s).`
      : `Setup incomplete: ${nextSteps.length} step(s) needed.`;

    return {
      summary,
      ready,
      today,
      config,
      env,
      data,
      competitors_tracked: competitors.length,
      next_steps: nextSteps,
    };
  }
}
