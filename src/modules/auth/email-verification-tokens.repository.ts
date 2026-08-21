import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import { query } from "@aca/db";
import { PG_POOL } from "../../shared/infra.module";

export interface EmailVerificationTokenRow {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: Date;
  consumed_at: Date | null;
  created_at: Date;
}

@Injectable()
export class EmailVerificationTokensRepository {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async create(userId: string, tokenHash: string, expiresAt: Date): Promise<void> {
    await query(
      this.pool,
      "INSERT INTO email_verification_tokens (id, user_id, token_hash, expires_at) VALUES ($1,$2,$3,$4)",
      [randomUUID(), userId, tokenHash, expiresAt]
    );
  }

  async findByTokenHash(tokenHash: string): Promise<EmailVerificationTokenRow | null> {
    const rows = await query<EmailVerificationTokenRow>(
      this.pool,
      "SELECT * FROM email_verification_tokens WHERE token_hash = $1",
      [tokenHash]
    );
    return rows[0] ?? null;
  }

  async consume(id: string): Promise<void> {
    await query(this.pool, "UPDATE email_verification_tokens SET consumed_at = now() WHERE id = $1", [id]);
  }
}
