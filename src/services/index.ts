import type { AppContext } from "../context.js";
import { SetupService } from "./setupService.js";

export interface Services {
  setup: SetupService;
}

export function createServices(ctx: AppContext): Services {
  return {
    setup: new SetupService(ctx),
  };
}
