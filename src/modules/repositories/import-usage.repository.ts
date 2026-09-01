import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import { query } from "@aca/db";
import { PG_POOL } from "../../shared/infra.module";

/** Data access for `import_events` (SCOPE_LIMITS.md `QUOTA_IMPORTS_PER_MONTH`, RULES.md #18). */
@Injectable()
export class ImportUsageRepository {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async record(userId: string, repoId: string): Promise<void> {
    await query(this.pool, "INSERT INTO import_events (id, user_id, repo_id) VALUES ($1, $2, $3)", [
      randomUUID(),
      userId,
      repoId,
    ]);
  }

  /** Count of imports (fresh or reindex) this calendar month — checked before any downstream call, not after (API_ERROR_CODES.md "Quotas are checked before any paid downstream call"). */
  async countForUserThisMonth(userId: string): Promise<number> {
    const rows = await query<{ count: string }>(
      this.pool,
      "SELECT count(*)::text AS count FROM import_events WHERE user_id = $1 AND occurred_at >= date_trunc('month', now())",
      [userId]
    );
    return Number(rows[0]?.count ?? "0");
  }
}
