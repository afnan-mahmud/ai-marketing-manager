import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppContext } from "./context.js";
import { allTools } from "./mcp/tools/index.js";
import { callTool } from "./mcp/tooling.js";

export const SERVER_NAME = "ai-marketing-manager";
export const SERVER_VERSION = "0.1.0";

export function createServer(ctx: AppContext): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions:
        "AI Marketing Manager: tools return facts (Meta ad performance, competitors, market history) as JSON. " +
        "You supply the judgment. Start with get_setup_status. Separate facts from recommendations, and never present " +
        "competitor positioning as real sales data.",
    },
  );

  for (const tool of allTools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: {
          readOnlyHint: tool.readOnly ?? true,
          openWorldHint: tool.openWorld ?? false,
        },
      },
      (args: unknown) => callTool(tool, args, ctx),
    );
  }

  return server;
}
