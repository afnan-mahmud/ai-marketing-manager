#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import dotenv from "dotenv";
import { join } from "node:path";
import { loadEnv } from "./config/env.js";
import { PROJECT_ROOT } from "./config/paths.js";
import { createContext } from "./context.js";
import { createServer } from "./server.js";
import { logger } from "./utils/logger.js";

async function main(): Promise<void> {
  // quiet: dotenv must not print to stdout, which belongs to the MCP transport.
  dotenv.config({ path: join(PROJECT_ROOT, ".env"), quiet: true });
  const env = loadEnv();
  logger.setLevel(env.LOG_LEVEL);
  const ctx = createContext({ env });
  const server = createServer(ctx);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info(`AI Marketing Manager MCP server running (data: ${ctx.paths.dataDir})`);

  const shutdown = () => {
    ctx.db.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  logger.error("Fatal startup error", err);
  process.exit(1);
});
