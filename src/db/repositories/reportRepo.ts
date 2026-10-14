import type { DB } from "../client.js";

export interface ReportRow {
  id: number;
  date: string;
  type: string;
  title: string;
  file_path: string;
  created_at: string;
}

export class ReportRepo {
  constructor(private readonly db: DB) {}

  /** One report per (date, type): saving again the same day replaces the row. */
  upsert(r: Omit<ReportRow, "id" | "created_at">): ReportRow {
    const existing = this.db
      .prepare("SELECT id FROM reports WHERE date = ? AND type = ?")
      .get(r.date, r.type) as { id: number } | undefined;
    const now = new Date().toISOString();
    if (existing) {
      this.db
        .prepare("UPDATE reports SET title = ?, file_path = ?, created_at = ? WHERE id = ?")
        .run(r.title, r.file_path, now, existing.id);
      return this.get(existing.id)!;
    }
    const info = this.db
      .prepare(
        "INSERT INTO reports (date, type, title, file_path, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(r.date, r.type, r.title, r.file_path, now);
    return this.get(Number(info.lastInsertRowid))!;
  }

  get(id: number): ReportRow | null {
    return (
      (this.db.prepare("SELECT * FROM reports WHERE id = ?").get(id) as ReportRow | undefined) ??
      null
    );
  }

  find(date: string, type: string): ReportRow | null {
    return (
      (this.db.prepare("SELECT * FROM reports WHERE date = ? AND type = ?").get(date, type) as
        ReportRow | undefined) ?? null
    );
  }

  list(
    filters: { type?: string; since?: string; until?: string; limit?: number } = {},
  ): ReportRow[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filters.type) {
      where.push("type = ?");
      params.push(filters.type);
    }
    if (filters.since) {
      where.push("date >= ?");
      params.push(filters.since);
    }
    if (filters.until) {
      where.push("date <= ?");
      params.push(filters.until);
    }
    const sql = `SELECT * FROM reports ${where.length ? "WHERE " + where.join(" AND ") : ""}
                 ORDER BY date DESC, id DESC LIMIT ?`;
    return this.db.prepare(sql).all(...params, filters.limit ?? 20) as ReportRow[];
  }
}
