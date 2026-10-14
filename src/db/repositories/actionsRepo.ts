import type { DB } from "../client.js";

export type ActionStatus =
  "pending" | "executing" | "processing" | "executed" | "failed" | "cancelled" | "expired";
export type ActionType = "new_ad" | "status_change" | "budget_change" | "duplicate";

export interface AdAction {
  id: string;
  type: ActionType;
  status: ActionStatus;
  summary: string;
  params: Record<string, unknown>;
  preview: Record<string, unknown>;
  created_at: string;
  expires_at: string;
  decided_at: string | null;
  confirmed_via: string | null;
  result: Record<string, unknown> | null;
  error: string | null;
}

interface Row {
  id: string;
  type: ActionType;
  status: ActionStatus;
  summary: string;
  params_json: string;
  preview_json: string;
  created_at: string;
  expires_at: string;
  decided_at: string | null;
  confirmed_via: string | null;
  result_json: string | null;
  error: string | null;
}

const toAction = (r: Row): AdAction => ({
  id: r.id,
  type: r.type,
  status: r.status,
  summary: r.summary,
  params: JSON.parse(r.params_json),
  preview: JSON.parse(r.preview_json),
  created_at: r.created_at,
  expires_at: r.expires_at,
  decided_at: r.decided_at,
  confirmed_via: r.confirmed_via,
  result: r.result_json ? JSON.parse(r.result_json) : null,
  error: r.error,
});

/** Audit log + state machine for Meta changes (proposed → confirmed → executed). */
export class ActionsRepo {
  constructor(private readonly db: DB) {}

  insert(
    a: Pick<
      AdAction,
      "id" | "type" | "summary" | "params" | "preview" | "created_at" | "expires_at"
    >,
  ): AdAction {
    this.db
      .prepare(
        `INSERT INTO ad_actions (id, type, status, summary, params_json, preview_json, created_at, expires_at)
         VALUES (?, ?, 'pending', ?, ?, ?, ?, ?)`,
      )
      .run(
        a.id,
        a.type,
        a.summary,
        JSON.stringify(a.params),
        JSON.stringify(a.preview),
        a.created_at,
        a.expires_at,
      );
    return this.get(a.id)!;
  }

  get(id: string): AdAction | null {
    const r = this.db.prepare("SELECT * FROM ad_actions WHERE id = ? COLLATE NOCASE").get(id) as
      Row | undefined;
    return r ? toAction(r) : null;
  }

  list(opts: { status?: ActionStatus; limit?: number } = {}): AdAction[] {
    const rows = (
      opts.status
        ? this.db
            .prepare("SELECT * FROM ad_actions WHERE status = ? ORDER BY created_at DESC LIMIT ?")
            .all(opts.status, opts.limit ?? 50)
        : this.db
            .prepare("SELECT * FROM ad_actions ORDER BY created_at DESC LIMIT ?")
            .all(opts.limit ?? 50)
    ) as Row[];
    return rows.map(toAction);
  }

  update(
    id: string,
    patch: Partial<Pick<AdAction, "status" | "decided_at" | "confirmed_via" | "result" | "error">>,
  ): AdAction {
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      sets.push(`${k === "result" ? "result_json" : k} = ?`);
      vals.push(k === "result" ? JSON.stringify(v) : v);
    }
    if (sets.length)
      this.db.prepare(`UPDATE ad_actions SET ${sets.join(", ")} WHERE id = ?`).run(...vals, id);
    return this.get(id)!;
  }

  /** Marks pending actions past their expiry as expired. */
  expire(nowIso: string): void {
    this.db
      .prepare(
        "UPDATE ad_actions SET status = 'expired' WHERE status = 'pending' AND expires_at < ?",
      )
      .run(nowIso);
  }
}
