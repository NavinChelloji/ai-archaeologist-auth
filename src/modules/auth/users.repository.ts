import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import { query } from "@aca/db";
import { PG_POOL } from "../../shared/infra.module";

export interface UserRow {
  id: string;
  github_user_id: string | null;
  github_login: string | null;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  encrypted_access_token: string | null;
  encrypted_refresh_token: string | null;
  token_expires_at: Date | null;
  key_version: number;
  github_scopes: string[];
  disconnected_at: Date | null;
  password_hash: string | null;
  email_verified_at: Date | null;
  failed_login_attempts: number;
  locked_until: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface UpsertUserInput {
  githubUserId: string;
  githubLogin: string;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  encryptedAccessToken: string;
  encryptedRefreshToken: string | null;
  tokenExpiresAt: Date | null;
  keyVersion: number;
  githubScopes: string[];
}

export interface UpdateEncryptedTokensInput {
  encryptedAccessToken: string;
  encryptedRefreshToken: string | null;
  tokenExpiresAt: Date | null;
  keyVersion: number;
}

export interface CreateWithPasswordInput {
  email: string;
  passwordHash: string;
}

export interface AttachGithubIdentityInput {
  githubUserId: string;
  githubLogin: string;
  avatarUrl: string | null;
  encryptedAccessToken: string;
  encryptedRefreshToken: string | null;
  tokenExpiresAt: Date | null;
  keyVersion: number;
  githubScopes: string[];
}

/** Data access for `users` (AUTH_SERVICE_PLAN.md / adr/0006-email-password-auth.md). */
@Injectable()
export class UsersRepository {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** Sign-in is idempotent per GitHub account: re-authenticating updates the row rather than creating a duplicate. */
  async upsertByGithubUserId(input: UpsertUserInput): Promise<UserRow> {
    const rows = await query<UserRow>(
      this.pool,
      `INSERT INTO users (
         id, github_user_id, github_login, email, display_name, avatar_url,
         encrypted_access_token, encrypted_refresh_token, token_expires_at,
         key_version, github_scopes, disconnected_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NULL,now())
       ON CONFLICT (github_user_id) DO UPDATE SET
         github_login = EXCLUDED.github_login,
         email = EXCLUDED.email,
         display_name = EXCLUDED.display_name,
         avatar_url = EXCLUDED.avatar_url,
         encrypted_access_token = EXCLUDED.encrypted_access_token,
         encrypted_refresh_token = EXCLUDED.encrypted_refresh_token,
         token_expires_at = EXCLUDED.token_expires_at,
         key_version = EXCLUDED.key_version,
         github_scopes = EXCLUDED.github_scopes,
         disconnected_at = NULL,
         updated_at = now()
       RETURNING *`,
      [
        randomUUID(),
        input.githubUserId,
        input.githubLogin,
        input.email,
        input.displayName,
        input.avatarUrl,
        input.encryptedAccessToken,
        input.encryptedRefreshToken,
        input.tokenExpiresAt,
        input.keyVersion,
        input.githubScopes,
      ]
    );
    // INSERT ... ON CONFLICT DO UPDATE ... RETURNING always yields exactly one row.
    return rows[0]!;
  }

  async findById(userId: string): Promise<UserRow | null> {
    const rows = await query<UserRow>(this.pool, "SELECT * FROM users WHERE id = $1", [userId]);
    return rows[0] ?? null;
  }

  async findByEmail(email: string): Promise<UserRow | null> {
    const rows = await query<UserRow>(this.pool, "SELECT * FROM users WHERE email = $1", [email]);
    return rows[0] ?? null;
  }

  async findByGithubUserId(githubUserId: string): Promise<UserRow | null> {
    const rows = await query<UserRow>(this.pool, "SELECT * FROM users WHERE github_user_id = $1", [githubUserId]);
    return rows[0] ?? null;
  }

