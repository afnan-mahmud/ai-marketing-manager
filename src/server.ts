import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AppContext } from "./context.js";
import type { PromptCtx } from "./mcp/prompts/common.js";
import { allPrompts } from "./mcp/prompts/index.js";
import { allResources } from "./mcp/resources/index.js";
import { registeredTools } from "./mcp/tools/index.js";
import { callToolInWorkspace, exposedSchema } from "./mcp/tooling.js";
import { AppError, toFriendlyError } from "./utils/errors.js";
import { logger } from "./utils/logger.js";
import type { Workspace } from "./workspace.js";

export const SERVER_NAME = "ai-marketing-manager";
export const SERVER_VERSION = "0.1.0";

/** Prompt context for `project` (or the active project); null project if none can be resolved. */
function promptCtx(ws: Workspace, project?: string): PromptCtx {
  let ctx: AppContext | null;
  try {
    ctx = ws.context(project);
  } catch {
    ctx = null;
  }
  return { project: ctx, projects: ws.list(), today: () => ws.today() };
}

export function createServer(ws: Workspace): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions:
        "AI Marketing Manager for agencies: every client is a separate project (own folder, business profile, " +
        "competitors, Meta settings, data and reports). Use list_projects / create_project / switch_project, and pass " +
        "`project` to every tool when working for a client so data never mixes. Tools return facts as JSON; you supply " +
        "the judgment. Start with get_setup_status. Separate facts from recommendations, and never present competitor " +
        "positioning as real sales data.",
    },
  );

  // Ads Manager changes are approved by the human in the client's own dialog (MCP elicitation) when supported.
  ws.setConfirmer(async (req) => {
    if (!server.server.getClientCapabilities()?.elicitation) return "unsupported";
    try {
      const res = await server.server.elicitInput({
        message: `${req.title}\n\n${req.message}`,
        requestedSchema: {
          type: "object",
          properties: {
            approve: {
              type: "boolean",
              title: "Approve this change in Meta Ads Manager",
              default: false,
            },
          },
          required: ["approve"],
        },
      });
      return res.action === "accept" && res.content?.approve === true ? "accepted" : "declined";
    } catch (err) {
      logger.warn(`Confirmation dialog failed; treating as declined: ${(err as Error).message}`);
      return "declined";
    }
  });

  for (const tool of registeredTools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: exposedSchema(tool),
        annotations: {
          readOnlyHint: tool.readOnly ?? true,
          openWorldHint: tool.openWorld ?? false,
          destructiveHint: tool.destructive ?? false,
        },
      },
      (args: unknown) => callToolInWorkspace(tool, args, ws),
    );
  }

  for (const prompt of allPrompts) {
    server.registerPrompt(
      prompt.name,
      {
        title: prompt.title,
        description: prompt.description,
        argsSchema: {
          ...prompt.argsSchema,
          project: z
            .string()
            .optional()
            .describe("Client project name (default: the active project)."),
        },
      },
      (args: Record<string, string | undefined>) => ({
        messages: [
          {
            role: "user",
            content: { type: "text", text: prompt.build(args ?? {}, promptCtx(ws, args?.project)) },
          },
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
          text =
            res.scope === "workspace" && res.readWorkspace
              ? res.readWorkspace(ws)
              : res.read(ws.context());
        } catch (err) {
          if (err instanceof AppError) {
            text = JSON.stringify(toFriendlyError(err), null, 2);
          } else {
            logger.error(`Resource ${res.uri} failed`, err);
            text = `Could not read ${res.uri}: see server log.`;
          }
        }
        return { contents: [{ uri: uri.href, mimeType: res.mimeType, text }] };
      },
    );
  }

  return server;
}
