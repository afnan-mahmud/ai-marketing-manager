import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { AppContext } from "../context.js";
import type { Workspace } from "../workspace.js";
import { AppError, toFriendlyError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

/** Every tool result starts with a one-line human summary; the rest is structured data. */
export interface ToolOutput {
  summary: string;
  [key: string]: unknown;
}

export interface ToolDef<S extends z.ZodRawShape = z.ZodRawShape> {
  /** "project" tools (default) run inside one client project; "workspace" tools manage projects. */
  scope?: "project";
  name: string;
  title?: string;
  description: string;
  inputSchema: S;
  /** false for tools that write files/DB or fetch the network. Defaults to true. */
  readOnly?: boolean;
  /** true for tools that reach external services (Meta API, competitor websites). */
  openWorld?: boolean;
  handler: (args: z.infer<z.ZodObject<S>>, ctx: AppContext) => Promise<ToolOutput> | ToolOutput;
}

export interface WorkspaceToolDef<S extends z.ZodRawShape = z.ZodRawShape> extends Omit<
  ToolDef<S>,
  "scope" | "handler"
> {
  scope: "workspace";
  handler: (args: z.infer<z.ZodObject<S>>, ws: Workspace) => Promise<ToolOutput> | ToolOutput;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyToolDef = ToolDef<any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyWorkspaceToolDef = WorkspaceToolDef<any>;

export function defineTool<S extends z.ZodRawShape>(def: ToolDef<S>): ToolDef<S> {
  return def;
}

export function defineWorkspaceTool<S extends z.ZodRawShape>(
  def: Omit<WorkspaceToolDef<S>, "scope">,
): WorkspaceToolDef<S> {
  return { ...def, scope: "workspace" };
}

/** Optional on every project tool; falls back to the active project. */
export const projectArg = z
  .string()
  .min(1)
  .optional()
  .describe(
    "Client project (name or folder). Always pass it when working for a specific client; defaults to the active project.",
  );

/** Input schema exposed over MCP: project tools get the extra `project` argument. */
export function exposedSchema(def: AnyToolDef | AnyWorkspaceToolDef): z.ZodRawShape {
  return def.scope === "workspace" ? def.inputSchema : { ...def.inputSchema, project: projectArg };
}

function validationError(name: string, error: z.ZodError): CallToolResult {
  const issues = error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`);
  return textResult(
    { error: `Invalid input for ${name}`, type: "ValidationError", details: issues },
    true,
  );
}

function errorResult(name: string, err: unknown): CallToolResult {
  if (err instanceof AppError) logger.warn(`Tool ${name}: ${err.message}`);
  else logger.error(`Tool ${name} failed`, err);
  return textResult(toFriendlyError(err), true);
}

/**
 * Entry point used by the server: workspace tools get the workspace; project tools get the context of
 * `args.project` (or the active project), with the resolved project echoed in the result.
 */
export async function callToolInWorkspace(
  def: AnyToolDef | AnyWorkspaceToolDef,
  rawArgs: unknown,
  ws: Workspace,
): Promise<CallToolResult> {
  if (def.scope === "workspace") {
    const parsed = z.object(def.inputSchema).safeParse(rawArgs ?? {});
    if (!parsed.success) return validationError(def.name, parsed.error);
    try {
      return textResult(await def.handler(parsed.data, ws));
    } catch (err) {
      return errorResult(def.name, err);
    }
  }
  const { project, ...rest } = (rawArgs ?? {}) as Record<string, unknown>;
  if (project !== undefined && typeof project !== "string") {
    return textResult({ error: "project must be a string", type: "ValidationError" }, true);
  }
  let ctx: AppContext;
  try {
    ctx = ws.context(project);
  } catch (err) {
    return errorResult(def.name, err);
  }
  return callTool(def, rest, ctx);
}

export function textResult(value: unknown, isError = false): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    ...(isError ? { isError: true } : {}),
  };
}

/** Validates input, runs the handler in one project, and maps any error to a friendly `isError` result. */
export async function callTool(
  def: AnyToolDef,
  rawArgs: unknown,
  ctx: AppContext,
): Promise<CallToolResult> {
  const parsed = z.object(def.inputSchema).safeParse(rawArgs ?? {});
  if (!parsed.success) return validationError(def.name, parsed.error);
  try {
    const out = await def.handler(parsed.data, ctx);
    return textResult({ ...out, project: { name: ctx.project.name, slug: ctx.project.slug } });
  } catch (err) {
    return errorResult(def.name, err);
  }
}
