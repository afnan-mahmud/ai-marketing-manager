import { adOptimizationPlan } from "./adOptimizationPlan.js";
import type { PromptDef } from "./common.js";
import { competitorReport } from "./competitorReport.js";
import { contentPlan } from "./contentPlan.js";
import { dailyBriefing } from "./dailyBriefing.js";
import { salesGrowthIdeas } from "./salesGrowthIdeas.js";
import { scriptIdeas } from "./scriptIdeas.js";
import { setupWizard } from "./setupWizard.js";
import { weeklyReview } from "./weeklyReview.js";

export const allPrompts: PromptDef[] = [
  dailyBriefing,
  adOptimizationPlan,
  contentPlan,
  scriptIdeas,
  salesGrowthIdeas,
  competitorReport,
  weeklyReview,
  setupWizard,
];
