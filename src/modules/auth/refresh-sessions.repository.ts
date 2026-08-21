import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import { query } from "@aca/db";
import { PG_POOL } from "../../shared/infra.module";

export interface RefreshSessionRow {
  id: string;
  user_id: string;
  token_hash: string;
  parent_id: string | null;
  user_agent: string | null;
  ip_hash: string | null;
  expires_at: Date;
  revoked_at: Date | null;
  created_at: Date;
}

export interface CreateRefreshSessionInput {
  userId: string;
  tokenHash: string;
  parentId: string | null;
  userAgent: string | null;
  ipHash: string | null;
  expiresAt: Date;
}

@Injectable()
export class RefreshSessionsRepository {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async create(input: CreateRefreshSessionInput): Promise<RefreshSessionRow> {
    const rows = await query<RefreshSessionRow>(
      this.pool,
      `INSERT INTO refresh_sessions (id, user_id, token_hash, parent_id, user_agent, ip_hash, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [randomUUID(), input.userId, input.tokenHash, input.parentId, input.userAgent, input.ipHash, input.expiresAt]
    );
    // INSERT ... RETURNING always yields exactly one row.
    return rows[0]!;
  }

  async findByTokenHash(tokenHash: string): Promise<RefreshSessionRow | null> {
    const rows = await query<RefreshSessionRow>(this.pool, "SELECT * FROM refresh_sessions WHERE token_hash = $1", [
      tokenHash,
    ]);
    return rows[0] ?? null;
  }

  async revoke(id: string): Promise<void> {
    await query(this.pool, "UPDATE refresh_sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL", [
      id,
    ]);
  }

  /**
   * Revokes every active session for a user. Used both for logout-everywhere
   * and, more importantly, when a rotated (revoked) refresh token is
   * presented again — a sign it may have been stolen. Rather than trying to
   * scope revocation precisely to "the chain" that leaked (AUTH_SERVICE_PLAN.md's
   * language), which requires trusting a graph walk from a token that has
   * already proven untrustworthy, this revokes all of the user's sessions:
   * a strictly safer superset that forces full re-authentication.
   */
  async revokeAllForUser(userId: string): Promise<void> {
    await query(this.pool, "UPDATE refresh_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [
      userId,
    ]);
  }
}
