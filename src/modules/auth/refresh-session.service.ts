import { randomBytes } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { AppError } from "@aca/contracts";
import type { Logger } from "@aca/logger";
import { APP_CONFIG } from "../../config/config.module";
import type { ApiEnv } from "../../config/env";
import { hashToken } from "../../shared/hash-token";
import { APP_LOGGER } from "../../shared/infra.module";
import { RefreshSessionsRepository } from "./refresh-sessions.repository";

export interface RequestContext {
  userAgent: string | null;
  ipHash: string | null;
}

export interface IssuedRefreshToken {
  token: string;
  expiresAt: Date;
}

export interface RotatedRefreshToken extends IssuedRefreshToken {
  userId: string;
}

/** Rotating, hashed refresh tokens with reuse detection (AUTH_SERVICE_PLAN.md). */
@Injectable()
export class RefreshSessionService {
  constructor(
    private readonly sessions: RefreshSessionsRepository,
    @Inject(APP_CONFIG) private readonly config: ApiEnv,
    @Inject(APP_LOGGER) private readonly logger: Logger
  ) {}

  async issue(userId: string, context: RequestContext): Promise<IssuedRefreshToken> {
    const token = randomBytes(48).toString("base64url");
    const expiresAt = new Date(Date.now() + this.config.REFRESH_TOKEN_TTL_SECONDS * 1000);

    await this.sessions.create({
      userId,
      tokenHash: hashToken(token),
      parentId: null,
      userAgent: context.userAgent,
      ipHash: context.ipHash,
      expiresAt,
    });

    return { token, expiresAt };
  }

  /**
   * Verifies and rotates a presented refresh token. A revoked (already
   * rotated) token being presented again means it may have leaked; the
   * response is to revoke every session for that user (see
   * RefreshSessionsRepository.revokeAllForUser for why that, not a scoped
   * chain revoke) and reject.
   */
  async rotate(presentedToken: string, context: RequestContext): Promise<RotatedRefreshToken> {
    const session = await this.sessions.findByTokenHash(hashToken(presentedToken));

    if (!session) {
      throw new AppError("AUTH_REFRESH_INVALID", "Your session is no longer valid. Please sign in again.");
    }

    if (session.revoked_at) {
      this.logger.warn(
        { userId: session.user_id, sessionId: session.id },
        "refresh token reuse detected — revoking all sessions for user"
      );
      await this.sessions.revokeAllForUser(session.user_id);
      throw new AppError("AUTH_SESSION_REVOKED", "Your session was revoked for security. Please sign in again.");
    }

    if (session.expires_at.getTime() < Date.now()) {
      throw new AppError("AUTH_REFRESH_INVALID", "Your session has expired. Please sign in again.");
    }

    await this.sessions.revoke(session.id);

    const nextToken = randomBytes(48).toString("base64url");
    const expiresAt = new Date(Date.now() + this.config.REFRESH_TOKEN_TTL_SECONDS * 1000);

    await this.sessions.create({
      userId: session.user_id,
      tokenHash: hashToken(nextToken),
      parentId: session.id,
      userAgent: context.userAgent,
      ipHash: context.ipHash,
      expiresAt,
    });

    return { token: nextToken, expiresAt, userId: session.user_id };
  }

  async revoke(presentedToken: string): Promise<void> {
    const session = await this.sessions.findByTokenHash(hashToken(presentedToken));
    if (session) {
      await this.sessions.revoke(session.id);
    }
  }
}
