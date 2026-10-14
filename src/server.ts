import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppContext } from "./context.js";
import { allPrompts } from "./mcp/prompts/index.js";
import { allResources } from "./mcp/resources/index.js";
import { allTools } from "./mcp/tools/index.js";
import { callTool } from "./mcp/tooling.js";
import { logger } from "./utils/logger.js";

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

  for (const prompt of allPrompts) {
    server.registerPrompt(
      prompt.name,
      { title: prompt.title, description: prompt.description, argsSchema: prompt.argsSchema },
      (args: Record<string, string | undefined>) => ({
        messages: [
          { role: "user", content: { type: "text", text: prompt.build(args ?? {}, ctx) } },
        ],
      }),
    );
  }

  for (const res of allResources) {
    server.registerResource(
      res.name,
      res.uri,
      { title: res.title, description: res.description, mimeType: res.mimeType },
      (uri: URL) => {
        let text: string;
        try {
          text = res.read(ctx);
        } catch (err) {
          logger.error(`Resource ${res.uri} failed`, err);
          text = `Could not read ${res.uri}: see server log.`;
        }
        return { contents: [{ uri: uri.href, mimeType: res.mimeType, text }] };
      },
    );
  }

  return server;
}
