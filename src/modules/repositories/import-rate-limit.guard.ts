import { Inject, Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { AppError } from "@aca/contracts";
import { APP_CONFIG } from "../../config/config.module";
import type { ApiEnv } from "../../config/env";
import { RateLimitService } from "../../shared/rate-limit/rate-limit.service";
import type { RequestWithUser } from "../auth/access-token.guard";

const WINDOW_SECONDS = 3600;

/** User-keyed — runs after AccessTokenGuard, so `request.userId` is always set (RULES.md #12 "Rate-limit ... import"). */
@Injectable()
export class ImportRateLimitGuard implements CanActivate {
  constructor(
    private readonly rateLimit: RateLimitService,
    @Inject(APP_CONFIG) private readonly config: ApiEnv
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const result = await this.rateLimit.consume(
      `repo-import:${request.userId}`,
      this.config.RATE_LIMIT_IMPORT_PER_HOUR,
      WINDOW_SECONDS
    );

    if (!result.allowed) {
      throw new AppError("RATE_LIMITED", "Too many import attempts. Please wait before trying again.", {
        details: { retryAfterSeconds: result.retryAfterSeconds },
      });
    }

    return true;
  }
}
