import type { AnyToolDef } from "../tooling.js";
import { setupTools } from "./setupTools.js";

export const allTools: AnyToolDef[] = [...setupTools];
