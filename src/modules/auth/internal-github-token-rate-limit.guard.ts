import { Inject, Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { AppError } from "@aca/contracts";
import { APP_CONFIG } from "../../config/config.module";
import type { ApiEnv } from "../../config/env";
import type { RequestWithInternalClaims } from "../../internal/internal-auth.guard";
import { RateLimitService } from "../../shared/rate-limit/rate-limit.service";

const WINDOW_SECONDS = 60;

/**
 * AUTH_SERVICE_PLAN.md "APIs": "`POST /internal/github/token` ... is
 * rate-limited per user". Must run after `InternalAuthGuard` in the same
 * `@UseGuards` list so `internalClaims.sub` (the user the token was minted
 * for) is already populated — keying on the verified claim, not the
 * unvalidated request body, so the limit can't be bypassed by lying about
 * `userId`.
 */
@Injectable()
export class InternalGithubTokenRateLimitGuard implements CanActivate {
  constructor(
    private readonly rateLimit: RateLimitService,
    @Inject(APP_CONFIG) private readonly config: ApiEnv
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithInternalClaims>();
    const userId = request.internalClaims?.sub ?? "unknown";

    const result = await this.rateLimit.consume(
      `internal-github-token:${userId}`,
      this.config.RATE_LIMIT_INTERNAL_GITHUB_TOKEN_PER_MINUTE,
      WINDOW_SECONDS
    );

    if (!result.allowed) {
      throw new AppError("RATE_LIMITED", "Too many GitHub token requests for this user.", {
        details: { retryAfterSeconds: result.retryAfterSeconds },
      });
    }

    return true;
  }
}
