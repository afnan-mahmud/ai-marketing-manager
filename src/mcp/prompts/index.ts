import { adOptimizationPlan } from "./adOptimizationPlan.js";
import type { PromptDef } from "./common.js";
import { contentPlan } from "./contentPlan.js";
import { salesGrowthIdeas } from "./salesGrowthIdeas.js";
import { scriptIdeas } from "./scriptIdeas.js";
import { setupWizard } from "./setupWizard.js";

export const allPrompts: PromptDef[] = [
  adOptimizationPlan,
  contentPlan,
  scriptIdeas,
  salesGrowthIdeas,
  setupWizard,
];
