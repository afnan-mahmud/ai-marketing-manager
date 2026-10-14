import type { AppContext } from "../context.js";
import { AdManagerService } from "./adManagerService.js";
import { AdsService } from "./adsService.js";
import { AnalyticsService } from "./analyticsService.js";
import { CompetitorService } from "./competitorService.js";
import { MarketService } from "./marketService.js";
import { PositioningService } from "./positioningService.js";
import { ReportService } from "./reportService.js";
import { SetupService } from "./setupService.js";

export interface Services {
  setup: SetupService;
  ads: AdsService;
  analytics: AnalyticsService;
  reports: ReportService;
  competitors: CompetitorService;
  positioning: PositioningService;
  market: MarketService;
  adManager: AdManagerService;
}

export function createServices(ctx: AppContext): Services {
  return {
    setup: new SetupService(ctx),
    ads: new AdsService(ctx),
    analytics: new AnalyticsService(ctx),
    reports: new ReportService(ctx),
    competitors: new CompetitorService(ctx),
    positioning: new PositioningService(ctx),
    market: new MarketService(ctx),
    adManager: new AdManagerService(ctx),
  };
}
