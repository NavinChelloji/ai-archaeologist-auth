import { Inject, Injectable } from "@nestjs/common";
import { AppError } from "@aca/contracts";
import { APP_CONFIG } from "../../config/config.module";
import type { ApiEnv } from "../../config/env";
import { AccessTokenService } from "./access-token.service";
import { EmailVerificationService } from "./email-verification.service";
import { PasswordHashService } from "./password-hash.service";
import { RefreshSessionService, type RequestContext } from "./refresh-session.service";
import { UsersRepository, type UserRow } from "./users.repository";

export interface SessionResult {
  user: UserRow;
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresAt: Date;
}

/** Email/password as a second, independent identity method alongside GitHub OAuth (adr/0006-email-password-auth.md). */
@Injectable()
export class PasswordAuthService {
  constructor(
    private readonly users: UsersRepository,
    private readonly passwordHash: PasswordHashService,
    private readonly emailVerification: EmailVerificationService,
    private readonly refreshSessions: RefreshSessionService,
    private readonly accessTokens: AccessTokenService,
    @Inject(APP_CONFIG) private readonly config: ApiEnv
  ) {}

  /** Signs the new user in immediately — email verification gates nothing here, it just flips `emailVerified` for the UI to show a banner. */
  async signup(email: string, password: string, context: RequestContext): Promise<SessionResult> {
    const existing = await this.users.findByEmail(email);
    if (existing) {
      throw new AppError("AUTH_EMAIL_ALREADY_REGISTERED", "An account with this email already exists.");
    }

    const passwordHash = await this.passwordHash.hash(password);
    const user = await this.users.createWithPassword({ email, passwordHash });
    await this.emailVerification.sendVerification(user.id, email);

    const issuedRefresh = await this.refreshSessions.issue(user.id, context);
    const access = this.accessTokens.issue(user.id);

    return {
      user,
      accessToken: access.token,
      expiresIn: access.expiresIn,
      refreshToken: issuedRefresh.token,
      refreshExpiresAt: issuedRefresh.expiresAt,
    };
  }

  async login(email: string, password: string, context: RequestContext): Promise<SessionResult> {
    const user = await this.users.findByEmail(email);

    // A user with no password_hash (GitHub-only) can't log in with a
    // password by definition — same generic error as "email not found", so
    // neither response leaks which is true.
    if (!user || !user.password_hash) {
      throw new AppError("AUTH_INVALID_CREDENTIALS", "Incorrect email or password.");
    }

    if (user.locked_until && user.locked_until.getTime() > Date.now()) {
      const retryAfterSeconds = Math.ceil((user.locked_until.getTime() - Date.now()) / 1000);
      throw new AppError("AUTH_ACCOUNT_LOCKED", "Too many failed attempts. Please try again later.", {
        details: { retryAfterSeconds },
      });
    }

    const valid = await this.passwordHash.verify(user.password_hash, password);
    if (!valid) {
      await this.recordFailedLogin(user);
      throw new AppError("AUTH_INVALID_CREDENTIALS", "Incorrect email or password.");
    }

    await this.users.resetFailedLoginAttempts(user.id);

    const issuedRefresh = await this.refreshSessions.issue(user.id, context);
    const access = this.accessTokens.issue(user.id);

    return {
      user,
      accessToken: access.token,
      expiresIn: access.expiresIn,
      refreshToken: issuedRefresh.token,
      refreshExpiresAt: issuedRefresh.expiresAt,
    };
  }

  private async recordFailedLogin(user: UserRow): Promise<void> {
    const updated = await this.users.incrementFailedLoginAttempts(user.id);
    if (updated.failed_login_attempts >= this.config.LOGIN_LOCKOUT_THRESHOLD) {
      await this.users.lockUntil(user.id, new Date(Date.now() + this.config.LOGIN_LOCKOUT_DURATION_SECONDS * 1000));
    }
  }
}
