import type { AppContext } from "../context.js";
import { AdsService } from "./adsService.js";
import { SetupService } from "./setupService.js";

export interface Services {
  setup: SetupService;
  ads: AdsService;
}

export function createServices(ctx: AppContext): Services {
  return {
    setup: new SetupService(ctx),
    ads: new AdsService(ctx),
  };
}
