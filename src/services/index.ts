import type { AppContext } from "../context.js";
import { AdsService } from "./adsService.js";
import { AnalyticsService } from "./analyticsService.js";
import { CompetitorService } from "./competitorService.js";
import { ReportService } from "./reportService.js";
import { SetupService } from "./setupService.js";

export interface Services {
  setup: SetupService;
  ads: AdsService;
  analytics: AnalyticsService;
  reports: ReportService;
  competitors: CompetitorService;
}

export function createServices(ctx: AppContext): Services {
  return {
    setup: new SetupService(ctx),
    ads: new AdsService(ctx),
    analytics: new AnalyticsService(ctx),
    reports: new ReportService(ctx),
    competitors: new CompetitorService(ctx),
  };
}
