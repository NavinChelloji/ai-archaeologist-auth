import { randomBytes } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { AppError } from "@aca/contracts";
import { APP_CONFIG } from "../../config/config.module";
import type { ApiEnv } from "../../config/env";
import { EMAIL_SENDER, type EmailSender } from "../../shared/email/email-sender";
import { hashToken } from "../../shared/hash-token";
import { EmailVerificationTokensRepository } from "./email-verification-tokens.repository";
import { UsersRepository } from "./users.repository";

/** Email verification tokens: single-use, hashed at rest, expire (adr/0006-email-password-auth.md). */
@Injectable()
export class EmailVerificationService {
  constructor(
    private readonly tokens: EmailVerificationTokensRepository,
    private readonly users: UsersRepository,
    @Inject(EMAIL_SENDER) private readonly emailSender: EmailSender,
    @Inject(APP_CONFIG) private readonly config: ApiEnv
  ) {}

  async sendVerification(userId: string, email: string): Promise<void> {
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + this.config.EMAIL_VERIFICATION_TTL_SECONDS * 1000);
    await this.tokens.create(userId, hashToken(token), expiresAt);

    const verifyUrl = `${this.config.PUBLIC_APP_URL}/verify-email?token=${token}`;
    await this.emailSender.send({
      to: email,
      subject: "Verify your email",
      text: `Verify your email by visiting: ${verifyUrl}`,
    });
  }

  async verify(presentedToken: string): Promise<void> {
    const row = await this.tokens.findByTokenHash(hashToken(presentedToken));
    if (!row || row.consumed_at || row.expires_at.getTime() < Date.now()) {
      throw new AppError("AUTH_EMAIL_VERIFICATION_INVALID", "This verification link is invalid or has expired.");
    }

    await this.tokens.consume(row.id);
    await this.users.markEmailVerified(row.user_id);
  }
}
