import { Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { AppError } from "@aca/contracts";
import { AccessTokenService } from "../auth/access-token.service";
import type { RequestWithUser } from "../auth/access-token.guard";

const BEARER_PREFIX = "Bearer ";

/**
 * Same access-token check as `AccessTokenGuard`, but also accepts the token
 * as an `access_token` query parameter — the browser's `EventSource` API
 * cannot set an `Authorization` header, so the SSE route is the one place
 * this app's already-client-visible access token (never the refresh token)
 * travels a second way. Scoped to this single route on purpose: every other
 * endpoint keeps requiring the header so tokens don't end up in ordinary
 * access logs.
 */
@Injectable()
export class SseAuthGuard implements CanActivate {
  constructor(private readonly accessTokens: AccessTokenService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const header = request.headers["authorization"];
    const query = request.query as Record<string, unknown> | undefined;

    const token = header?.startsWith(BEARER_PREFIX)
      ? header.slice(BEARER_PREFIX.length)
      : typeof query?.access_token === "string"
        ? query.access_token
        : undefined;

    if (!token) {
      throw new AppError("AUTH_REQUIRED", "Sign in to continue.");
    }

    const claims = this.accessTokens.verify(token);
    request.userId = claims.userId;
    return true;
  }
}
