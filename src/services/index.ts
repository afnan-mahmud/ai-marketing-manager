import type { AppContext } from "../context.js";
import { AdsService } from "./adsService.js";
import { AnalyticsService } from "./analyticsService.js";
import { SetupService } from "./setupService.js";

export interface Services {
  setup: SetupService;
  ads: AdsService;
  analytics: AnalyticsService;
}

export function createServices(ctx: AppContext): Services {
  return {
    setup: new SetupService(ctx),
    ads: new AdsService(ctx),
    analytics: new AnalyticsService(ctx),
  };
}
