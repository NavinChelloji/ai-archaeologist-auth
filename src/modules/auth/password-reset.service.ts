import { randomBytes } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { AppError } from "@aca/contracts";
import { APP_CONFIG } from "../../config/config.module";
import type { ApiEnv } from "../../config/env";
import { EMAIL_SENDER, type EmailSender } from "../../shared/email/email-sender";
import { hashToken } from "../../shared/hash-token";
import { PasswordHashService } from "./password-hash.service";
import { PasswordResetTokensRepository } from "./password-reset-tokens.repository";
import { RefreshSessionsRepository } from "./refresh-sessions.repository";
import { UsersRepository } from "./users.repository";

/** Password reset tokens: single-use, hashed at rest, expire (adr/0006-email-password-auth.md). */
@Injectable()
export class PasswordResetService {
  constructor(
    private readonly tokens: PasswordResetTokensRepository,
    private readonly users: UsersRepository,
    private readonly refreshSessions: RefreshSessionsRepository,
    private readonly passwordHash: PasswordHashService,
    @Inject(EMAIL_SENDER) private readonly emailSender: EmailSender,
    @Inject(APP_CONFIG) private readonly config: ApiEnv
  ) {}

  /** Always succeeds from the caller's perspective, whether or not the email is registered (AUTH_SERVICE_PLAN.md "Security" — not an enumeration oracle). */
  async requestReset(email: string): Promise<void> {
    const user = await this.users.findByEmail(email);
    if (!user) return;

    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + this.config.PASSWORD_RESET_TTL_SECONDS * 1000);
    await this.tokens.create(user.id, hashToken(token), expiresAt);

    const resetUrl = `${this.config.PUBLIC_APP_URL}/reset-password?token=${token}`;
    await this.emailSender.send({
      to: email,
      subject: "Reset your password",
      text: `Reset your password by visiting: ${resetUrl}`,
    });
  }

  async reset(presentedToken: string, newPassword: string): Promise<void> {
    const row = await this.tokens.findByTokenHash(hashToken(presentedToken));
    if (!row || row.consumed_at || row.expires_at.getTime() < Date.now()) {
      throw new AppError("AUTH_PASSWORD_RESET_INVALID", "This password reset link is invalid or has expired.");
    }

    const newHash = await this.passwordHash.hash(newPassword);
    await this.tokens.consume(row.id);
    await this.users.updatePasswordHash(row.user_id, newHash);
    // A password reset is a strong signal of possible compromise — force re-authentication everywhere.
    await this.refreshSessions.revokeAllForUser(row.user_id);
  }
}
