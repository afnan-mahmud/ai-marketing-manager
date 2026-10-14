import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Project root = two levels up from this file (src/config or dist/config).
 * Defaults are resolved against it so the server works no matter which cwd the MCP client uses.
 */
export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export function resolveFromRoot(p: string): string {
  return isAbsolute(p) ? p : resolve(PROJECT_ROOT, p);
}

export interface Paths {
  /** The project folder (projects/<slug>/): everything for one client lives here. */
  dataDir: string;
  inbox: string;
  processed: string;
  competitors: string;
  snapshots: string;
  reports: string;
  /** Ad images/videos the user wants to run (projects/<client>/creatives/). */
  creatives: string;
  dbFile: string;
  businessConfig: string;
  projectEnv: string;
  businessExample: string;
}

export function buildPaths(
  dataDir: string,
  businessConfig = join(dataDir, "business.yaml"),
): Paths {
  return {
    dataDir,
    inbox: join(dataDir, "inbox"),
    processed: join(dataDir, "processed"),
    competitors: join(dataDir, "competitors"),
    snapshots: join(dataDir, "snapshots"),
    reports: join(dataDir, "reports"),
    creatives: join(dataDir, "creatives"),
    dbFile: join(dataDir, "app.db"),
    businessConfig,
    projectEnv: join(dataDir, "project.env"),
    businessExample: join(PROJECT_ROOT, "config", "business.example.yaml"),
  };
}
