#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import dotenv from "dotenv";
import { join } from "node:path";
import { loadEnv } from "./config/env.js";
import { PROJECT_ROOT, resolveFromRoot } from "./config/paths.js";
import { createServer } from "./server.js";
import { logger } from "./utils/logger.js";
import { Workspace } from "./workspace.js";

async function main(): Promise<void> {
  // quiet: dotenv must not print to stdout, which belongs to the MCP transport.
  dotenv.config({ path: join(PROJECT_ROOT, ".env"), quiet: true });
  const env = loadEnv();
  logger.setLevel(env.LOG_LEVEL);
  if (process.env.META_AD_ACCOUNT_ID) {
    logger.warn(
      "META_AD_ACCOUNT_ID in the global .env is ignored: set each client's ad account in its project (configure_project_meta).",
    );
  }
  const ws = new Workspace({
    projectsDir: resolveFromRoot(env.PROJECTS_DIR),
    globalEnv: process.env,
  });
  const server = createServer(ws);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info(
    `AI Marketing Manager MCP server running (projects: ${ws.projectsDir}, ${ws.list().length} project(s))`,
  );

  const shutdown = () => {
    ws.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  logger.error("Fatal startup error", err);
  process.exit(1);
});
