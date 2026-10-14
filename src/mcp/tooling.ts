import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { AppError, toFriendlyError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

/** Every tool result starts with a one-line human summary; the rest is structured data. */
export interface ToolOutput {
  summary: string;
  [key: string]: unknown;
}

export interface ToolDef<S extends z.ZodRawShape = z.ZodRawShape> {
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyToolDef = ToolDef<any>;

export function defineTool<S extends z.ZodRawShape>(def: ToolDef<S>): ToolDef<S> {
  return def;
}

export function textResult(value: unknown, isError = false): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    ...(isError ? { isError: true } : {}),
  };
}

/** Validates input, runs the handler, and maps any error to a friendly `isError` result. */
export async function callTool(
  def: AnyToolDef,
  rawArgs: unknown,
  ctx: AppContext,
): Promise<CallToolResult> {
  const parsed = z.object(def.inputSchema).safeParse(rawArgs ?? {});
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`);
    return textResult(
      { error: `Invalid input for ${def.name}`, type: "ValidationError", details: issues },
      true,
    );
  }
  try {
    const out = await def.handler(parsed.data, ctx);
    return textResult(out);
  } catch (err) {
    if (err instanceof AppError) logger.warn(`Tool ${def.name}: ${err.message}`);
    else logger.error(`Tool ${def.name} failed`, err);
    return textResult(toFriendlyError(err), true);
  }
}