  /** `POST /auth/signup` — a fresh account with no GitHub connection yet (adr/0006-email-password-auth.md). */
  async createWithPassword(input: CreateWithPasswordInput): Promise<UserRow> {
    const rows = await query<UserRow>(
      this.pool,
      `INSERT INTO users (id, email, password_hash, updated_at) VALUES ($1,$2,$3,now()) RETURNING *`,
      [randomUUID(), input.email, input.passwordHash]
    );
    // INSERT ... RETURNING always yields exactly one row.
    return rows[0]!;
  }

  /** Used by `POST /internal/github/token` after a transparent refresh. */
  async updateEncryptedTokens(userId: string, fields: UpdateEncryptedTokensInput): Promise<void> {
    await query(
      this.pool,
      `UPDATE users
       SET encrypted_access_token = $2, encrypted_refresh_token = $3,
           token_expires_at = $4, key_version = $5, updated_at = now()
       WHERE id = $1`,
      [userId, fields.encryptedAccessToken, fields.encryptedRefreshToken, fields.tokenExpiresAt, fields.keyVersion]
    );
  }

  async updatePasswordHash(userId: string, passwordHash: string): Promise<void> {
    await query(this.pool, "UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1", [
      userId,
      passwordHash,
    ]);
  }

  async markEmailVerified(userId: string): Promise<void> {
    await query(this.pool, "UPDATE users SET email_verified_at = now(), updated_at = now() WHERE id = $1", [
      userId,
    ]);
  }

  /** Returns the updated row so the caller can decide whether the new count crosses the lockout threshold. */
  async incrementFailedLoginAttempts(userId: string): Promise<UserRow> {
    const rows = await query<UserRow>(
      this.pool,
      "UPDATE users SET failed_login_attempts = failed_login_attempts + 1, updated_at = now() WHERE id = $1 RETURNING *",
      [userId]
    );
    // UPDATE ... RETURNING on an id known to exist always yields exactly one row.
    return rows[0]!;
  }

  async lockUntil(userId: string, until: Date): Promise<void> {
    await query(this.pool, "UPDATE users SET locked_until = $2, updated_at = now() WHERE id = $1", [
      userId,
      until,
    ]);
  }

  async resetFailedLoginAttempts(userId: string): Promise<void> {
    await query(
      this.pool,
      "UPDATE users SET failed_login_attempts = 0, locked_until = NULL, updated_at = now() WHERE id = $1",
      [userId]
    );
  }

  /** `github/link/callback` — attaches a GitHub identity to an already-authenticated user (never creates a row). */
  async attachGithubIdentity(userId: string, input: AttachGithubIdentityInput): Promise<UserRow> {
    const rows = await query<UserRow>(
      this.pool,
      `UPDATE users
       SET github_user_id = $2, github_login = $3, avatar_url = COALESCE(avatar_url, $4),
           encrypted_access_token = $5, encrypted_refresh_token = $6, token_expires_at = $7,
           key_version = $8, github_scopes = $9, disconnected_at = NULL, updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [
        userId,
        input.githubUserId,
        input.githubLogin,
        input.avatarUrl,
        input.encryptedAccessToken,
        input.encryptedRefreshToken,
        input.tokenExpiresAt,
        input.keyVersion,
        input.githubScopes,
      ]
    );
    // UPDATE ... RETURNING on an id known to exist always yields exactly one row.
    return rows[0]!;
  }

  /** `POST /auth/github/unlink` — clears the GitHub identity, leaving the row's other identity method (password) untouched. */
  async detachGithubIdentity(userId: string): Promise<void> {
    await query(
      this.pool,
      `UPDATE users
       SET github_user_id = NULL, github_login = NULL, encrypted_access_token = NULL,
           encrypted_refresh_token = NULL, token_expires_at = NULL, github_scopes = '{}',
           disconnected_at = now(), updated_at = now()
       WHERE id = $1`,
      [userId]
    );
  }

  /** Account deletion — publishes `user.deleted` at the call site, not here (RULES.md keeps DB access and messaging separate). */
  async delete(userId: string): Promise<void> {
    await query(this.pool, "DELETE FROM users WHERE id = $1", [userId]);
  }
}
