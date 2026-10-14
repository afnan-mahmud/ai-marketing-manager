import type { Confidence, LearningCategory, LearningKind } from "../../analytics/memory.js";
import type { DB } from "../client.js";

export interface LearningEvent {
  at: string;
  event: "created" | "confirmed" | "contradicted" | "edited" | "retired" | "reactivated";
  note?: string;
}

export interface Learning {
  id: number;
  kind: LearningKind;
  category: LearningCategory;
  statement: string;
  evidence: string | null;
  source: string;
  confidence: Confidence;
  confirmations: number;
  contradictions: number;
  status: "active" | "retired";
  tags: string[];
  related: string[];
  history: LearningEvent[];
  created_at: string;
  updated_at: string;
  last_confirmed_at: string;
}

interface Row extends Omit<Learning, "tags" | "related" | "history"> {
  tags_json: string;
  related_json: string;
  history_json: string;
}

const toLearning = ({ tags_json, related_json, history_json, ...r }: Row): Learning => ({
  ...r,
  tags: JSON.parse(tags_json),
  related: JSON.parse(related_json),
  history: JSON.parse(history_json),
});

export class MemoryRepo {
  constructor(private readonly db: DB) {}

  insert(
    l: Omit<
      Learning,
      "id" | "confirmations" | "contradictions" | "status" | "updated_at" | "last_confirmed_at"
    >,
  ): Learning {
    const info = this.db
      .prepare(
        `INSERT INTO learnings (kind, category, statement, evidence, source, confidence, tags_json, related_json, history_json,
           created_at, updated_at, last_confirmed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        l.kind,
        l.category,
        l.statement,
        l.evidence,
        l.source,
        l.confidence,
        JSON.stringify(l.tags),
        JSON.stringify(l.related),
        JSON.stringify(l.history),
        l.created_at,
        l.created_at,
        l.created_at,
      );
    return this.get(Number(info.lastInsertRowid))!;
  }

  get(id: number): Learning | null {
    const r = this.db.prepare("SELECT * FROM learnings WHERE id = ?").get(id) as Row | undefined;
    return r ? toLearning(r) : null;
  }

  list(opts: { includeRetired?: boolean } = {}): Learning[] {
    const rows = (
      opts.includeRetired
        ? this.db.prepare("SELECT * FROM learnings ORDER BY id").all()
        : this.db.prepare("SELECT * FROM learnings WHERE status = 'active' ORDER BY id").all()
    ) as Row[];
    return rows.map(toLearning);
  }

  update(id: number, patch: Partial<Omit<Learning, "id" | "created_at">>): Learning {
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      if (k === "tags" || k === "related" || k === "history") {
        sets.push(`${k}_json = ?`);
        vals.push(JSON.stringify(v));
      } else {
        sets.push(`${k} = ?`);
        vals.push(v);
      }
    }
    if (sets.length)
      this.db.prepare(`UPDATE learnings SET ${sets.join(", ")} WHERE id = ?`).run(...vals, id);
    return this.get(id)!;
  }
}
