import { Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { AppError } from "@aca/contracts";
import { parseCookies } from "../../shared/cookies";
import { hashToken } from "../../shared/hash-token";
import { type RequestWithUser } from "./access-token.guard";
import { REFRESH_COOKIE_NAME } from "./auth.constants";
import { RefreshSessionsRepository } from "./refresh-sessions.repository";

/**
 * Identifies the caller from the `HttpOnly` refresh cookie rather than a
 * Bearer header — needed for `github/link/start`, which is a top-level
 * browser navigation (an `<a href>`, like the sign-in button), so there's no
 * fetch call to attach an `Authorization` header to
 * (AUTH_SERVICE_PLAN.md "GitHub linking vs. sign-in"). Read-only: looks the
 * session up without rotating it.
 */
@Injectable()
export class RefreshCookieAuthGuard implements CanActivate {
  constructor(private readonly sessions: RefreshSessionsRepository) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const presented = parseCookies(request.headers.cookie)[REFRESH_COOKIE_NAME];
    if (!presented) {
      throw new AppError("AUTH_REQUIRED", "Sign in to continue.");
    }

    const session = await this.sessions.findByTokenHash(hashToken(presented));
    if (!session || session.revoked_at || session.expires_at.getTime() < Date.now()) {
      throw new AppError("AUTH_REQUIRED", "Sign in to continue.");
    }

    request.userId = session.user_id;
    return true;
  }
}
