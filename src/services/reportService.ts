import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { AppContext } from "../context.js";
import type { ReportRow } from "../db/repositories/reportRepo.js";
import { NotFoundError } from "../utils/errors.js";

export const REPORT_TYPE_PATTERN = /^[a-z0-9_]{1,40}$/;

export class ReportService {
  constructor(private readonly ctx: AppContext) {}

  /** Writes projects/<project>/reports/YYYY-MM-DD-<type>.md (same day + type overwrites) and records it in the DB. */
  save(type: string, title: string, markdown: string) {
    const date = this.ctx.today();
    mkdirSync(this.ctx.paths.reports, { recursive: true });
    const filePath = join(this.ctx.paths.reports, `${date}-${type}.md`);
    const replaced = existsSync(filePath);
    const body = /^#\s/.test(markdown.trimStart()) ? markdown : `# ${title}\n\n${markdown}`;
    writeFileSync(filePath, body.endsWith("\n") ? body : body + "\n", "utf8");
    const row = this.ctx.repos.reports.upsert({ date, type, title, file_path: filePath });
    return {
      summary: `${replaced ? "Updated" : "Saved"} ${type} report for ${date} → ${relative(this.ctx.paths.dataDir, filePath)}.`,
      report: this.describe(row),
      replaced_existing: replaced,
    };
  }

  list(filters: { type?: string; since?: string; until?: string; limit?: number }) {
    const rows = this.ctx.repos.reports.list(filters);
    return {
      summary: rows.length
        ? `${rows.length} report(s), newest ${rows[0]!.date}.`
        : "No saved reports yet.",
      reports: rows.map((r) => this.describe(r)),
    };
  }

  get(opts: { id?: number; date?: string; type?: string }) {
    let row: ReportRow | null;
    if (opts.id !== undefined) row = this.ctx.repos.reports.get(opts.id);
    else if (opts.date && opts.type) row = this.ctx.repos.reports.find(opts.date, opts.type);
    else
      row = this.ctx.repos.reports.list({ type: opts.type, until: opts.date, limit: 1 })[0] ?? null;
    if (!row)
      throw new NotFoundError("Report not found.", "Use list_reports to see saved reports.");
    if (!existsSync(row.file_path)) {
      throw new NotFoundError(
        `The report file ${row.file_path} no longer exists.`,
        "It may have been moved or deleted from projects/<project>/reports/.",
      );
    }
    return {
      summary: `${row.type} report "${row.title}" from ${row.date}.`,
      report: this.describe(row),
      markdown: readFileSync(row.file_path, "utf8"),
    };
  }

  latestMarkdown(type = "daily_briefing"): { row: ReportRow; markdown: string } | null {
    const row = this.ctx.repos.reports.list({ type, limit: 1 })[0];
    if (!row || !existsSync(row.file_path)) return null;
    return { row, markdown: readFileSync(row.file_path, "utf8") };
  }

  private describe(r: ReportRow) {
    return {
      id: r.id,
      date: r.date,
      type: r.type,
      title: r.title,
      file: relative(this.ctx.paths.dataDir, r.file_path),
      saved_at: r.created_at,
    };
  }
}
