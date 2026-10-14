import type { AnyToolDef, AnyWorkspaceToolDef } from "../tooling.js";
import { workspaceTools } from "./workspaceTools.js";
import { adManagerTools } from "./adManagerTools.js";
import { competitorTools } from "./competitorTools.js";
import { dataTools } from "./dataTools.js";
import { marketTools } from "./marketTools.js";
import { performanceTools } from "./performanceTools.js";
import { profileTools } from "./profileTools.js";
import { reportTools } from "./reportTools.js";
import { setupTools } from "./setupTools.js";

export const allTools: AnyToolDef[] = [
  ...setupTools,
  ...profileTools,
  ...dataTools,
  ...performanceTools,
  ...competitorTools,
  ...marketTools,
  ...reportTools,
  ...adManagerTools,
];

export { workspaceTools };

/** Everything the server registers: workspace tools first, then per-project tools. */
export const registeredTools: (AnyToolDef | AnyWorkspaceToolDef)[] = [
  ...workspaceTools,
  ...allTools,
];
