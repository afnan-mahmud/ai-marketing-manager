import type { AnyToolDef } from "../tooling.js";
import { dataTools } from "./dataTools.js";
import { setupTools } from "./setupTools.js";

export const allTools: AnyToolDef[] = [...setupTools, ...dataTools];
