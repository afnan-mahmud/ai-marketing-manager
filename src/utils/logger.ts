/**
 * stderr-only logger. The MCP stdio transport owns stdout, so nothing else may write there.
 */
type Level = "debug" | "info" | "warn" | "error";

const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
let minLevel: Level =
  (process.env.LOG_LEVEL as Level) in order ? (process.env.LOG_LEVEL as Level) : "info";

/** Removes access tokens from any string (URLs, error messages). */
export function redact(text: string): string {
  return text
    .replace(/(access_token=)[^&\s"']+/gi, "$1[REDACTED]")
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/g, "$1[REDACTED]");
}

function write(level: Level, msg: string, extra?: unknown): void {
  if (order[level] < order[minLevel]) return;
  let line = `[${new Date().toISOString()}] ${level.toUpperCase()} ${msg}`;
  if (extra !== undefined) {
    const detail =
      extra instanceof Error ? (extra.stack ?? extra.message) : JSON.stringify(extra, null, 0);
    line += ` ${detail}`;
  }
  process.stderr.write(redact(line) + "\n");
}

export const logger = {
  setLevel(level: Level) {
    minLevel = level;
  },
  debug: (msg: string, extra?: unknown) => write("debug", msg, extra),
  info: (msg: string, extra?: unknown) => write("info", msg, extra),
  warn: (msg: string, extra?: unknown) => write("warn", msg, extra),
  error: (msg: string, extra?: unknown) => write("error", msg, extra),
};
